import { connection, type NextRequest } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { agentOverview } from "@/lib/agents/services";

/** GET /api/agents/:agentId[?candidate=run_id&baseline=run_id] → overview, runs, checks, gate verdict. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/agents/[agentId]">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      const sp = req.nextUrl.searchParams;
      return ok(await agentOverview(agentId, { candidate: sp.get("candidate"), baseline: sp.get("baseline") }));
    }),
  );
}
