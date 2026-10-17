import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { listAgentAudit } from "@/lib/agents/repo";

/** GET /api/agents/:agentId/audit → { events } (newest first). */
export async function GET(_req: Request, ctx: RouteContext<"/api/agents/[agentId]/audit">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      await getAgent(agentId);
      return ok({ events: (await listAgentAudit(agentId)).reverse() });
    }),
  );
}
