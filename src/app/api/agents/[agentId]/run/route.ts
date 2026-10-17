import { after, connection } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { executeHttpRun, prepareHttpRun } from "@/lib/agents/runs";

const Body = z.object({
  agent_version: z.string().trim().min(1, "name the version you are running (e.g. prompt-v2)").max(100),
  actor: z.string().trim().min(1, "a named person (actor) is required"),
  confirm_batch: z.boolean().optional().default(false),
  case_ids: z.array(z.string()).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/agents/:agentId/run — call the agent's HTTP endpoint once per visible case.
 * 202 { run } (status "running"; poll GET /api/agents/:agentId) · 409 { confirmation_required, estimate } for a
 * batch without confirm_batch · 400 missing env var / no connection · 409 cases changed since the last freeze
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/run">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      const body = Body.parse(await req.json().catch(() => null));
      const agent = await getAgent(agentId);
      const prepared = await prepareHttpRun({ agent, agent_version: body.agent_version, actor: body.actor, confirm_batch: body.confirm_batch, case_ids: body.case_ids, notes: body.notes ?? null });
      after(() => executeHttpRun(agent, prepared, body.actor));
      return ok({ run: prepared.run }, { status: 202 });
    }),
  );
}
