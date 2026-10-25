import { connection } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { configTextOf, editDefinition, withJudge } from "@/lib/agents/edit";
import { agentJudgeVersion } from "@/lib/agents/judge";
import { AgentJudgeConfig } from "@/lib/agents/schemas";
import { modeInfo } from "@/lib/llm/client";

const Body = z.object({
  actor: z.string().trim().min(1, "a named person (actor) is required"),
  base: z.string().min(1, "reload the page (the editor didn't send which version of the files it was editing)"),
  /** null removes the AI reviewer. */
  judge: AgentJudgeConfig.nullable(),
  drafted_by_ai: z.boolean().default(false),
});

/**
 * POST /api/agents/:agentId/judge-config — set, change or remove the AI reviewer's question. Any change to the
 * question, its definitions or the model is a new reviewer version: its agreement with your labels is measured again
 * from scratch (your labels are kept). → { judge, version, previous_version, definition_hash } · 403 starter kit ·
 * 409 files changed
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/judge-config">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      const body = Body.parse(await req.json().catch(() => null));
      const mode = modeInfo().mode;
      let previous: string | null = null;
      let version: string | null = null;
      const res = await editDefinition(agentId, {
        actor: body.actor,
        base: body.base,
        action: body.judge ? "judge_set" : "judge_removed",
        apply: async (d) => {
          const name = d.agent.config.name;
          previous = d.agent.config.judge ? agentJudgeVersion(name, d.agent.config.judge, mode) : null;
          version = body.judge ? agentJudgeVersion(name, body.judge, mode) : null;
          return { configText: configTextOf(withJudge(d.raw, body.judge)), details: { judge: body.judge, previous_version: previous, version, drafted_by_ai: body.drafted_by_ai } };
        },
      });
      return ok({ judge: body.judge, version, previous_version: previous, definition_hash: res.hash });
    }),
  );
}
