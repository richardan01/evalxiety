#!/usr/bin/env node
/**
 * Make an import file for Evalxiety: run your agent on every case in cases.jsonl and print one JSON line per case.
 *
 *   node agents/my-agent/run-my-agent.mjs > agents/my-agent/v1.jsonl                        # dev cases only
 *   node agents/my-agent/run-my-agent.mjs --include-heldout > agents/my-agent/final.jsonl   # after the held-out reveal
 *
 * (Writing the file inside agents/my-agent/ keeps it git-ignored.) Edit callMyAgent() below. Then check the file with
 * `npm run validate -- my-agent agents/my-agent/v1.jsonl` and import it on the agent's page with a version label
 * (e.g. the git SHA of the version you ran). Your agent isn't in Node? Call it over HTTP or as a subprocess from
 * callMyAgent(), or write the same JSON lines from any language.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

class NotConfigured extends Error {}

/**
 * Call your agent with one case's input. Return either the answer itself, or
 * { output, evidence: [{ id, text }], tool_calls, model_id, cost_usd } if you have them.
 */
async function callMyAgent(input) {
  void input;
  throw new NotConfigured("Edit callMyAgent() in run-my-agent.mjs so it calls your agent.");
}

const here = path.dirname(fileURLToPath(import.meta.url));
const includeHeldout = process.argv.includes("--include-heldout");
const cases = readFileSync(path.join(here, "cases.jsonl"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("//"))
  .map((l) => JSON.parse(l));
if (!cases.length) {
  console.error("cases.jsonl has no cases yet: add one JSON object per line first.");
  process.exit(1);
}

for (const c of cases) {
  if (c.split === "heldout" && !includeHeldout) continue;
  const started = Date.now();
  try {
    const r = await callMyAgent(c.input);
    const record = r && typeof r === "object" && "output" in r ? r : { output: r };
    console.log(JSON.stringify({ case_id: c.case_id, ...record, latency_ms: Date.now() - started }));
  } catch (e) {
    if (e instanceof NotConfigured) {
      console.error(e.message);
      process.exit(1);
    }
    // A failed case is recorded as an error, never as an answer.
    console.log(JSON.stringify({ case_id: c.case_id, error: String(e?.message ?? e), latency_ms: Date.now() - started }));
  }
}
