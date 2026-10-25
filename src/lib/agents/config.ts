/**
 * Load agent definitions from disk: agents/<agent_id>/agent.json + cases.jsonl.
 *
 * Definitions are files the agent owner edits and reviews (in their fork or their own repo via
 * EVALXIETY_AGENTS_DIR). The app writes them in two places only: the onboarding wizard creates a brand-new folder
 * (onboard.ts, never overwriting one), and the agent page edits an existing agent's rules, AI reviewer question and
 * test cases (edit.ts). Neither ever changes the connection, so an agent's endpoint and headers can only be changed by
 * someone with write access to the folder. Broken files are reported as problems with a file and line number instead
 * of crashing the app.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { hasPath, lookupCustom } from "./checks";
import { CUSTOM_CHECKS } from "./registry";
import { AGENT_ID_RE, AgentCase, AgentConfig, type LoadedAgent } from "./schemas";

/** JSON.parse messages count lines within the snippet ("line 1 column 2"), which contradicts the file line. */
export function jsonError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/ \(line \d+ column \d+\)/, "");
}

export function agentsDir(): string {
  return process.env.EVALXIETY_AGENTS_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "agents");
}

export interface ConfigProblem {
  agent_id: string;
  file: string;
  line: number | null;
  message: string;
}

export function formatZodIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; ");
}

/** Parse cases.jsonl text. Pure, so the CLI validator and tests share it. */
export function parseCases(text: string): { cases: AgentCase[]; problems: Array<{ line: number; message: string }> } {
  const cases: AgentCase[] = [];
  const problems: Array<{ line: number; message: string }> = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || raw.trim().startsWith("//")) return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      problems.push({ line, message: `not valid JSON (${jsonError(e)})` });
      return;
    }
    const parsed = AgentCase.safeParse(json);
    if (!parsed.success) {
      problems.push({ line, message: formatZodIssues(parsed.error) });
      return;
    }
    if (seen.has(parsed.data.case_id)) {
      problems.push({ line, message: `duplicate case_id "${parsed.data.case_id}"` });
      return;
    }
    seen.add(parsed.data.case_id);
    cases.push(parsed.data);
  });
  return { cases, problems };
}

/**
 * Validate an agent.json value. Rules beyond the schema: unique check ids, every max_length check sets a limit, and
 * (when the agent id is known) every custom check names a function registered for this agent in
 * agents/custom-checks.ts — otherwise it would report ERROR on every trace.
 */
export function parseAgentConfig(json: unknown, agentId?: string): { config: AgentConfig | null; problems: string[] } {
  const parsed = AgentConfig.safeParse(json);
  if (!parsed.success) return { config: null, problems: [formatZodIssues(parsed.error)] };
  const problems: string[] = [];
  const ids = parsed.data.checks.map((c) => c.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) problems.push(`duplicate check id(s): ${dupes.join(", ")}`);
  for (const c of parsed.data.checks) {
    if (c.type === "max_length" && c.max_chars === undefined && c.max_words === undefined) {
      problems.push(`check "${c.id}": set max_words and/or max_chars (without a limit it would always pass)`);
    }
    if (c.type === "regex") {
      try {
        new RegExp(c.pattern, c.flags);
      } catch (e) {
        problems.push(`check "${c.id}": invalid pattern or flags (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (c.type === "custom" && agentId !== undefined && !lookupCustom(CUSTOM_CHECKS, agentId, c.function)) {
      const owner = Object.keys(CUSTOM_CHECKS).find((id) => lookupCustom(CUSTOM_CHECKS, id, c.function));
      problems.push(
        `check "${c.id}": no function "${c.function}" is registered for "${agentId}" in agents/custom-checks.ts (custom checks are registered per agent id; remove the check or register it)` +
          (owner ? `. It is registered for "${owner}" — if this folder is a copy of ${owner}, start from agents/_template instead.` : ""),
      );
    }
  }
  // The parsed config is returned even with rule problems, so the caller can check cases too and report everything at once.
  return { config: parsed.data, problems };
}

export async function readText(file: string): Promise<string | null> {
  try {
    // Strip a UTF-8 byte-order mark (Windows editors add one), which JSON.parse would reject.
    return (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function loadAgentFromDir(agentId: string, dir: string): Promise<{ agent: LoadedAgent | null; problems: ConfigProblem[] }> {
  const problems: ConfigProblem[] = [];
  const p = (file: string, message: string, line: number | null = null) => problems.push({ agent_id: agentId, file, line, message });
  if (!AGENT_ID_RE.test(agentId)) {
    p("", `Folder name "${agentId}" is not a valid agent id: use lowercase letters, digits and dashes.`);
    return { agent: null, problems };
  }
  const configText = await readText(path.join(dir, "agent.json"));
  if (configText === null) {
    p("agent.json", "agent.json is missing.");
    return { agent: null, problems };
  }
  return validateDefinition(agentId, dir, configText, await readText(path.join(dir, "cases.jsonl")));
}

/**
 * Every rule loading applies, on file contents in memory: the in-app editor validates what it is about to write with
 * exactly the rules the next load will apply. casesText null = cases.jsonl is missing.
 */
export function validateDefinition(agentId: string, dir: string, configText: string, casesText: string | null): { agent: LoadedAgent | null; problems: ConfigProblem[] } {
  const problems: ConfigProblem[] = [];
  const p = (file: string, message: string, line: number | null = null) => problems.push({ agent_id: agentId, file, line, message });
  let configJson: unknown;
  try {
    configJson = JSON.parse(configText);
  } catch (e) {
    p("agent.json", `not valid JSON (${jsonError(e)})`);
    return { agent: null, problems };
  }
  const { config, problems: cfgProblems } = parseAgentConfig(configJson, agentId);
  cfgProblems.forEach((m) => p("agent.json", m));
  if (!config) return { agent: null, problems }; // schema errors: nothing more can be checked

  if (casesText === null) {
    p("cases.jsonl", "cases.jsonl is missing. Add one test case per line: {\"case_id\": \"c1\", \"input\": ...}");
    return { agent: null, problems };
  }
  const { cases, problems: caseProblems } = parseCases(casesText);
  caseProblems.forEach((x) => p("cases.jsonl", x.message, x.line));
  if (caseProblems.length) return { agent: null, problems };
  if (cases.length === 0) {
    p("cases.jsonl", "cases.jsonl has no cases.");
    return { agent: null, problems };
  }
  // A matches_expected check whose expected_field no case has would be NOT_APPLICABLE everywhere: switched off silently.
  for (const c of config.checks) {
    if (c.type !== "matches_expected") continue;
    const withExpected = cases.filter((x) => x.expected !== undefined);
    if (!withExpected.length) {
      p("agent.json", `check "${c.id}": no case in cases.jsonl has an "expected" value, so this check would never apply.`);
    } else if (c.expected_field && !withExpected.some((x) => hasPath(x.expected, c.expected_field))) {
      p("agent.json", `check "${c.id}": no case's "expected" has "${c.expected_field}", so this check would never apply (typo?).`);
    }
  }
  if (problems.length) return { agent: null, problems };
  return { agent: { agent_id: agentId, dir, config, cases }, problems };
}

export async function loadAgents(): Promise<{ agents: LoadedAgent[]; problems: ConfigProblem[] }> {
  const root = agentsDir();
  let entries: string[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_")).map((d) => d.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { agents: [], problems: [] };
    throw err;
  }
  const results = await Promise.all(entries.sort().map((id) => loadAgentFromDir(id, path.join(root, id))));
  return {
    agents: results.map((r) => r.agent).filter((a): a is LoadedAgent => a !== null),
    problems: results.flatMap((r) => r.problems),
  };
}

export class AgentNotFoundError extends Error {}

export async function getAgent(agentId: string): Promise<LoadedAgent> {
  if (!AGENT_ID_RE.test(agentId)) throw new AgentNotFoundError(`Unknown agent "${agentId}"`);
  const dir = path.join(agentsDir(), agentId);
  const exists = await fs.stat(dir).then((s) => s.isDirectory(), () => false);
  if (!exists) throw new AgentNotFoundError(`Unknown agent "${agentId}" (no folder ${dir})`);
  const { agent, problems } = await loadAgentFromDir(agentId, dir);
  if (!agent) {
    const msg = problems.map((x) => `${x.file}${x.line ? `:${x.line}` : ""} ${x.message}`).join("; ");
    throw new AgentNotFoundError(problems.length ? `Agent "${agentId}" has config problems: ${msg}` : `Unknown agent "${agentId}"`);
  }
  return agent;
}
