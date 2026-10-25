import { connection } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { draftRule } from "@/lib/agents/draft";
import { configTextOf, editDefinition, EditError, withoutRule, withRule } from "@/lib/agents/edit";
import { agentAudit } from "@/lib/agents/repo";
import { NotProvenError, previewRule, Probe } from "@/lib/agents/rules";
import { getLockState } from "@/lib/agents/runs";
import { CheckConfig } from "@/lib/agents/schemas";
import { latestAnswers } from "@/lib/agents/services";

const Actor = z.string().trim().min(1, "a named person (actor) is required");
const Base = z.string().min(1, "reload the page (the editor didn't send which version of the files it was editing)");

const Body = z.discriminatedUnion("action", [
  /** Try a rule: its results on the latest (or a chosen) test's answers, and on a bad answer you wrote. Saves nothing. */
  z.object({ action: z.literal("preview"), rule: CheckConfig, probe: Probe.nullable().optional(), run_id: z.string().nullable().optional() }),
  /** Add a rule. Refused (422, with the preview) unless it fails at least once, re-checked here. */
  z.object({
    action: z.literal("add"),
    actor: Actor,
    base: Base,
    rule: CheckConfig,
    probe: Probe.nullable().optional(),
    run_id: z.string().nullable().optional(),
    drafted_by_ai: z.boolean().default(false),
  }),
  z.object({ action: z.literal("remove"), actor: Actor, base: Base, id: z.string().min(1) }),
  /** Ask Claude to turn a plain-English requirement into a rule (or an AI reviewer question). Live mode only; saves nothing. */
  z.object({ action: z.literal("draft"), actor: Actor, request: z.string().trim().min(5, "describe what a good or bad answer does").max(2000), fresh: z.boolean().default(false) }),
]);

/**
 * POST /api/agents/:agentId/rules
 *   preview → { run, results, counts, probe, proven, proven_by, warnings }
 *   add     → 201 { rule, proven_by, definition_hash } · 422 { error, preview } if it never failed · 409 files changed
 *   remove  → { removed, definition_hash }
 *   draft   → { kind: "rule" | "ai_reviewer" | "unclear", … , cost_usd } · 400 in mock mode · 402 spend cap
 * Edits are refused (403) for the starter kit.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/rules">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      const body = Body.parse(await req.json().catch(() => null));
      switch (body.action) {
        case "preview": {
          const agent = await getAgent(agentId);
          return ok(await previewRule(agent, await getLockState(agent), body.rule, { run_id: body.run_id, probe: body.probe }));
        }
        case "add": {
          const res = await editDefinition(agentId, {
            actor: body.actor,
            base: body.base,
            action: "rule_added",
            apply: async (d) => {
              const next = withRule(d.raw, body.rule); // a taken name or a custom rule is refused before anything runs
              const preview = await previewRule(d.agent, await getLockState(d.agent), body.rule, { run_id: body.run_id, probe: body.probe });
              if (!preview.proven) throw new NotProvenError(preview);
              return {
                configText: configTextOf(next),
                details: {
                  rule: body.rule,
                  proven_by: preview.proven_by,
                  // What it was proven on, so a reviewer can judge the proof: the bad answer as written (it's the person's own text).
                  probe_answer: preview.proven_by?.kind === "probe" ? body.probe!.answer.slice(0, 500) : null,
                  drafted_by_ai: body.drafted_by_ai,
                },
              };
            },
          });
          return ok({ rule: body.rule, proven_by: res.details.proven_by, definition_hash: res.hash }, { status: 201 });
        }
        case "remove": {
          const res = await editDefinition(agentId, {
            actor: body.actor,
            base: body.base,
            action: "rule_removed",
            apply: async (d) => {
              const rule = d.agent.config.checks.find((c) => c.id === body.id);
              return { configText: configTextOf(withoutRule(d.raw, body.id)), details: { rule: rule ?? { id: body.id } } };
            },
          });
          return ok({ removed: body.id, definition_hash: res.hash });
        }
        case "draft": {
          const agent = await getAgent(agentId);
          if (agent.config.example) throw new EditError("This is the starter kit: connect your own agent to draft rules for it.", 403);
          const lock = await getLockState(agent);
          const { traces } = await latestAnswers(agent, lock);
          const draft = await draftRule(agent, lock, body.request, traces, body.fresh);
          await agentAudit(agentId, body.actor, "rule_drafted_by_ai", { request: body.request, kind: draft.kind, cost_usd: draft.cost_usd });
          return ok(draft);
        }
      }
    }),
  );
}
