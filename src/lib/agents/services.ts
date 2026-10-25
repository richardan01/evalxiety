/**
 * Read models and actions for "your agents" — API routes call these. Check results and gate verdicts are always
 * recomputed from stored traces, so editing a check in agent.json takes effect on the next page load.
 */
import { calibrationReport, MIN_PER_CLASS, type CalibrationPair } from "../metrics/calibration";
import { summarizeRun, type CaseEvaluation, passAll, type RunSummary } from "../metrics/experiments";
import { modeInfo } from "../llm/client";
import { newId, sha256 } from "../storage/store";
import type { DeterministicResult, ReleaseApproval } from "../domain/schemas";
import { judgeCallEstimate } from "../experiments/runner";
import { checkDefinitions, hasPath, isEmptyOutput, runChecks, type AgentCheckDefinition } from "./checks";
import { getAgent, loadAgents } from "./config";
import { evaluateAgentGate, type AgentGateResult } from "./gate";
import { assertSafeConnection, referencedEnv } from "./http";
import { agentEnv } from "./secrets";
import { caseInputHash, computeLockState, hashAgentCases, revealableCases, type LockState } from "./ingest";
import { getLockState, maxRunDurationMs } from "./runs";
import { agentJudgeVersion, judgeAgentTrace } from "./judge";
import { inputShape } from "./define";
import { answerShape } from "./draft";
import { readDefinition, STARTER_KIT_READ_ONLY } from "./edit";
import { CUSTOM_CHECKS } from "./registry";
import {
  agentAudit,
  getAgentHeldout,
  getAgentRun,
  getAgentTrace,
  listAgentAnnotations,
  listAgentApprovals,
  listAgentJudgeResults,
  listAgentRuns,
  listAgentTraces,
  listFrozenVersions,
  saveAgentApproval,
  saveAgentJudgeResults,
} from "./repo";
import type { AgentAnnotation, AgentJudgeResult, AgentRun, AgentTrace, LoadedAgent } from "./schemas";

// ---------------------------------------------------------------------------
// Evaluation of one case
// ---------------------------------------------------------------------------

export function evaluateAgentCase(agent: LoadedAgent, caseId: string, trace: AgentTrace | null, judgeVerdict: AgentJudgeResult["verdict"] | null): CaseEvaluation {
  if (!trace) {
    return {
      case_id: caseId, trace_id: null, execution_mode: null, execution_error: "No trace for this case", results: [], pass_all: null, incomplete: true,
      failed_evaluators: [], critical_failures: [], judge_verdict: judgeVerdict, input_tokens: null, output_tokens: null, latency_ms: null, cost_usd: null, cache_hit: false,
    };
  }
  const results: DeterministicResult[] = runChecks(agent, trace, CUSTOM_CHECKS);
  const failed = results.filter((r) => r.outcome === "FAIL" || r.outcome === "ERROR");
  return {
    case_id: caseId,
    trace_id: trace.trace_id,
    execution_mode: trace.execution_mode,
    execution_error: trace.execution_error,
    results,
    pass_all: passAll(results),
    incomplete: Boolean(trace.execution_error) || results.some((r) => r.outcome === "ERROR"),
    failed_evaluators: failed.map((r) => r.evaluator_id),
    critical_failures: results.filter((r) => r.outcome === "FAIL" && r.severity === "critical").map((r) => r.evaluator_id),
    judge_verdict: judgeVerdict,
    input_tokens: null,
    output_tokens: null,
    latency_ms: trace.latency_ms,
    cost_usd: trace.cost_usd,
    cache_hit: false,
  };
}

/** Current judge version for this agent in the current mode (null = no judge configured). */
export function currentJudgeVersion(agent: LoadedAgent): string | null {
  return agent.config.judge ? agentJudgeVersion(agent.config.name, agent.config.judge, modeInfo().mode) : null;
}

function latestVerdicts(results: AgentJudgeResult[], version: string | null): Map<string, AgentJudgeResult> {
  const m = new Map<string, AgentJudgeResult>();
  if (!version) return m;
  for (const r of results) {
    if (r.judge_version !== version) continue;
    const prev = m.get(r.trace_id);
    if (!prev || prev.created_at < r.created_at) m.set(r.trace_id, r);
  }
  return m;
}

interface Loaded {
  agent: LoadedAgent;
  runs: AgentRun[];
  traces: Map<string, AgentTrace>;
  annotations: AgentAnnotation[];
  judge: Map<string, AgentJudgeResult>;
  judgeVersion: string | null;
}

async function loadAll(agentId: string): Promise<Loaded> {
  const agent = await getAgent(agentId);
  const [runs, traces, annotations, judgeResults] = await Promise.all([
    listAgentRuns(agentId),
    listAgentTraces(agentId),
    listAgentAnnotations(agentId),
    listAgentJudgeResults(agentId),
  ]);
  const judgeVersion = currentJudgeVersion(agent);
  // A run still "running" long after it could possibly finish was interrupted (e.g. the server restarted).
  const now = Date.now();
  for (const r of runs) {
    if (r.status === "running" && now - Date.parse(r.created_at) > maxRunDurationMs(agent, r.case_ids.length)) {
      r.status = "failed";
      r.notes = "Interrupted: the run stopped before every case finished (was the app restarted?). Run it again.";
    }
  }
  return { agent, runs, traces: new Map(traces.map((t) => [t.trace_id, t])), annotations, judge: latestVerdicts(judgeResults, judgeVersion), judgeVersion };
}

function evalRun(l: Loaded, run: AgentRun): CaseEvaluation[] {
  return run.case_ids.map((cid) => {
    const tid = run.trace_ids[cid];
    const trace = tid ? l.traces.get(tid) ?? null : null;
    return evaluateAgentCase(l.agent, cid, trace, trace ? l.judge.get(trace.trace_id)?.verdict ?? null : null);
  });
}

// ---------------------------------------------------------------------------
// Calibration & failure types
// ---------------------------------------------------------------------------

function calibration(l: Loaded) {
  const pairs: CalibrationPair[] = [];
  for (const [traceId, j] of l.judge) {
    const labels = l.annotations.filter((a) => a.trace_id === traceId && a.judge_label !== "not_assessed").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (!labels.length) continue;
    pairs.push({ trace_id: traceId, case_id: j.case_id, human_failure: labels[0].judge_label === "present", judge_verdict: j.verdict });
  }
  const report = calibrationReport(pairs);
  return { ...report, pairs: pairs.length, min_per_class: MIN_PER_CLASS };
}

function failureTypes(annotations: AgentAnnotation[]) {
  const counts = new Map<string, { name: string; count: number; trace_ids: string[]; critical: number }>();
  for (const a of annotations) {
    if (a.task_outcome !== "fail") continue;
    const name = a.failure_type ?? "(not grouped yet)";
    const key = name.toLowerCase();
    const cur = counts.get(key) ?? { name, count: 0, trace_ids: [], critical: 0 };
    cur.count++;
    cur.trace_ids.push(a.trace_id);
    if (a.severity === "critical") cur.critical++;
    counts.set(key, cur);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface RunRow extends AgentRun {
  summary: RunSummary;
  stale: boolean;
}

/** URL value meaning "no baseline" (an empty parameter means "pick the default"). */
export const NO_BASELINE = "none";

/** Labels are compared case- and space-insensitively: "v1", "V1" and "v1 " are the same version. */
export const labelKey = (label: string) => label.trim().toLowerCase();
/** Runs labelled scratch-… (e.g. a test that a check can fail) are never picked as defaults. */
export const isScratch = (label: string) => labelKey(label).startsWith("scratch-");

/**
 * Defaults follow intent, not timestamps. Only completed, non-scratch runs count, and labels match ignoring case and
 * surrounding spaces.
 * - BASELINE = the version you ship: the label of the most recently approved candidate, or else the first label you
 *   imported. Its newest run on the candidate's cases is used.
 * - CANDIDATE = the newest run of the most recently introduced label other than the baseline's. With only one label,
 *   there is no candidate yet.
 * An explicit pick overrides either side; "none" means no baseline.
 */
export function pickDefaults(runs: AgentRun[], candidateId?: string | null, baselineId?: string | null, approvedRunIds: string[] = []) {
  const done = runs.filter((r) => r.status === "completed" && !isScratch(r.agent_version));
  const byNewest = (a: AgentRun, b: AgentRun) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.run_id < b.run_id ? 1 : -1);
  const newest = (xs: AgentRun[]) => [...xs].sort(byNewest)[0] ?? null;
  const firstSeen = new Map<string, string>();
  for (const r of done) {
    const k = labelKey(r.agent_version);
    const prev = firstSeen.get(k);
    if (!prev || r.created_at < prev) firstSeen.set(k, r.created_at);
  }
  const oldestFirst = [...firstSeen.keys()].sort((a, b) => (firstSeen.get(a)! < firstSeen.get(b)! ? -1 : firstSeen.get(a)! > firstSeen.get(b)! ? 1 : a < b ? -1 : 1));
  const ofLabel = (k: string) => done.filter((r) => labelKey(r.agent_version) === k);
  const approvedLabel = [...approvedRunIds]
    .reverse()
    .map((id) => runs.find((r) => r.run_id === id))
    .find((r): r is AgentRun => !!r && firstSeen.has(labelKey(r.agent_version)));
  const explicitBaseline = baselineId && baselineId !== NO_BASELINE ? runs.find((r) => r.run_id === baselineId) ?? null : null;
  const shipLabel = explicitBaseline ? labelKey(explicitBaseline.agent_version) : approvedLabel ? labelKey(approvedLabel.agent_version) : oldestFirst[0];

  let candidate: AgentRun | null = candidateId ? runs.find((r) => r.run_id === candidateId) ?? null : null;
  if (!candidateId) {
    const latestOther = [...oldestFirst].reverse().find((k) => k !== shipLabel);
    candidate = latestOther ? newest(ofLabel(latestOther)) : null;
  }
  let baseline: AgentRun | null = null;
  if (baselineId === NO_BASELINE) baseline = null;
  else if (explicitBaseline) baseline = explicitBaseline;
  else if (shipLabel) {
    const shipRuns = ofLabel(shipLabel).filter((r) => r.run_id !== candidate?.run_id);
    if (candidate && labelKey(candidate.agent_version) === shipLabel) {
      // You picked the shipping version itself as the candidate: compare with the newest other label instead.
      baseline = newest(done.filter((r) => r.frozen_hash === candidate!.frozen_hash && labelKey(r.agent_version) !== shipLabel));
    } else {
      baseline = newest(shipRuns.filter((r) => !candidate || r.frozen_hash === candidate.frozen_hash)) ?? newest(shipRuns);
    }
  }
  return { candidate, baseline };
}

export function evidenceSnapshotHash(
  gateInput: { candidate: { run: AgentRun; evals: CaseEvaluation[] } | null; baseline: { run: AgentRun; evals?: CaseEvaluation[] } | null },
  annotations: AgentAnnotation[],
  defs: AgentCheckDefinition[],
  context: { cases_hash: string; revealed: number } = { cases_hash: "", revealed: 0 },
): string {
  return sha256({
    candidate: gateInput.candidate?.run.run_id ?? null,
    baseline: gateInput.baseline?.run.run_id ?? null,
    baseline_results: gateInput.baseline?.evals?.map((e) => ({ c: e.case_id, r: e.results.map((r) => r.outcome) })) ?? [],
    context,
    defs: defs.map((d) => `${d.evaluator_id}@${d.version}`),
    results: gateInput.candidate?.evals.map((e) => ({ c: e.case_id, r: e.results.map((r) => r.outcome), j: e.judge_verdict })) ?? [],
    annotations: annotations.map((a) => [a.trace_id, a.reviewer, a.task_outcome, a.severity, a.judge_label, a.updated_at]).sort(),
  });
}

async function gateFor(l: Loaded, candidate: AgentRun | null, baseline: AgentRun | null) {
  const defs = checkDefinitions(l.agent);
  const heldout = await getAgentHeldout(l.agent.agent_id);
  const frozen = await listFrozenVersions(l.agent.agent_id);
  const approvals = await listAgentApprovals(l.agent.agent_id);
  const cand = candidate ? { run: candidate, evals: evalRun(l, candidate) } : null;
  const base = baseline ? { run: baseline, evals: evalRun(l, baseline) } : null;
  const candTraceIds = new Set(Object.values(candidate?.trace_ids ?? {}));
  const candidateAnnotations = l.annotations.filter((a) => candTraceIds.has(a.trace_id));
  const cal = calibration(l);
  const lock = computeLockState(l.agent, frozen, heldout);
  const casesHash = hashAgentCases(l.agent.cases);
  const snapshot = evidenceSnapshotHash({ candidate: cand, baseline: base }, candidateAnnotations, defs, { cases_hash: casesHash, revealed: lock.revealed.size });
  const integrity = heldoutIntegrity(l, frozen, heldout);
  const gate: AgentGateResult = evaluateAgentGate({
    agent: {
      name: l.agent.config.name,
      example: l.agent.config.example,
      pass_all_threshold: l.agent.config.pass_all_threshold,
      min_reviewed_traces: l.agent.config.min_reviewed_traces,
      judge_configured: l.agent.config.judge !== null,
    },
    defs,
    // Locked held-out cases are reported once, as heldout_not_revealed — not again as "missing traces".
    all_case_ids: l.agent.cases.filter((c) => !lock.locked.has(c.case_id)).map((c) => c.case_id),
    heldout: {
      exists: l.agent.cases.some((c) => c.split === "heldout"),
      revealed: revealableCases(l.agent, lock).length === 0,
      moved_to_dev_without_reveal: lock.movedToDev,
      removed_without_reveal: integrity.removed,
      used_before_reveal: integrity.used_before_reveal,
    },
    current_cases_hash: casesHash,
    check_gaps: checkGaps(l.agent, lock),
    latest_frozen_hash: frozen[frozen.length - 1]?.content_hash ?? null,
    candidate: cand,
    baseline: base,
    reviewed_trace_count: new Set(l.annotations.map((a) => a.trace_id)).size,
    candidate_annotations: candidateAnnotations,
    judge: { version: l.judgeVersion, calibrated: !cal.insufficient },
    approvals,
    evidence_snapshot_hash: snapshot,
  });
  return { gate, snapshot, defs, heldout, frozen, cal, lock };
}

/** matches_expected checks that can't apply to some (visible) cases because their `expected` lacks the field. */
function checkGaps(agent: LoadedAgent, lock: ReturnType<typeof computeLockState>) {
  return agent.config.checks.flatMap((c) => {
    if (c.type !== "matches_expected" || !c.expected_field) return [];
    const case_ids = agent.cases
      .filter((x) => !lock.locked.has(x.case_id) && x.expected !== undefined && !hasPath(x.expected, c.expected_field))
      .map((x) => x.case_id);
    return case_ids.length ? [{ evaluator_id: c.id, field: c.expected_field, case_ids }] : [];
  });
}

/** Input hash per stored trace (traces never change, so this is computed once per process). */
const traceHashes = new Map<string, string>();
const traceInputHash = (t: AgentTrace) => {
  let h = traceHashes.get(t.trace_id);
  if (!h) traceHashes.set(t.trace_id, (h = caseInputHash(t.input)));
  return h;
};

/**
 * What the lock can't prevent on its own (moving a held-out case into dev is prevented: computeLockState locks it):
 * - removed: a never-revealed held-out case whose id and content are both gone (a WARNING: the final check got smaller);
 * - used_before_reveal: a current held-out case whose content some run already traced before its reveal — e.g. a dev
 *   case promoted to held-out. Clears when the case gets fresh content.
 */
function heldoutIntegrity(l: Loaded, frozen: Awaited<ReturnType<typeof listFrozenVersions>>, heldout: Awaited<ReturnType<typeof getAgentHeldout>>) {
  const revealedAt = new Map(heldout.revealed_cases.map((c) => [c.input_hash, c.revealed_at]));
  const currentIds = new Set(l.agent.cases.map((c) => c.case_id));
  const currentHashes = new Set(l.agent.cases.map((c) => caseInputHash(c.input)));
  const removed = new Set<string>();
  for (const f of frozen) {
    for (const h of f.heldout_cases) {
      if (!revealedAt.has(h.input_hash) && !currentIds.has(h.case_id) && !currentHashes.has(h.input_hash)) removed.add(h.case_id);
    }
  }
  const heldNow = new Map(l.agent.cases.filter((c) => c.split === "heldout").map((c) => [caseInputHash(c.input), c.case_id]));
  const used = new Set<string>();
  for (const run of l.runs) {
    for (const traceId of Object.values(run.trace_ids)) {
      const t = l.traces.get(traceId);
      if (!t) continue;
      const hash = traceInputHash(t);
      const id = heldNow.get(hash);
      if (!id) continue;
      const at = revealedAt.get(hash);
      if (!at || run.created_at < at) used.add(id);
    }
  }
  return { removed: [...removed].sort(), used_before_reveal: [...used].sort() };
}

export async function agentOverview(agentId: string, opts: { candidate?: string | null; baseline?: string | null } = {}) {
  const l = await loadAll(agentId);
  const approvedRunIds = (await listAgentApprovals(agentId)).filter((a) => a.decision === "approved").sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map((a) => a.candidate_run_id);
  const { candidate, baseline } = pickDefaults(l.runs, opts.candidate, opts.baseline, approvedRunIds);
  const { gate, snapshot, defs, heldout, frozen, cal, lock } = await gateFor(l, candidate, baseline);
  const currentHash = hashAgentCases(l.agent.cases);
  const runs: RunRow[] = l.runs.map((r) => ({ ...r, summary: summarizeRun(evalRun(l, r), defs), stale: r.frozen_hash !== currentHash }));
  const conn = l.agent.config.connection;
  const envNames = conn ? referencedEnv(conn.headers) : [];
  const env = agentEnv();
  let unsafe: string | null = null;
  if (conn) {
    try {
      assertSafeConnection(l.agent.agent_id, conn.url, conn.headers);
    } catch (e) {
      unsafe = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    agent: {
      agent_id: l.agent.agent_id,
      name: l.agent.config.name,
      description: l.agent.config.description,
      example: l.agent.config.example,
      pass_all_threshold: l.agent.config.pass_all_threshold,
      min_reviewed_traces: l.agent.config.min_reviewed_traces,
      connection: conn
        ? {
            url: conn.url,
            host: new URL(conn.url).host,
            header_names: Object.keys(conn.headers),
            env_sent: envNames,
            timeout_ms: conn.timeout_ms,
            cost_per_call_usd: conn.cost_per_call_usd,
            missing_env: envNames.filter((n) => !env[n]),
            unsafe,
          }
        : null,
      judge: l.agent.config.judge ? { ...l.agent.config.judge, version: l.judgeVersion } : null,
      /** The top-level output field the agent's rules read the answer from (e.g. "answer"), if any: spreadsheet imports store answers there. */
      answer_field:
        l.agent.config.checks.map((c) => ("field" in c && typeof c.field === "string" ? c.field : "")).find((f) => /^[A-Za-z0-9_-]+$/.test(f)) ?? null,
    },
    checks: defs,
    cases: l.agent.cases.map((c) => ({
      case_id: c.case_id,
      split: c.split,
      has_expected: c.expected !== undefined,
      notes: c.notes ?? null,
      origin: c.origin ?? null,
      locked: lock.locked.has(c.case_id),
      lock_reason: lock.locked.get(c.case_id) ?? null,
    })),
    frozen: { versions: frozen, current_hash: currentHash, changed_since_latest: frozen.length > 0 && frozen[frozen.length - 1].content_hash !== currentHash },
    heldout,
    runs,
    selected: { candidate: candidate?.run_id ?? null, baseline: baseline?.run_id ?? null },
    gate,
    evidence_snapshot_hash: snapshot,
    calibration: cal,
    failure_types: failureTypes(l.annotations),
    reviewed_trace_count: new Set(l.annotations.map((a) => a.trace_id)).size,
    mode: modeInfo().mode,
  };
}

export async function agentsList() {
  const { agents, problems } = await loadAgents();
  const rows = await Promise.all(
    agents.map(async (a) => {
      const [runs, annotations] = await Promise.all([listAgentRuns(a.agent_id), listAgentAnnotations(a.agent_id)]);
      let status: string | null = null;
      try {
        status = (await agentOverview(a.agent_id)).gate.status;
      } catch {
        status = null;
      }
      return {
        agent_id: a.agent_id,
        name: a.config.name,
        description: a.config.description,
        example: a.config.example,
        cases: a.cases.length,
        checks: a.config.checks.length,
        has_connection: a.config.connection !== null,
        has_judge: a.config.judge !== null,
        runs: runs.length,
        reviewed: new Set(annotations.map((x) => x.trace_id)).size,
        status,
      };
    }),
  );
  return { agents: rows, problems };
}

// ---------------------------------------------------------------------------
// Runs, traces, review queue
// ---------------------------------------------------------------------------

export async function agentRunDetail(agentId: string, runId: string) {
  const l = await loadAll(agentId);
  const run = l.runs.find((r) => r.run_id === runId);
  if (!run) return null;
  const defs = checkDefinitions(l.agent);
  const evals = evalRun(l, run);
  const reviewed = new Set(l.annotations.map((a) => a.trace_id));
  return {
    run,
    summary: summarizeRun(evals, defs),
    checks: defs,
    cases: evals.map((e) => ({ ...e, reviewed: e.trace_id ? reviewed.has(e.trace_id) : false })),
  };
}

export async function agentTraceDetail(agentId: string, traceId: string, reviewer?: string | null) {
  const l = await loadAll(agentId);
  const trace = l.traces.get(traceId);
  if (!trace) return null;
  const run = l.runs.find((r) => r.run_id === trace.run_id) ?? null;
  const evaluation = evaluateAgentCase(l.agent, trace.case_id, trace, l.judge.get(traceId)?.verdict ?? null);
  const judgeHistory = (await listAgentJudgeResults(agentId)).filter((j) => j.trace_id === traceId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const lock = computeLockState(l.agent, await listFrozenVersions(agentId), await getAgentHeldout(agentId));
  // An old trace can share its case_id with a case that is now locked: don't reveal that case's expected value.
  const testCase = lock.locked.has(trace.case_id) ? null : l.agent.cases.find((c) => c.case_id === trace.case_id) ?? null;
  return {
    agent: { agent_id: l.agent.agent_id, name: l.agent.config.name, example: l.agent.config.example, judge: l.agent.config.judge, judge_version: l.judgeVersion },
    trace,
    run,
    test_case: testCase,
    checks: checkDefinitions(l.agent),
    evaluation,
    judge_current: l.judge.get(traceId) ?? null,
    judge_history: judgeHistory,
    annotations: l.annotations.filter((a) => a.trace_id === traceId),
    my_annotation: reviewer ? l.annotations.find((a) => a.trace_id === traceId && a.reviewer === reviewer) ?? null : null,
    failure_types: [...new Set(l.annotations.map((a) => a.failure_type).filter((x): x is string => !!x))].sort(),
    queue: reviewQueueFrom(l, run?.run_id ?? null),
  };
}

function reviewQueueFrom(l: Loaded, runId: string | null) {
  const run = runId ? l.runs.find((r) => r.run_id === runId) : l.runs[0];
  if (!run) return { run_id: null, items: [] as Array<{ case_id: string; trace_id: string; reviewed: boolean }> };
  // "Reviewed" uses the gate's rule: labelled, and if the judge flagged it, the judge's question answered too.
  const labelled = new Set(l.annotations.map((a) => a.trace_id));
  const answered = new Set(l.annotations.filter((a) => a.judge_label !== "not_assessed").map((a) => a.trace_id));
  const flagged = (tid: string) => ["FAIL", "REQUIRES_REVIEW", "ERROR"].includes(l.judge.get(tid)?.verdict ?? "");
  return {
    run_id: run.run_id,
    items: Object.entries(run.trace_ids)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([case_id, trace_id]) => ({ case_id, trace_id, reviewed: labelled.has(trace_id) && (!flagged(trace_id) || answered.has(trace_id)) })),
  };
}

export async function agentReviewQueue(agentId: string, runId: string | null) {
  const l = await loadAll(agentId);
  return reviewQueueFrom(l, runId);
}

// ---------------------------------------------------------------------------
// Judge batch
// ---------------------------------------------------------------------------

export class JudgeConfirmationRequired extends Error {
  constructor(public calls: number, public estimated_usd: number) {
    super(
      `This will make ${calls} live judge call(s) to Claude, estimated at about $${estimated_usd.toFixed(2)} (billed to your API key, capped by LIVE_SPEND_CAP_USD). Confirm to run.`,
    );
  }
}

const judgeInFlight = new Set<string>();

export async function judgeRunMissing(agentId: string, runId: string, actor: string, confirm: boolean) {
  const key = `${agentId}:${runId}`;
  if (judgeInFlight.has(key)) throw new JudgeBusyError("The judge is already running on this run. Wait for it to finish.");
  judgeInFlight.add(key);
  try {
    return await judgeRunMissingUnlocked(agentId, runId, actor, confirm);
  } finally {
    judgeInFlight.delete(key);
  }
}

export class JudgeBusyError extends Error {}

async function judgeRunMissingUnlocked(agentId: string, runId: string, actor: string, confirm: boolean) {
  const l = await loadAll(agentId);
  const j = l.agent.config.judge;
  if (!j) throw new Error(`agents/${agentId}/agent.json has no "judge" configured.`);
  const run = l.runs.find((r) => r.run_id === runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const todo = Object.values(run.trace_ids)
    .map((tid) => l.traces.get(tid))
    .filter((t): t is AgentTrace => {
      // Nothing to judge: an errored trace, or an empty answer (unless the agent allows empty answers).
      if (!t || t.execution_error || (!l.agent.config.allow_empty_output && isEmptyOutput(t.output))) return false;
      const current = l.judge.get(t.trace_id);
      return !current || current.verdict === "ERROR"; // no verdict yet, or retry an errored one (rate limit, timeout)
    });
  const live = modeInfo().mode === "live";
  if (live && todo.length > 1 && !confirm) throw new JudgeConfirmationRequired(todo.length, todo.length * judgeCallEstimate(j.model));
  const results: AgentJudgeResult[] = [];
  // Save each verdict as it arrives, so a spend-cap stop or a crash keeps what was already paid for.
  for (const t of todo) {
    const r = await judgeAgentTrace(l.agent.config.name, j, t);
    await saveAgentJudgeResults(agentId, [r]);
    results.push(r);
  }
  await agentAudit(agentId, actor, "judge_batch", { run_id: runId, judged: results.length, mode: live ? "live" : "mock", version: l.judgeVersion });
  return { judged: results.length, errors: results.filter((r) => r.verdict === "ERROR").length };
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export class GateNotEligibleError extends Error {}

export async function recordAgentApproval(agentId: string, body: { approver: string; decision: "approved" | "rejected"; notes: string; candidate_run_id: string; baseline_run_id: string | null; evidence_snapshot_hash: string }) {
  const runs = await listAgentRuns(agentId);
  if (!runs.some((r) => r.run_id === body.candidate_run_id)) throw new GateNotEligibleError(`Run ${body.candidate_run_id} not found.`);
  if (body.baseline_run_id && !runs.some((r) => r.run_id === body.baseline_run_id)) throw new GateNotEligibleError(`Run ${body.baseline_run_id} not found.`);
  // null = the approver chose "no baseline"; it must not silently become the default baseline.
  const ov = await agentOverview(agentId, { candidate: body.candidate_run_id, baseline: body.baseline_run_id ?? NO_BASELINE });
  if (ov.evidence_snapshot_hash !== body.evidence_snapshot_hash) throw new GateNotEligibleError("The evidence changed since you loaded the page. Reload and review again.");
  if (body.decision === "approved" && ov.gate.evaluation_status !== "ELIGIBLE_FOR_DEMO_APPROVAL") {
    throw new GateNotEligibleError(`The gate says ${ov.gate.evaluation_status}; only an eligible candidate can be approved.`);
  }
  const approval: ReleaseApproval = {
    approval_id: newId("appr"),
    approver: body.approver.trim(),
    decision: body.decision,
    notes: body.notes,
    candidate_run_id: body.candidate_run_id,
    // The baseline the gate actually compared against (the default, when none was chosen).
    baseline_run_id: ov.selected.baseline,
    evidence_snapshot_hash: body.evidence_snapshot_hash,
    status_at_approval: ov.gate.evaluation_status,
    created_at: new Date().toISOString(),
  };
  await saveAgentApproval(agentId, approval);
  await agentAudit(agentId, approval.approver, `release_${body.decision}`, { candidate_run_id: body.candidate_run_id, snapshot: body.evidence_snapshot_hash });
  return approval;
}

export { getAgentRun, getAgentTrace };

// ---------------------------------------------------------------------------
// Defining "good": what the rules, AI reviewer and test-case editors need
// ---------------------------------------------------------------------------

/** The latest finished test's answers (what a new rule is tried on, and what drafting learns field names from). */
export async function latestAnswers(agent: LoadedAgent, lock: LockState): Promise<{ run: AgentRun | null; traces: AgentTrace[] }> {
  const run = (await listAgentRuns(agent.agent_id)).filter((r) => r.status === "completed").sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  if (!run) return { run: null, traces: [] };
  const ids = Object.entries(run.trace_ids).filter(([cid]) => !lock.locked.has(cid)).map(([, tid]) => tid);
  const traces = await Promise.all(ids.slice(0, 50).map((tid) => getAgentTrace(agent.agent_id, tid)));
  return { run, traces: traces.filter((t): t is AgentTrace => t !== null) };
}

/**
 * The editable definition. Locked final-exam cases are listed without their input or reference answer: nobody sees
 * them before the audited reveal. The connection is never part of it.
 */
export async function agentDefinition(agentId: string) {
  const d = await readDefinition(agentId);
  const lock = await getLockState(d.agent);
  const { traces } = await latestAnswers(d.agent, lock);
  const frozen = await listFrozenVersions(agentId);
  const visible = d.agent.cases.filter((c) => !lock.locked.has(c.case_id));
  const mode = modeInfo();
  return {
    editable: !d.agent.config.example,
    read_only_reason: d.agent.config.example ? STARTER_KIT_READ_ONLY : null,
    definition_hash: d.hash,
    mode: mode.mode,
    mode_reason: mode.reason,
    rules: d.agent.config.checks,
    judge: d.agent.config.judge,
    answers: answerShape(traces),
    // The shape of practice questions; with none visible, of any question (only the shape, never the content, is returned).
    input_shape: inputShape((visible.some((c) => c.split === "dev") ? visible.filter((c) => c.split === "dev") : d.agent.cases).map((c) => c.input)),
    cases: d.agent.cases.map((c) => {
      const locked = lock.locked.has(c.case_id);
      return {
        case_id: c.case_id,
        split: c.split,
        locked,
        lock_reason: lock.locked.get(c.case_id) ?? null,
        input: locked ? null : c.input,
        expected: locked ? null : c.expected ?? null,
        notes: c.notes ?? null,
        origin: c.origin ?? null,
      };
    }),
    latest_frozen_version: frozen[frozen.length - 1]?.version ?? null,
  };
}
