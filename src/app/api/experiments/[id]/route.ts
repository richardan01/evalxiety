import { connection, type NextRequest } from "next/server";
import { handle, ok, fail } from "@/lib/api/http";
import { runDetail } from "@/lib/services";
import { getExperimentRun } from "@/lib/storage/repos";

/** One run with per-case deterministic evaluations and its summary. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/experiments/[id]">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const run = await getExperimentRun(id);
    if (!run) return fail(404, `Experiment run ${id} not found`);
    return ok(await runDetail(run));
  });
}
