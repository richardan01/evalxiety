/**
 * Experiment execution over frozen sets, with credit controls:
 *  - held-out cases cannot be run until held-out access has been explicitly revealed (logged);
 *  - live multi-case batches require explicit confirmation of an estimated cost;
 *  - cached responses are reused, so re-running identical cases costs nothing.
 */
import { DEFAULT_JUDGE_MODEL, JUDGE_MODELS } from "../rubric/rubric";
import type { ExperimentRun, Trace } from "../domain/schemas";
import { getScenario } from "../domain/scenarios";
import { getAgentConfig } from "../agent/configs";
import { runPricingAgent } from "../agent/runner";
import { judgeVersion, runJudge } from "../judge/judge";
import { modeInfo } from "../llm/client";
import { getFrozenSet, includesHeldout, verifyFrozenSet } from "./frozen";
import { pool } from "./pool";
import {
  audit,
  getExperimentRun,
  getHeldoutState,
  getTrace,
  listExperimentRuns,
  listJudgeResults,
  latestRubric,
  saveExperimentRun,
  saveJudgeResult,
} from "../storage/repos";
import { newId, withLock } from "../storage/store";

/** Rough per-call estimates (not a bound — long outputs can exceed them) for Claude Opus 5.5 at medium effort (input $4/M, output $20/M). */
export const EST_AGENT_CALL_USD = 0.07;
export const EST_JUDGE_CALL_USD = 0.045; // on Claude Opus 5.5

/** Rough judge-call estimate for a model, scaled from the Opus figure by output price. */
export function judgeCallEstimate(model: string): number {
  const m = JUDGE_MODELS.find((x) => x.id === model);
  return m ? EST_JUDGE_CALL_USD * (m.output_per_m / 20) : EST_JUDGE_CALL_USD;
}

export class HeldoutLockedError extends Error {}
export class PaidBatchConfirmationRequired extends Error {
  constructor(public estimate: BatchEstimate) {
    super(
      `Live batch of ${estimate.agent_calls + estimate.judge_calls} call(s), estimated at roughly $${estimate.estimated_max_usd.toFixed(2)}. Re-submit with confirm_paid_batch=true to proceed.`,
    );
  }
}

export interface BatchEstimate {
  mode: "live" | "mock";
  agent_calls: number;
  judge_calls: number;
  estimated_max_usd: number;
  note: string;
}

export function estimateBatch(nCases: number, withJudge: boolean, judgeModel: string = DEFAULT_JUDGE_MODEL): BatchEstimate {
  const mode = modeInfo().mode;
  const judgeCalls = withJudge ? nCases : 0;
  return {
    mode,
    agent_calls: nCases,
    judge_calls: judgeCalls,
    estimated_max_usd: mode === "live" ? nCases * EST_AGENT_CALL_USD + judgeCalls * judgeCallEstimate(judgeModel) : 0,
    note:
      mode === "live"
        ? "Rough estimate before cache hits; responses already cached for identical prompts cost $0."
        : "Mock mode: no API calls, no spend.",
  };
}

async function assertHeldoutAccess(caseIds: string[]) {
  const set = { case_ids: caseIds } as Parameters<typeof includesHeldout>[0];
  if (includesHeldout(set)) {
    const state = await getHeldoutState();
    if (!state.revealed) {
      throw new HeldoutLockedError(
        "This set includes held-out cases. Reveal held-out access first (Evaluators → Judge calibration → Reveal held-out) — the reveal is audited and irreversible; do not tune prompts or the judge afterwards.",
      );
    }
  }
}

async function patchRun(runId: string, patch: (r: ExperimentRun) => ExperimentRun) {
  await withLock(`experiments/${runId}.json`, async () => {
    const current = await getExperimentRun(runId);
    if (current) await saveExperimentRun(patch(current));
  });
}

export interface StartRunOptions {
  config_id: string;
  frozen_set_id: string;
  actor: string;
  confirm_paid_batch?: boolean;
  run_judge?: boolean;
  force_mock?: boolean;
  bypass_cache?: boolean;
}

/** Validates and creates the run record; call executeRun (e.g. via next/server `after`) to do the work. */
export async function prepareRun(opts: StartRunOptions): Promise<ExperimentRun> {
  getAgentConfig(opts.config_id);
  const set = getFrozenSet(opts.frozen_set_id);
  if (!set) throw new Error(`Unknown frozen set ${opts.frozen_set_id}`);
  if (!verifyFrozenSet(set)) throw new Error(`Frozen set ${set.frozen_set_id} content changed — refusing to run`);
  await assertHeldoutAccess(set.case_ids);
  const estimate = estimateBatch(set.case_ids.length, opts.run_judge !== false, (await latestRubric()).judge_model);
  const mode = opts.force_mock ? "mock" : estimate.mode;
  if (mode === "live" && set.case_ids.length > 1 && !opts.confirm_paid_batch) {
    throw new PaidBatchConfirmationRequired(estimate);
  }
  const run: ExperimentRun = {
    run_id: newId("run"),
    created_at: new Date().toISOString(),
    completed_at: null,
    agent_config_id: opts.config_id,
    frozen_set_id: set.frozen_set_id,
    frozen_set_hash: set.content_hash,
    case_ids: set.case_ids,
    execution_mode: mode,
    status: "running",
    trace_ids: {},
    notes: null,
  };
  await saveExperimentRun(run);
  await audit(opts.actor, "experiment.started", {
    run_id: run.run_id,
    config_id: opts.config_id,
    frozen_set_id: set.frozen_set_id,
    execution_mode: mode,
    estimate,
  });
  return run;
}

/** Runs executing in THIS server process. A "running" run absent from here was orphaned by a restart. */
const activeRuns = new Set<string>();

/** Mark runs left "running" by a previous server process as failed (completed cases stay cached). */
export async function recoverOrphanedRuns(): Promise<number> {
  const runs = await listExperimentRuns();
  let n = 0;
  for (const r of runs) {
    if (r.status === "running" && !activeRuns.has(r.run_id) && Date.now() - Date.parse(r.created_at) > 120_000) {
      await patchRun(r.run_id, (x) => ({
        ...x,
        status: "failed",
        completed_at: new Date().toISOString(),
        notes: "Interrupted: the server stopped while this run was executing. Re-run it — completed live responses are cached and cost nothing.",
      }));
      n++;
    }
  }
  return n;
}

export async function executeRun(run: ExperimentRun, opts: StartRunOptions): Promise<void> {
  activeRuns.add(run.run_id);
  try {
    await pool(run.case_ids, 3, async (caseId) => {
      const scenario = getScenario(caseId)!;
      const trace = await runPricingAgent(scenario, run.agent_config_id, {
        experimentRunId: run.run_id,
        forceMock: run.execution_mode === "mock",
        bypassCache: opts.bypass_cache,
      });
      await patchRun(run.run_id, (r) => ({ ...r, trace_ids: { ...r.trace_ids, [caseId]: trace.trace_id } }));
      if (opts.run_judge !== false) {
        const judged = await runJudge(trace, { forceMock: run.execution_mode === "mock" });
        await saveJudgeResult(judged);
      }
    });
    await patchRun(run.run_id, (r) => ({ ...r, status: "completed", completed_at: new Date().toISOString() }));
    await audit(opts.actor, "experiment.completed", { run_id: run.run_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patchRun(run.run_id, (r) => ({ ...r, status: "failed", completed_at: new Date().toISOString(), notes: message }));
    await audit(opts.actor, "experiment.failed", { run_id: run.run_id, error: message });
  } finally {
    activeRuns.delete(run.run_id);
  }
}

/** Judge every trace of a run that lacks a result for the current judge version. */
export interface JudgeMissingResult {
  judged: number;
  skipped: number;
  already_current: number;
  skipped_live_in_mock_mode: number;
}

/** Serialised per run, so two concurrent clicks cannot judge (and pay for) the same traces twice. */
export async function judgeMissing(
  runId: string,
  opts: { actor: string; confirm_paid_batch?: boolean },
): Promise<JudgeMissingResult> {
  return withLock(`judge-batch/${runId}`, () => judgeMissingUnlocked(runId, opts));
}

async function judgeMissingUnlocked(
  runId: string,
  opts: { actor: string; confirm_paid_batch?: boolean },
): Promise<JudgeMissingResult> {
  const run = await getExperimentRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  const existing = await listJudgeResults();
  const { judge_criterion: criterion, judge_model: judgeModel } = await latestRubric();
  const traces = (await Promise.all(Object.values(run.trace_ids).map((id) => getTrace(id)))).filter(
    (t): t is Trace => t !== null,
  );
  const todo = traces.filter(
    (t) =>
      !existing.some(
        (j) => j.trace_id === t.trace_id && j.judge_version === judgeVersion(t.execution_mode === "mock" ? "mock" : "live", criterion, judgeModel),
      ),
  );
  const live = todo.filter((t) => t.execution_mode === "live");
  const mode = modeInfo().mode;
  // A live trace can only be judged by the live judge; mock-judging it would create results that never count.
  const runnable = mode === "live" ? todo : todo.filter((t) => t.execution_mode === "mock");
  if (mode === "live" && live.length > 1 && !opts.confirm_paid_batch) {
    throw new PaidBatchConfirmationRequired({
      mode: "live",
      agent_calls: 0,
      judge_calls: live.length,
      estimated_max_usd: live.length * judgeCallEstimate(judgeModel),
      note: "Rough estimate before cache hits; judge responses already cached for identical prompts cost $0.",
    });
  }
  await pool(runnable, 3, async (t) => {
    await saveJudgeResult(await runJudge(t, { criterion, model: judgeModel }));
  });
  await audit(opts.actor, "judge.batch", { run_id: runId, judged: runnable.length, skipped_live_in_mock_mode: todo.length - runnable.length });
  return {
    judged: runnable.length,
    skipped: traces.length - runnable.length,
    already_current: traces.length - todo.length,
    skipped_live_in_mock_mode: todo.length - runnable.length,
  };
}
