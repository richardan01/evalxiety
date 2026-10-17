import { connection } from "next/server";
import { fail, handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { agentRunDetail } from "@/lib/agents/services";

/** GET /api/agents/:agentId/runs/:runId → run, summary and per-case check results. */
export async function GET(_req: Request, ctx: RouteContext<"/api/agents/[agentId]/runs/[runId]">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId, runId } = await ctx.params;
      const d = await agentRunDetail(agentId, runId);
      return d ? ok(d) : fail(404, `Run ${runId} not found`);
    }),
  );
}
