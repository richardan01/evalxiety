/**
 * Creating runs for "your agents": import a JSONL file, or call the agent's HTTP endpoint on every visible case.
 *
 * Both paths pin the run to a frozen version of the cases. The first run freezes v1 automatically; after that,
 * editing cases.jsonl requires an explicit, audited "freeze new version" so old and new runs are never compared
 * as if they ran on the same cases.
 */
import { newId, sha256 } from "../storage/store";
import { isEmptyOutput } from "./checks";
import { assertSafeConnection, callAgent, mapLimit, redactSecrets, referencedEnv, resolveHeaders } from "./http";
import { agentEnv } from "./secrets";
import { caseInputHash, computeLockState, hashAgentCases, parseImport, visibleCases, type ImportProblem, type LockState } from "./ingest";
import {
  agentAudit,
  freezeVersion,
  getAgentHeldout,
  listAgentRuns,
  listFrozenVersions,
  saveAgentRun,
  saveAgentTrace,
  updateAgentRun,
} from "./repo";
import type { AgentRun, AgentTrace, FrozenVersion, LoadedAgent } from "./schemas";

export class ImportValidationError extends Error {
  constructor(public problems: ImportProblem[], public heldout: boolean) {
    super(`The file has ${problems.length} problem(s); nothing was imported.`);
  }
}

export class CasesChangedError extends Error {}

export interface RunEstimate {
  calls: number;
  cost_per_call_usd: number | null;
  estimated_usd: number | null;
  host: string;
  env_sent: string[];
}

export class ConfirmationRequiredError extends Error {
  constructor(public estimate: RunEstimate) {
    super(
      `This will call ${estimate.host} ${estimate.calls} time(s)` +
        (estimate.estimated_usd !== null ? `, estimated at about $${estimate.estimated_usd.toFixed(2)}` : " (cost unknown — set connection.cost_per_call_usd to see an estimate)") +
        (estimate.env_sent.length ? `, sending ${estimate.env_sent.join(", ")} from .env.local` : "") +
        ". Confirm to run.",
    );
  }
}

/**
 * Starter-kit traces carry metadata.evalxiety_starter_kit = true. They stay EXAMPLE data even if the folder is copied
 * and "example" is set to false, so toy output can never be imported as evidence about a real agent.
 */
const isStarterKit = (metadata: Record<string, unknown> | undefined) => metadata?.evalxiety_starter_kit === true;
const originOf = (agent: LoadedAgent, metadata?: Record<string, unknown>): AgentTrace["data_origin"] =>
  agent.config.example || isStarterKit(metadata) ? "example" : "real";

/** Held-out cases with a hash of their input, recorded in every frozen version. */
const heldoutEntries = (agent: LoadedAgent) =>
  agent.cases.filter((c) => c.split === "heldout").map((c) => ({ case_id: c.case_id, input_hash: caseInputHash(c.input) }));

/** Audit detail for a freeze: held-out cases moved to dev, renamed, removed or added since the previous version. */
function splitChanges(agent: LoadedAgent, previous: FrozenVersion | null) {
  if (!previous) return {};
  const nowById = new Map(agent.cases.map((c) => [c.case_id, c]));
  const nowByHash = new Map(agent.cases.map((c) => [caseInputHash(c.input), c]));
  const moved_to_dev: string[] = [];
  const removed_heldout: string[] = [];
  const renamed_heldout: Array<{ from: string; to: string }> = [];
  for (const h of previous.heldout_cases) {
    const same = nowById.get(h.case_id);
    const byContent = nowByHash.get(h.input_hash);
    if (same && same.split === "dev") moved_to_dev.push(h.case_id);
    else if (!same && byContent) renamed_heldout.push({ from: h.case_id, to: byContent.case_id });
    else if (!same) removed_heldout.push(h.case_id);
  }
  const before = new Set(previous.heldout_cases.map((h) => h.case_id));
  const moved_to_heldout = agent.cases.filter((c) => c.split === "heldout" && !before.has(c.case_id) && previous.case_ids.includes(c.case_id)).map((c) => c.case_id);
  return { moved_to_dev, removed_heldout, renamed_heldout, moved_to_heldout };
}

/** What may be traced right now (see computeLockState). */
export async function getLockState(agent: LoadedAgent): Promise<LockState> {
  const [frozen, heldout] = await Promise.all([listFrozenVersions(agent.agent_id), getAgentHeldout(agent.agent_id)]);
  return computeLockState(agent, frozen, heldout);
}

const CONTRACT_KEYS = new Set(["case_id", "output", "evidence", "tool_calls", "model_id", "latency_ms", "cost_usd", "error", "timestamp", "metadata"]);

/** The frozen version runs must use now. Freezes v1 on first use; refuses if cases changed since the latest. */
export async function currentFrozen(agent: LoadedAgent, actor: string): Promise<FrozenVersion> {
  const hash = hashAgentCases(agent.cases);
  const versions = await listFrozenVersions(agent.agent_id);
  const latest = versions[versions.length - 1];
  if (!latest) {
    const { version } = await freezeVersion(agent.agent_id, hash, agent.cases.map((c) => c.case_id), heldoutEntries(agent), actor, "Frozen automatically on the first run");
    await agentAudit(agent.agent_id, actor, "frozen_version_created", { version: version.version, hash, automatic: true });
    return version;
  }
  if (latest.content_hash !== hash) {
    throw new CasesChangedError(
      `cases.jsonl changed since frozen v${latest.version}. Freeze a new version first (agent page → Cases); runs on v${latest.version} won't be comparable with new ones.`,
    );
  }
  return latest;
}

export async function freezeNewVersion(agent: LoadedAgent, actor: string, note: string): Promise<{ version: FrozenVersion; created: boolean }> {
  const hash = hashAgentCases(agent.cases);
  const res = await freezeVersion(agent.agent_id, hash, agent.cases.map((c) => c.case_id), heldoutEntries(agent), actor, note);
  if (res.created) {
    await agentAudit(agent.agent_id, actor, "frozen_version_created", { version: res.version.version, hash, note, ...splitChanges(agent, res.previous) });
  }
  return { version: res.version, created: res.created };
}

export interface ImportRequest {
  agent: LoadedAgent;
  text: string;
  agent_version: string;
  actor: string;
  notes?: string | null;
}

export async function importRun(req: ImportRequest): Promise<{ run: AgentRun; created: boolean; missing_case_ids: string[] }> {
  const { agent } = req;
  const lock = await getLockState(agent);
  const parsed = parseImport(req.text, agent, lock);
  if (parsed.problems.length) throw new ImportValidationError(parsed.problems, parsed.heldout_case_ids.length > 0);
  const frozen = await currentFrozen(agent, req.actor);

  const source_hash = sha256({ text: req.text, agent_version: req.agent_version, frozen: frozen.content_hash });
  const existing = (await listAgentRuns(agent.agent_id)).find((r) => r.source_hash === source_hash);
  if (existing) return { run: existing, created: false, missing_case_ids: parsed.missing_case_ids };

  const run_id = newId("arun");
  const now = new Date().toISOString();
  const caseById = new Map(agent.cases.map((c) => [c.case_id, c]));
  const trace_ids: Record<string, string> = {};
  let anyExample = agent.config.example;
  for (const { value: l } of parsed.lines) {
    const data_origin = originOf(agent, l.metadata);
    anyExample ||= data_origin === "example";
    const trace: AgentTrace = {
      trace_id: newId("atr"),
      agent_id: agent.agent_id,
      run_id,
      case_id: l.case_id,
      timestamp: l.timestamp ?? now,
      agent_version: req.agent_version,
      input: caseById.get(l.case_id)!.input,
      output: l.output ?? null,
      evidence: l.evidence ?? [],
      tool_calls: l.tool_calls ?? [],
      model_id: l.model_id ?? null,
      latency_ms: l.latency_ms ?? null,
      cost_usd: l.cost_usd ?? null,
      execution_mode: "imported",
      execution_error: l.error || (!agent.config.allow_empty_output && isEmptyOutput(l.output) ? "The agent returned no output" : null),
      data_origin,
      // Keys outside the trace contract are kept, not dropped.
      metadata: { ...Object.fromEntries(Object.entries(l).filter(([k]) => !CONTRACT_KEYS.has(k))), ...(l.metadata ?? {}) },
    };
    await saveAgentTrace(trace);
    trace_ids[l.case_id] = trace.trace_id;
  }
  const run: AgentRun = {
    run_id,
    agent_id: agent.agent_id,
    agent_version: req.agent_version,
    created_at: now,
    completed_at: now,
    created_by: req.actor,
    execution_mode: "imported",
    data_origin: anyExample ? "example" : "real",
    frozen_version: frozen.version,
    frozen_hash: frozen.content_hash,
    case_ids: visibleCases(agent, lock).map((c) => c.case_id).sort(),
    trace_ids,
    // Same rule as HTTP runs: a run where every trace errored is a failed run, never a default baseline or candidate.
    status: parsed.lines.length > 0 && parsed.lines.every(({ value: l }) => l.error || (!agent.config.allow_empty_output && isEmptyOutput(l.output))) ? "failed" : "completed",
    source_hash,
    notes: req.notes ?? null,
  };
  await saveAgentRun(run);
  await agentAudit(agent.agent_id, req.actor, "run_imported", {
    run_id,
    agent_version: req.agent_version,
    traces: parsed.lines.length,
    missing_case_ids: parsed.missing_case_ids,
    frozen_version: frozen.version,
  });
  return { run, created: true, missing_case_ids: parsed.missing_case_ids };
}

export interface HttpRunRequest {
  agent: LoadedAgent;
  agent_version: string;
  actor: string;
  confirm_batch: boolean;
  notes?: string | null;
  /** Restrict to these cases (must be visible). Defaults to every visible case. */
  case_ids?: string[];
  fetchImpl?: typeof fetch;
}

export function estimateHttpRun(agent: LoadedAgent, calls: number): RunEstimate {
  const conn = agent.config.connection!;
  const per = conn.cost_per_call_usd ?? null;
  return { calls, cost_per_call_usd: per, estimated_usd: per === null ? null : per * calls, host: new URL(conn.url).host, env_sent: referencedEnv(conn.headers) };
}

/** A run must be confirmed when it makes more than one call, or sends any secret (even for one case). */
export function needsConfirmation(agent: LoadedAgent, calls: number): boolean {
  return calls > 1 || referencedEnv(agent.config.connection?.headers ?? {}).length > 0;
}

/** Longest a run can legitimately take; a "running" run older than this was interrupted (e.g. a server restart). */
export function maxRunDurationMs(agent: LoadedAgent, cases: number): number {
  const conn = agent.config.connection;
  if (!conn) return 60_000;
  return Math.ceil(cases / conn.concurrency) * conn.timeout_ms + 60_000;
}

/** Validate, confirm and record a "running" run. Throws before any call is made if anything is wrong. */
export async function prepareHttpRun(
  req: HttpRunRequest,
): Promise<{ run: AgentRun; cases: LoadedAgent["cases"]; headers: Record<string, string>; secrets: Record<string, string> }> {
  const { agent } = req;
  const conn = agent.config.connection;
  if (!conn) throw new Error(`agents/${agent.agent_id}/agent.json has no "connection". Add one, or import a JSONL file instead.`);
  assertSafeConnection(agent.agent_id, conn.url, conn.headers);
  const lock = await getLockState(agent);
  const visible = visibleCases(agent, lock);
  let cases = visible;
  if (req.case_ids?.length) {
    const vis = new Set(visible.map((c) => c.case_id));
    const bad = req.case_ids.filter((id) => !vis.has(id));
    if (bad.length) throw new Error(`Unknown or locked case(s): ${bad.map((id) => lock.locked.get(id) ?? `"${id}" is not in cases.jsonl`).join(" ")}`);
    cases = visible.filter((c) => req.case_ids!.includes(c.case_id));
  }
  if (needsConfirmation(agent, cases.length) && !req.confirm_batch) throw new ConfirmationRequiredError(estimateHttpRun(agent, cases.length));
  const { headers, secrets } = resolveHeaders(conn.headers, agentEnv());
  const frozen = await currentFrozen(agent, req.actor);
  const run: AgentRun = {
    run_id: newId("arun"),
    agent_id: agent.agent_id,
    agent_version: req.agent_version,
    created_at: new Date().toISOString(),
    completed_at: null,
    created_by: req.actor,
    execution_mode: "http",
    data_origin: originOf(agent),
    frozen_version: frozen.version,
    frozen_hash: frozen.content_hash,
    case_ids: visible.map((c) => c.case_id).sort(),
    trace_ids: {},
    status: "running",
    source_hash: null,
    notes: req.notes ?? null,
  };
  await saveAgentRun(run);
  await agentAudit(agent.agent_id, req.actor, "http_run_started", { run_id: run.run_id, url: conn.url, cases: cases.length, agent_version: req.agent_version });
  return { run, cases, headers, secrets };
}

/** Call the agent on each prepared case; each trace is added to the run as it lands. Never throws for a failed call. */
export async function executeHttpRun(agent: LoadedAgent, prepared: Awaited<ReturnType<typeof prepareHttpRun>>, actor: string, fetchImpl?: typeof fetch): Promise<AgentRun> {
  const conn = agent.config.connection!;
  const { run } = prepared;
  try {
    const traces = await mapLimit(prepared.cases, conn.concurrency, async (c) => {
      // Nothing the agent sends back is stored with a secret in it (an echoed token in a 401 body, say).
      const r = redactSecrets(
        await callAgent(conn, c, prepared.headers, fetchImpl, { secrets: prepared.secrets, allowEmpty: agent.config.allow_empty_output }),
        prepared.secrets,
      );
      const data_origin = originOf(agent, r.metadata);
      const trace: AgentTrace = {
        trace_id: newId("atr"),
        agent_id: agent.agent_id,
        run_id: run.run_id,
        case_id: c.case_id,
        timestamp: new Date().toISOString(),
        agent_version: run.agent_version,
        input: c.input,
        output: r.output,
        evidence: r.evidence,
        tool_calls: r.tool_calls,
        model_id: r.model_id,
        latency_ms: Math.round(r.latency_ms),
        cost_usd: r.cost_usd,
        execution_mode: "http",
        execution_error: r.error,
        data_origin,
        metadata: r.metadata,
      };
      await saveAgentTrace(trace);
      await updateAgentRun(agent.agent_id, run.run_id, (cur) => ({
        ...cur,
        trace_ids: { ...cur.trace_ids, [c.case_id]: trace.trace_id },
        data_origin: cur.data_origin === "example" || data_origin === "example" ? "example" : "real",
      }));
      return trace;
    });
    const done = await updateAgentRun(agent.agent_id, run.run_id, (cur) => ({
      ...cur,
      completed_at: new Date().toISOString(),
      status: traces.every((t) => t.execution_error) ? "failed" : "completed",
    }));
    await agentAudit(agent.agent_id, actor, "http_run_completed", { run_id: run.run_id, traces: traces.length, errors: traces.filter((t) => t.execution_error).length });
    return done;
  } catch (e) {
    const note = `Run failed: ${e instanceof Error ? e.message : String(e)}`;
    const failed = await updateAgentRun(agent.agent_id, run.run_id, (cur) => ({ ...cur, completed_at: new Date().toISOString(), status: "failed", notes: note })).catch(async () => {
      const f: AgentRun = { ...run, completed_at: new Date().toISOString(), status: "failed", notes: note };
      await saveAgentRun(f);
      return f;
    });
    await agentAudit(agent.agent_id, actor, "http_run_failed", { run_id: run.run_id, error: note });
    return failed;
  }
}

/** Prepare and execute in one go (tests and the CLI). */
export async function httpRun(req: HttpRunRequest): Promise<{ run: AgentRun }> {
  const prepared = await prepareHttpRun(req);
  return { run: await executeHttpRun(req.agent, prepared, req.actor, req.fetchImpl) };
}
