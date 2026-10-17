import { connection } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { judgeRunMissing } from "@/lib/agents/services";

const Body = z.object({
  run_id: z.string().min(1),
  actor: z.string().trim().min(1, "a named person (actor) is required"),
  confirm: z.boolean().optional().default(false),
});

/** POST /api/agents/:agentId/judge — judge every trace in a run that has no current-version verdict. 409 = confirm live batch. */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/judge">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      const body = Body.parse(await req.json().catch(() => null));
      return ok(await judgeRunMissing(agentId, body.run_id, body.actor, body.confirm));
    }),
  );
}
