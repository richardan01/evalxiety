import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import { HeldoutLockedError, PaidBatchConfirmationRequired, judgeMissing } from "@/lib/experiments/runner";
import { getExperimentRun } from "@/lib/storage/repos";

const Body = z.object({
  actor: z.string().trim().min(1, "a named person (actor) is required"),
  confirm_paid_batch: z.boolean().optional(),
});

function mapRunError(err: unknown): Response {
  if (err instanceof PaidBatchConfirmationRequired) return ok({ error: err.message, estimate: err.estimate }, { status: 409 });
  if (err instanceof HeldoutLockedError) return fail(423, err.message);
  if (err instanceof Error) return fail(400, err.message);
  return fail(400, String(err));
}

/** Run the EXPERIMENTAL judge on every trace of a run that lacks a result for the current judge version. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/experiments/[id]/judge">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const raw = await req.json().catch(() => undefined);
    if (raw === undefined) return fail(400, "Request body must be JSON");
    const body = Body.parse(raw);
    const run = await getExperimentRun(id);
    if (!run) return fail(404, `Experiment run ${id} not found`);
    // The runner judges each trace as it is produced; judging concurrently could double-spend.
    if (run.status === "running") return fail(400, "This run is still in progress — wait for it to finish before judging missing traces");
    try {
      const result = await judgeMissing(id, { actor: body.actor, confirm_paid_batch: body.confirm_paid_batch });
      return ok({ run_id: id, ...result });
    } catch (err) {
      return mapRunError(err);
    }
  });
}
