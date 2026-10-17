import { connection } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { recordAgentApproval } from "@/lib/agents/services";

const Body = z.object({
  approver: z.string().trim().min(1, "a named approver is required"),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().max(5000).default(""),
  candidate_run_id: z.string().min(1),
  baseline_run_id: z.string().min(1).nullable(),
  evidence_snapshot_hash: z.string().min(1),
});

/** POST /api/agents/:agentId/approve — record a named human's release decision on this exact evidence. */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/approve">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      return ok({ approval: await recordAgentApproval(agentId, Body.parse(await req.json().catch(() => null))) }, { status: 201 });
    }),
  );
}
