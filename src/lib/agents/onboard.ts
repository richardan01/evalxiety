/**
 * Onboarding wizard ("Connect your agent"): test an endpoint once, suggest checks from its reply, and write a NEW
 * agents/<id>/ folder (agent.json + cases.jsonl).
 *
 * The wizard only ever creates a folder that doesn't exist yet — it never edits or overwrites one — so everything
 * after onboarding still lives in files the owner controls. Secrets are never accepted as values: an auth header is
 * always written as a ${env:EVALXIETY_AGENT_<ID>_TOKEN} reference, checked by the same assertSafeConnection rules as a
 * hand-written agent.json. The routes are mutating API calls, so the proxy already limits them to same-origin JSON
 * requests on a local Host.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { agentsDir, parseAgentConfig, parseCases } from "./config";
import { agentEnvPrefix, assertSafeConnection, callAgent, resolveHeaders } from "./http";
import { AgentId, CheckConfig, HttpConnection, type AgentConfig } from "./schemas";
import { suggestChecks } from "./suggest";

export class OnboardError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Optional bearer-style auth: the header is written with an env reference, never a literal token. */
export const AuthHeader = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/, "header names use letters, digits and dashes"),
  /** Text before the token, e.g. "Bearer ". Must not itself look like a secret. */
  prefix: z.string().max(20).regex(/^[A-Za-z ]*$/, "use a short word like \"Bearer \" (letters and spaces only)").default(""),
});
export type AuthHeader = z.infer<typeof AuthHeader>;

export const OnboardConnection = z.object({
  url: HttpConnection.shape.url,
  auth: AuthHeader.nullable().default(null),
  timeout_ms: z.number().int().positive().max(300_000).default(30_000),
});
export type OnboardConnection = z.infer<typeof OnboardConnection>;

/** The env var an agent's token must live in. */
export const tokenEnvName = (agentId: string) => `${agentEnvPrefix(agentId)}TOKEN`;

export function connectionHeaders(agentId: string, auth: AuthHeader | null): Record<string, string> {
  return auth ? { [auth.name]: `${auth.prefix}\${env:${tokenEnvName(agentId)}}` } : {};
}

// ---------------------------------------------------------------------------
// Test call + check suggestions
// ---------------------------------------------------------------------------

export const TestBody = z.object({
  agent_id: AgentId,
  connection: OnboardConnection,
  sample_input: z.unknown().refine((v) => v !== undefined, "sample_input is required"),
});

export async function testConnection(body: z.infer<typeof TestBody>, fetchImpl: typeof fetch = fetch) {
  const conn = HttpConnection.parse({ type: "http", url: body.connection.url, timeout_ms: body.connection.timeout_ms, headers: connectionHeaders(body.agent_id, body.connection.auth) });
  assertSafeConnection(body.agent_id, conn.url, conn.headers);
  const { headers, secrets } = resolveHeaders(conn.headers);
  const result = await callAgent(conn, { case_id: "wizard-test", input: body.sample_input, split: "dev" }, headers, fetchImpl, { secrets });
  return {
    result: { output: result.output, evidence: result.evidence, model_id: result.model_id, latency_ms: Math.round(result.latency_ms), error: result.error },
    suggested_checks: result.error ? suggestChecks(null) : suggestChecks(result),
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/**
 * Turn what the user pasted into cases.jsonl text. Either JSONL ({"case_id", "input", …} per line, used as is) or plain
 * text, one test input per line — wrapped as { [input_key]: line } (or the bare string when input_key is null), with
 * ids q01, q02… When `holdout` is set, every 5th plain-text case is held out for the final check.
 */
export function buildCases(text: string, inputKey: string | null, holdout: boolean): { jsonl: string; count: number; heldout: number } {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  if (!lines.length) throw new OnboardError("Add at least one test case.");
  const looksJsonl = lines.every((l) => l.startsWith("{"));
  if (looksJsonl) {
    const { cases, problems } = parseCases(lines.join("\n"));
    if (problems.length) throw new OnboardError(`Cases: ${problems.map((p) => `line ${p.line}: ${p.message}`).join("; ")}`);
    return { jsonl: cases.map((c) => JSON.stringify(c)).join("\n") + "\n", count: cases.length, heldout: cases.filter((c) => c.split === "heldout").length };
  }
  const width = String(lines.length).length < 2 ? 2 : String(lines.length).length;
  const cases = lines.map((line, i) => ({
    case_id: `q${String(i + 1).padStart(width, "0")}`,
    ...(holdout && lines.length >= 5 && (i + 1) % 5 === 0 ? { split: "heldout" } : {}),
    input: inputKey ? { [inputKey]: line } : line,
  }));
  return { jsonl: cases.map((c) => JSON.stringify(c)).join("\n") + "\n", count: cases.length, heldout: cases.filter((c) => c.split === "heldout").length };
}

// ---------------------------------------------------------------------------
// Create the folder
// ---------------------------------------------------------------------------

export const CreateBody = z.object({
  agent_id: AgentId,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  /** null = no endpoint: the owner will import traces instead. */
  connection: OnboardConnection.nullable(),
  checks: z.array(CheckConfig).max(30),
  cases_text: z.string().max(1_000_000),
  input_key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable().default(null),
  holdout: z.boolean().default(true),
});

export async function createAgent(body: z.infer<typeof CreateBody>) {
  if (body.agent_id.startsWith("example-")) throw new OnboardError("Ids starting with example- are reserved for the starter kit.");
  const headers = body.connection ? connectionHeaders(body.agent_id, body.connection.auth) : {};
  const config: Partial<AgentConfig> & Record<string, unknown> = {
    name: body.name,
    description: body.description,
    example: false,
    ...(body.connection
      ? { connection: { type: "http", url: body.connection.url, headers, timeout_ms: body.connection.timeout_ms, cost_per_call_usd: null, concurrency: 2 } }
      : {}),
    checks: body.checks,
    min_reviewed_traces: 10,
    pass_all_threshold: 0.9,
  };
  if (body.connection) assertSafeConnection(body.agent_id, body.connection.url, headers);
  const { problems } = parseAgentConfig(config, body.agent_id);
  if (problems.length) throw new OnboardError(`agent.json: ${problems.join("; ")}`);
  const cases = buildCases(body.cases_text, body.input_key, body.holdout);

  const root = agentsDir();
  const dir = path.join(root, body.agent_id);
  await fs.mkdir(root, { recursive: true });
  try {
    await fs.mkdir(dir); // not recursive: fails if the folder exists, so an existing agent is never overwritten
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new OnboardError(`agents/${body.agent_id} already exists. Pick another id, or edit that folder's files directly.`, 409);
    throw err;
  }
  await fs.writeFile(path.join(dir, "agent.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(dir, "cases.jsonl"), cases.jsonl, "utf8");
  return {
    agent_id: body.agent_id,
    dir,
    cases: cases.count,
    heldout: cases.heldout,
    checks: body.checks.length,
    token_env: body.connection?.auth ? tokenEnvName(body.agent_id) : null,
  };
}
