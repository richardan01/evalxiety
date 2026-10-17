import { connection } from "next/server";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { caseInputHash, revealableCases } from "@/lib/agents/ingest";
import { agentAudit, getAgentHeldout, revealAgentHeldout } from "@/lib/agents/repo";
import { getLockState } from "@/lib/agents/runs";

const Body = z.object({
  actor: z.string().trim().min(1, "actor (your name) is required"),
  reason: z.string().trim().min(10, "reason must be at least 10 characters"),
  /** Exactly the cases the person saw on the button. Refused if the locked set changed since the page loaded. */
  case_ids: z.array(z.string()).min(1, "list the held-out cases to reveal"),
});

/**
 * POST /api/agents/:agentId/heldout — audited, irreversible reveal of the held-out cases listed in case_ids, which must
 * be exactly the cases still locked. Reveals are by content: a case added (or re-written) later stays locked until
 * its own reveal. 409 when nothing is locked or the locked set changed.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/heldout">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      const agent = await getAgent(agentId);
      const body = Body.parse(await req.json().catch(() => null));
      const cur = await getAgentHeldout(agentId);
      const locked = revealableCases(agent, await getLockState(agent));
      if (!locked.length) {
        return fail(409, cur.revealed ? `Every held-out case was already revealed (last by ${cur.revealed_by} at ${cur.revealed_at}); a reveal is irreversible.` : "This agent has no held-out cases.");
      }
      const want = [...new Set(body.case_ids)].sort().join(",");
      const have = locked.map((c) => c.case_id).sort().join(",");
      if (want !== have) {
        return fail(409, `The locked held-out cases changed since the page loaded (now: ${have}). Reload and check what you are revealing.`);
      }
      const state = await revealAgentHeldout(agentId, body.actor, body.reason, locked.map((c) => ({ case_id: c.case_id, input_hash: caseInputHash(c.input) })));
      await agentAudit(agentId, body.actor, "heldout_revealed", { reason: body.reason, case_ids: locked.map((c) => c.case_id) });
      return ok(state);
    }),
  );
}
