import { connection } from "next/server";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { agentAudit, getAgentTrace, upsertAgentAnnotation } from "@/lib/agents/repo";
import { Severity } from "@/lib/domain/schemas";

const Body = z.object({
  trace_id: z.string().min(1),
  reviewer: z.string().trim().min(1, "a named reviewer is required"),
  task_outcome: z.enum(["pass", "fail"]),
  notes: z.string().max(5000).default(""),
  first_failure: z.string().max(2000).nullable().default(null),
  failure_type: z.string().max(120).nullable().default(null),
  severity: Severity.nullable().default(null),
  judge_label: z.enum(["present", "absent", "not_assessed"]).default("not_assessed"),
});

/** POST /api/agents/:agentId/annotations — upsert a HUMAN label (one per trace × reviewer). */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/annotations">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      await getAgent(agentId);
      const body = Body.parse(await req.json().catch(() => null));
      const trace = await getAgentTrace(agentId, body.trace_id);
      if (!trace) return fail(404, `Trace ${body.trace_id} not found`);
      try {
        const res = await upsertAgentAnnotation({ ...body, agent_id: agentId, case_id: trace.case_id, run_id: trace.run_id });
        await agentAudit(agentId, body.reviewer, res.created ? "annotation_created" : "annotation_updated", { trace_id: body.trace_id, task_outcome: body.task_outcome });
        return ok(res, { status: res.created ? 201 : 200 });
      } catch (e) {
        return fail(400, e instanceof Error ? e.message : String(e));
      }
    }),
  );
}
