import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { agentDefinition } from "@/lib/agents/services";

/**
 * GET /api/agents/:agentId/definition → the rules, AI reviewer question and test cases as the editors show them, with
 * the definition_hash every edit must send back. Locked final-exam cases come without their content.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/agents/[agentId]/definition">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      return ok(await agentDefinition(agentId));
    }),
  );
}
