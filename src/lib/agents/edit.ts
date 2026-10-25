/**
 * Editing an agent's definition from its page, so a product manager can define "good" without JSON: the rules (code
 * checks), the AI reviewer's question (judge) and the test cases.
 *
 * What it guarantees:
 *   - Only checks, judge and cases are written. The connection (URL, headers) is never touched, so the app can't point
 *     an agent, or its token, at a new host: that still takes write access to the folder.
 *   - The starter kit (example: true) is read-only: its files are shared with everyone who uses the repo.
 *   - A write is refused if the files changed since the page loaded them (edited by hand, or in another tab), validated
 *     with exactly the rules the next load applies (validateDefinition), written atomically (temp file + rename) under a
 *     per-agent lock, and audited under a named person.
 *   - A locked final-exam case can't be changed or removed, and its content is never returned.
 *   - Custom rules run the owner's code, so they're added in agents/custom-checks.ts, not here.
 */
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { sha256, stableStringify, withLock } from "../storage/store";
import { agentsDir, AgentNotFoundError, readText, validateDefinition } from "./config";
import { agentAudit } from "./repo";
import { AGENT_ID_RE, type AgentCase, type AgentJudgeConfig, type CheckConfig, type LoadedAgent } from "./schemas";

export class EditError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const STARTER_KIT_READ_ONLY =
  "This is the starter kit: its rules and cases are shared with everyone who uses this copy of Evalxiety, so they can't be edited here. Connect your own agent to define its rules and cases.";

export type RawConfig = Record<string, unknown>;

/** Identifies the exact contents of both files; an edit must name the version it was made on. */
export function definitionHash(configText: string, casesText: string): string {
  return sha256({ config: configText, cases: casesText }).slice(0, 16);
}

export interface Definition {
  agent: LoadedAgent;
  configText: string;
  casesText: string;
  raw: RawConfig;
  hash: string;
}

/** Both files, read once: the agent, the fingerprint and the edit all come from the same text. */
export async function readDefinition(agentId: string): Promise<Definition> {
  if (!AGENT_ID_RE.test(agentId)) throw new AgentNotFoundError(`Unknown agent "${agentId}"`);
  const dir = path.join(agentsDir(), agentId);
  const configText = await readText(path.join(dir, "agent.json"));
  if (configText === null) throw new AgentNotFoundError(`Unknown agent "${agentId}"`);
  const casesText = (await readText(path.join(dir, "cases.jsonl"))) ?? "";
  const { agent, problems } = validateDefinition(agentId, dir, configText, casesText);
  if (!agent) throw new AgentNotFoundError(`Agent "${agentId}" has config problems: ${problems.map((p) => `${p.file}${p.line ? `:${p.line}` : ""} ${p.message}`).join("; ")}`);
  return { agent, configText, casesText, raw: JSON.parse(configText) as RawConfig, hash: definitionHash(configText, casesText) };
}

async function writeAtomic(file: string, text: string) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, file);
}

export const configTextOf = (raw: RawConfig) => JSON.stringify(raw, null, 2) + "\n";

export interface EditRequest {
  actor: string;
  /** definitionHash of the files the person was looking at. */
  base: string;
  /** Audit action, e.g. "rule_added". */
  action: string;
  /** The change: new file contents (either or both) and what to record in the audit log. */
  apply: (d: Definition) => Promise<{ configText?: string; casesText?: string; details: Record<string, unknown> }>;
}

export async function editDefinition(agentId: string, req: EditRequest): Promise<{ agent: LoadedAgent; hash: string; details: Record<string, unknown> }> {
  return withLock(`agent-definition/${agentId}`, async () => {
    const d = await readDefinition(agentId);
    if (d.agent.config.example) throw new EditError(STARTER_KIT_READ_ONLY, 403);
    if (req.base !== d.hash) {
      throw new EditError("This agent's files changed since you opened the page (edited by hand, or in another tab). Reload the page and try again.", 409);
    }
    const next = await req.apply(d);
    const configText = next.configText ?? d.configText;
    const casesText = next.casesText ?? d.casesText;
    const after = JSON.parse(configText) as RawConfig;
    // Belt and braces: no edit may change where the agent is called, what is sent to it, or whether it's the starter kit.
    for (const key of ["connection", "example"]) {
      if (stableStringify(d.raw[key] ?? null) !== stableStringify(after[key] ?? null)) throw new Error(`The editor must never change "${key}" in agent.json.`);
    }
    const { agent, problems } = validateDefinition(agentId, d.agent.dir, configText, casesText);
    if (!agent) throw new EditError(`Not saved: ${problems.map((p) => `${p.file}${p.line ? ` line ${p.line}` : ""}: ${p.message}`).join("; ")}`, 422);
    if (configText !== d.configText) await writeAtomic(path.join(d.agent.dir, "agent.json"), configText);
    if (casesText !== d.casesText) await writeAtomic(path.join(d.agent.dir, "cases.jsonl"), casesText);
    await agentAudit(agentId, req.actor, req.action, next.details);
    return { agent, hash: definitionHash(configText, casesText), details: next.details };
  });
}

// ---------------------------------------------------------------------------
// Rules and the AI reviewer (agent.json)
// ---------------------------------------------------------------------------

const checksOf = (raw: RawConfig): unknown[] => (Array.isArray(raw.checks) ? raw.checks : []);
const idOf = (c: unknown) => (c && typeof c === "object" ? (c as { id?: unknown }).id : undefined);

export function withRule(raw: RawConfig, rule: CheckConfig): RawConfig {
  if (rule.type === "custom") throw new EditError("Custom rules run your own code, so they're added in agents/custom-checks.ts, not in the app.");
  if (checksOf(raw).some((c) => idOf(c) === rule.id)) throw new EditError(`There is already a rule called "${rule.id}". Give this one another name.`, 409);
  const { id, type, question, ...rest } = rule; // written in the order a person reads a rule
  return { ...raw, checks: [...checksOf(raw), { id, type, question, ...rest }] };
}

export function withoutRule(raw: RawConfig, id: string): RawConfig {
  if (!checksOf(raw).some((c) => idOf(c) === id)) throw new EditError(`There is no rule called "${id}".`, 404);
  return { ...raw, checks: checksOf(raw).filter((c) => idOf(c) !== id) };
}

/** Set or remove the AI reviewer question, keeping the key where it was. */
export function withJudge(raw: RawConfig, judge: AgentJudgeConfig | null): RawConfig {
  if (!judge) return Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "judge"));
  return "judge" in raw ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, k === "judge" ? judge : v])) : { ...raw, judge };
}

// ---------------------------------------------------------------------------
// Test cases (cases.jsonl) — edited line by line, so comments and other cases stay exactly as they were
// ---------------------------------------------------------------------------

export function serializeCase(c: AgentCase): string {
  return JSON.stringify({
    case_id: c.case_id,
    ...(c.split === "heldout" ? { split: "heldout" } : {}),
    input: c.input,
    ...(c.expected !== undefined ? { expected: c.expected } : {}),
    ...(c.notes ? { notes: c.notes } : {}),
    ...(c.origin ? { origin: c.origin } : {}),
  });
}

function lineOf(text: string, caseId: string): { lines: string[]; index: number } {
  const lines = text.split("\n");
  const index = lines.findIndex((l) => {
    const t = l.trim();
    if (!t || t.startsWith("//")) return false;
    try {
      return (JSON.parse(t) as { case_id?: unknown }).case_id === caseId;
    } catch {
      return false;
    }
  });
  if (index < 0) throw new EditError(`There is no test case "${caseId}".`, 404);
  return { lines, index };
}

/** The file's own line ending, so a file saved on Windows keeps CRLF. */
const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

export function withCasesAdded(text: string, cases: AgentCase[]): string {
  const eol = eolOf(text);
  const start = text === "" || text.endsWith("\n") ? text : `${text}${eol}`;
  return start + cases.map((c) => `${serializeCase(c)}${eol}`).join("");
}

export function withCaseReplaced(text: string, c: AgentCase): string {
  const { lines, index } = lineOf(text, c.case_id);
  lines[index] = serializeCase(c) + (lines[index].endsWith("\r") ? "\r" : "");
  return lines.join("\n");
}

export function withCaseRemoved(text: string, caseId: string): string {
  const { lines, index } = lineOf(text, caseId);
  lines.splice(index, 1);
  return lines.join("\n");
}
