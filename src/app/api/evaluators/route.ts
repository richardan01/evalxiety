import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import type { Trace } from "@/lib/domain/schemas";
import { splitOf } from "@/lib/domain/scenarios";
import { DETERMINISTIC_EVALUATORS, evaluateTrace } from "@/lib/evaluators/deterministic";
import { JUDGE_ID, JUDGE_PROMPT_VERSION, JUDGE_QUESTION, buildJudgeSystemPrompt, judgeVersion } from "@/lib/judge/judge";
import { latestJudgeByTrace } from "@/lib/services";
import { latestRubric, listJudgeResults, listTraces } from "@/lib/storage/repos";
import type { EvaluatorCell, EvaluatorsResponse, JudgeCell } from "@/app/evaluators/types";

const Query = z.object({ run_id: z.string().trim().min(1).max(200).optional() });

/** Run all deterministic checks; a crash in one trace becomes ERROR outcomes for that trace, not a failed request. */
function deterministicCells(trace: Trace): EvaluatorCell[] {
  try {
    return evaluateTrace(trace).map(({ evaluator_id, evaluator_version, outcome, severity, summary, details }) => ({
      evaluator_id,
      evaluator_version,
      outcome,
      severity,
      summary,
      details,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return DETERMINISTIC_EVALUATORS.map((d) => ({
      evaluator_id: d.evaluator_id,
      evaluator_version: d.version,
      outcome: "ERROR" as const,
      severity: d.severity,
      summary: `Evaluator could not run on this trace: ${message}`,
      details: { error: message },
    }));
  }
}

/**
 * Evaluator definitions + deterministic results (recomputed from each stored trace) + the latest
 * experimental judge result per trace under the current judge version. Optional ?run_id= filter.
 */
export async function GET(req: NextRequest) {
  await connection();
  return handle(async () => {
    const { run_id } = Query.parse({ run_id: req.nextUrl.searchParams.get("run_id") || undefined });
    const [traces, judgeResults, rubric] = await Promise.all([listTraces(), listJudgeResults(), latestRubric()]);
    const criterion = rubric.judge_criterion;
    const latest = latestJudgeByTrace(judgeResults, traces, criterion, rubric.judge_model);
    const runIds = [...new Set(traces.map((t) => t.experiment_run_id).filter((x): x is string => Boolean(x)))].sort();
    const scoped = run_id ? traces.filter((t) => t.experiment_run_id === run_id) : traces;

    const body: EvaluatorsResponse = {
      deterministic: DETERMINISTIC_EVALUATORS,
      judge: {
        id: JUDGE_ID,
        question: JUDGE_QUESTION,
        system_prompt: buildJudgeSystemPrompt(criterion),
        prompt_version: JUDGE_PROMPT_VERSION,
        live_version: judgeVersion("live", criterion, rubric.judge_model),
        mock_version: judgeVersion("mock", criterion, rubric.judge_model),
        model: rubric.judge_model,
        status: "experimental",
      },
      results: scoped.map((t) => {
        const j = latest.get(t.trace_id);
        const judge: JudgeCell | null = j
          ? {
              judge_result_id: j.judge_result_id,
              judge_version: j.judge_version,
              model_id: j.model_id,
              verdict: j.verdict,
              output: j.output,
              error: j.error,
              execution_mode: j.execution_mode,
              created_at: j.created_at,
            }
          : null;
        return {
          trace_id: t.trace_id,
          case_id: t.case_id,
          agent_version: t.agent_version,
          execution_mode: t.execution_mode,
          experiment_run_id: t.experiment_run_id,
          timestamp: t.timestamp,
          split: splitOf(t.case_id),
          execution_error: t.execution_error,
          deterministic: deterministicCells(t),
          judge,
        };
      }),
      run_ids: runIds,
      filter: { run_id: run_id ?? null },
    };
    return ok(body);
  });
}
