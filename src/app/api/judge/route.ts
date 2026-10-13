import { connection } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import { splitOf } from "@/lib/domain/scenarios";
import { LiveTraceNeedsLiveJudgeError, runJudge } from "@/lib/judge/judge";
import { SpendCapError } from "@/lib/llm/client";
import { audit, getHeldoutState, getTrace, saveJudgeResult } from "@/lib/storage/repos";

const Body = z.object({
  trace_id: z.string().min(1),
  actor: z.string().trim().min(1, "A named actor is required (spend and judge runs are audited)"),
});

/**
 * POST /api/judge — run the EXPERIMENTAL unsupported_pricing_justification judge on ONE trace.
 * body: { trace_id: string, actor: string }
 * → 200 { judge_result: JudgeResult }   (label_source "llm_judge" — never a gold label)
 *   404 unknown trace · 409 held-out trace before the audited reveal · 402 live spend cap reached
 * Live traces in live mode make one Claude API call (cached responses cost $0); mock traces use the mock judge.
 */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = Body.parse(await req.json().catch(() => null));
    const trace = await getTrace(body.trace_id);
    if (!trace) return fail(404, `Trace ${body.trace_id} not found`);

    if (splitOf(trace.case_id) === "heldout" && !(await getHeldoutState()).revealed) {
      return fail(
        409,
        "Held-out case: the judge cannot be run on held-out traces before the audited held-out reveal (Evaluators → Judge calibration → Reveal held-out).",
      );
    }

    let result;
    try {
      result = await runJudge(trace);
    } catch (err) {
      if (err instanceof SpendCapError) return fail(402, err.message);
      if (err instanceof LiveTraceNeedsLiveJudgeError) return fail(400, err.message);
      throw err;
    }
    await saveJudgeResult(result);
    await audit(body.actor, "judge.run", {
      judge_result_id: result.judge_result_id,
      trace_id: trace.trace_id,
      case_id: trace.case_id,
      judge_version: result.judge_version,
      verdict: result.verdict,
      execution_mode: result.execution_mode,
      error: result.error,
    });
    return ok({ judge_result: result });
  });
}
