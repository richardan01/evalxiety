import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import { releaseView } from "@/lib/services";

const Query = z.object({
  candidate: z.string().trim().optional().transform((v) => v || undefined),
  baseline: z.string().trim().optional().transform((v) => v || undefined),
});

/** GET /api/release?candidate=&baseline= — release gate view. Omitted ids default to the latest completed FROZEN-FULL-v1 runs. */
export async function GET(req: NextRequest) {
  await connection();
  return handle(async () => {
    const sp = req.nextUrl.searchParams;
    const q = Query.parse({ candidate: sp.get("candidate") ?? undefined, baseline: sp.get("baseline") ?? undefined });
    const view = await releaseView({ candidate_run_id: q.candidate, baseline_run_id: q.baseline });
    if (q.candidate && !view.candidate_run) return fail(404, `Candidate run ${q.candidate} not found`);
    if (q.baseline && !view.baseline_run) return fail(404, `Baseline run ${q.baseline} not found`);
    return ok(view);
  });
}
