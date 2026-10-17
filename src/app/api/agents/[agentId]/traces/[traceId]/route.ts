import { connection, type NextRequest } from "next/server";
import { fail, handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { agentTraceDetail } from "@/lib/agents/services";

/** GET /api/agents/:agentId/traces/:traceId[?reviewer=name] → trace, case, checks, judge, human labels, queue. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/agents/[agentId]/traces/[traceId]">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId, traceId } = await ctx.params;
      const d = await agentTraceDetail(agentId, traceId, req.nextUrl.searchParams.get("reviewer"));
      return d ? ok(d) : fail(404, `Trace ${traceId} not found`);
    }),
  );
}
