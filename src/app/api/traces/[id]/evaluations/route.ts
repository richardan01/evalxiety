import { connection, type NextRequest } from "next/server";
import { handle, ok, fail } from "@/lib/api/http";
import { traceEvaluations } from "@/lib/services";
import { DETERMINISTIC_EVALUATORS } from "@/lib/evaluators/deterministic";
import { EST_JUDGE_CALL_USD } from "@/lib/experiments/runner";
import { JUDGE_QUESTION } from "@/lib/judge/judge";
import { modeInfo } from "@/lib/llm/client";
import { getHeldoutState, getTrace } from "@/lib/storage/repos";
import { splitOf } from "@/lib/domain/scenarios";

/**
 * GET /api/traces/[id]/evaluations
 * → {
 *     deterministic: DeterministicResult[],         // the 4 validated code checks, computed now
 *     evaluator_definitions: EvaluatorDefinition[], // plain-language question per check
 *     judge_results: JudgeResult[],                 // newest first; [] while held-out judge results are locked
 *     current_judge_version: string,
 *     judge_question: string,
 *     judge_locked: { reason: string } | null,      // held-out trace before the audited reveal
 *     judge_call: { mode: "live" | "mock", estimated_usd: number }
 *   }
 *
 * The review UI only requests this after the reviewer has saved a label (or explicitly chose to
 * reveal anyway), so automated results cannot anchor the human label.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/traces/[id]/evaluations">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const trace = await getTrace(id);
    if (!trace) return fail(404, `Trace ${id} not found`);
    const evals = await traceEvaluations(id);
    if (!evals) return fail(404, `Trace ${id} not found`);

    // Held-out traces: seeing the judge's verdict next to a human label is a held-out calibration pair.
    // Keep those locked until the audited held-out reveal, exactly like the calibration view.
    const heldout = splitOf(trace.case_id) === "heldout" ? await getHeldoutState() : null;
    const judgeLocked =
      heldout && !heldout.revealed
        ? {
            reason:
              "Held-out case: judge results stay hidden until the audited held-out reveal, so held-out calibration remains untouched.",
          }
        : null;

    const judgeMode = trace.execution_mode === "mock" ? "mock" : modeInfo().mode;
    return ok({
      deterministic: evals.deterministic,
      evaluator_definitions: DETERMINISTIC_EVALUATORS,
      judge_results: judgeLocked ? [] : evals.judge_results,
      current_judge_version: evals.current_judge_version,
      judge_question: JUDGE_QUESTION,
      judge_locked: judgeLocked,
      judge_call: { mode: judgeMode, estimated_usd: judgeMode === "live" ? EST_JUDGE_CALL_USD : 0 },
    });
  });
}
