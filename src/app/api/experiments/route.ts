import { after, connection } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import { AGENT_CONFIGS } from "@/lib/agent/configs";
import { systemPrompt } from "@/lib/agent/prompts";
import { DETERMINISTIC_EVALUATORS } from "@/lib/evaluators/deterministic";
import { frozenSets, includesHeldout } from "@/lib/experiments/frozen";
import {
  EST_AGENT_CALL_USD,
  EST_JUDGE_CALL_USD,
  HeldoutLockedError,
  PaidBatchConfirmationRequired,
  executeRun,
  prepareRun,
  recoverOrphanedRuns,
  type StartRunOptions,
} from "@/lib/experiments/runner";
import { MODEL_ID, modeInfo } from "@/lib/llm/client";
import { summarizeRun } from "@/lib/metrics/experiments";
import { caseEvaluationsForRun } from "@/lib/services";
import { getHeldoutState, listExperimentRuns, listJudgeResults } from "@/lib/storage/repos";

/** List experiment runs (with deterministic summaries), frozen sets, agent configs and cost estimates. */
export async function GET() {
  await connection();
  return handle(async () => {
    await recoverOrphanedRuns();
    const [runs, judgeResults, heldout] = await Promise.all([listExperimentRuns(), listJudgeResults(), getHeldoutState()]);
    const rows = await Promise.all(
      runs.map(async (run) => {
        const config = AGENT_CONFIGS.find((c) => c.config_id === run.agent_config_id) ?? null;
        const evals = await caseEvaluationsForRun(run, judgeResults);
        return {
          run,
          config_label: config?.label ?? run.agent_config_id,
          config_role: config?.role ?? null,
          progress: { traces_done: Object.keys(run.trace_ids).length, cases: run.case_ids.length },
          summary: summarizeRun(evals),
        };
      }),
    );
    return ok({
      runs: rows,
      frozen_sets: frozenSets().map((s) => ({ ...s, includesHeldout: includesHeldout(s) })),
      agent_configs: AGENT_CONFIGS.map((c) => ({ ...c, system_prompt: systemPrompt(c.prompt_version) })),
      evaluators: DETERMINISTIC_EVALUATORS.map((d) => ({
        evaluator_id: d.evaluator_id,
        version: d.version,
        severity: d.severity,
        failure_mode_id: d.failure_mode_id,
        question: d.question,
        validation_status: d.validation_status,
        blocking: d.blocking,
      })),
      heldout,
      estimate_per_case: { agent: EST_AGENT_CALL_USD, judge: EST_JUDGE_CALL_USD },
      mode: modeInfo(),
      model_id: MODEL_ID,
    });
  });
}

const Body = z.object({
  config_id: z.string().min(1),
  frozen_set_id: z.string().min(1),
  actor: z.string().trim().min(1, "a named person (actor) is required"),
  confirm_paid_batch: z.boolean().optional(),
  run_judge: z.boolean().optional().default(true),
  force_mock: z.boolean().optional(),
});

function mapRunError(err: unknown): Response {
  if (err instanceof PaidBatchConfirmationRequired) return ok({ error: err.message, estimate: err.estimate }, { status: 409 });
  if (err instanceof HeldoutLockedError) return fail(423, err.message);
  if (err instanceof Error) return fail(400, err.message);
  return fail(400, String(err));
}

/** Start an experiment run over a frozen set. Work continues after the response via `after`. */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const raw = await req.json().catch(() => undefined);
    if (raw === undefined) return fail(400, "Request body must be JSON");
    const body = Body.parse(raw);
    const opts: StartRunOptions = {
      config_id: body.config_id,
      frozen_set_id: body.frozen_set_id,
      actor: body.actor,
      confirm_paid_batch: body.confirm_paid_batch,
      run_judge: body.run_judge,
      force_mock: body.force_mock,
    };
    let run;
    try {
      run = await prepareRun(opts);
    } catch (err) {
      return mapRunError(err);
    }
    const started = run;
    after(() => executeRun(started, opts));
    return ok({ run: started });
  });
}
