/**
 * Offline checker for an agent folder and (optionally) a trace file, before you open the app.
 *
 *   npm run validate -- <agent-id>                      # checks agents/<agent-id>/agent.json and cases.jsonl
 *   npm run validate -- <agent-id> path/to/traces.jsonl # also checks a file you want to import
 *
 * Prints every problem with its file and line number and exits 1 if anything is wrong. Reads .env.local like the app.
 * In CI, your agent folder must be in the checkout, and held-out cases count as locked unless data/ has the reveal.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { agentsDir, loadAgentFromDir } from "../src/lib/agents/config";
import { assertSafeConnection } from "../src/lib/agents/http";
import { hashAgentCases, parseImport } from "../src/lib/agents/ingest";
import { listFrozenVersions } from "../src/lib/agents/repo";
import { getLockState } from "../src/lib/agents/runs";

/** Minimal .env.local reader (process.loadEnvFile needs Node 20.12; Next.js supports 20.9). Never overrides set vars. */
async function loadEnvLocal() {
  const text = await fs.readFile(".env.local", "utf8").catch(() => null);
  if (!text) return;
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || raw.trim().startsWith("#")) continue;
    const quoted = m[2].match(/^(['"])(.*)\1$/);
    const value = quoted ? quoted[2] : m[2].replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

async function main() {
  // Same settings as the app (EVALXIETY_AGENTS_DIR, AGENTTRUST_DATA_DIR). Variables already set on the command line win.
  await loadEnvLocal();
  const [agentId, tracesFile] = process.argv.slice(2);
  if (!agentId) {
    console.error("Usage: npm run validate -- <agent-id> [traces.jsonl]");
    process.exit(2);
  }
  const dir = path.join(agentsDir(), agentId);
  const { agent, problems } = await loadAgentFromDir(agentId, dir);
  if (!agent) {
    for (const p of problems) console.error(`✕ agents/${agentId}/${p.file}${p.line ? `:${p.line}` : ""}  ${p.message}`);
    if (!problems.length) console.error(`✕ agents/${agentId} could not be loaded`);
    process.exit(1);
  }
  const heldout = agent.cases.filter((c) => c.split === "heldout").length;
  console.log(`✓ agents/${agentId}: "${agent.config.name}" — ${agent.cases.length} cases (${heldout} held out), ${agent.config.checks.length} code checks${agent.config.judge ? ", 1 judge question" : ""}${agent.config.connection ? `, HTTP ${agent.config.connection.url}` : ""}`);
  // Problems the app would only show later.
  let configProblems = 0;
  if (agent.config.connection) {
    try {
      assertSafeConnection(agentId, agent.config.connection.url, agent.config.connection.headers);
    } catch (e) {
      configProblems++;
      console.error(`✕ agents/${agentId}/agent.json  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const frozen = await listFrozenVersions(agentId);
  const latest = frozen[frozen.length - 1];
  if (latest && latest.content_hash !== hashAgentCases(agent.cases)) {
    console.log(`  Note: cases.jsonl changed since frozen v${latest.version}; freeze a new version in the app before the next run.`);
  }
  if (configProblems) process.exit(1);
  if (!tracesFile) return;

  const text = await fs.readFile(tracesFile, "utf8");
  const r = parseImport(text, agent, await getLockState(agent));
  for (const p of r.problems) console.error(`✕ ${tracesFile}${p.line ? `:${p.line}` : ""}  ${p.message}`);
  if (r.problems.length) {
    console.error(`\n${r.problems.length} problem(s). Nothing is imported until every line is valid.`);
    process.exit(1);
  }
  console.log(`✓ ${tracesFile}: ${r.lines.length} trace(s) ready to import.`);
  if (r.missing_case_ids.length) console.log(`  Note: no trace for ${r.missing_case_ids.join(", ")} — the run will be marked incomplete.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
