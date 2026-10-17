import { connection } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { freezeNewVersion } from "@/lib/agents/runs";

const Body = z.object({
  actor: z.string().trim().min(1, "a named person (actor) is required"),
  note: z.string().trim().min(3, "say what changed in the cases"),
});

/** POST /api/agents/:agentId/freeze — pin the current cases.jsonl as a new frozen version (audited). */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/freeze">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      const body = Body.parse(await req.json().catch(() => null));
      return ok(await freezeNewVersion(await getAgent(agentId), body.actor, body.note));
    }),
  );
}
