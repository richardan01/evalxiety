import { connection } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { nextCaseIds } from "@/lib/agents/define";
import { draftCases } from "@/lib/agents/draft";
import { editDefinition, EditError, withCaseRemoved, withCaseReplaced, withCasesAdded } from "@/lib/agents/edit";
import { hashAgentCases } from "@/lib/agents/ingest";
import { agentAudit, listFrozenVersions } from "@/lib/agents/repo";
import { getLockState } from "@/lib/agents/runs";
import type { AgentCase } from "@/lib/agents/schemas";

const Actor = z.string().trim().min(1, "a named person (actor) is required");
const Base = z.string().min(1, "reload the page (the editor didn't send which version of the files it was editing)");
const Input = z.unknown().refine((v) => v !== undefined && v !== null && v !== "", "write the question (input)").refine((v) => JSON.stringify(v).length <= 20_000, "the input is longer than 20,000 characters");
const Expected = z.unknown().refine((v) => v === undefined || v === null || JSON.stringify(v).length <= 20_000, "the reference answer is longer than 20,000 characters");
const Notes = z.string().trim().max(500).optional();

const NewCase = z.object({
  input: Input,
  expected: Expected.optional(),
  notes: Notes,
  /** heldout = a final-exam case: locked from the next lock on, until an audited reveal. */
  split: z.enum(["dev", "heldout"]).default("dev"),
  /** Set when Claude proposed the input and this person accepted it. */
  origin: z.enum(["ai_drafted"]).optional(),
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), actor: Actor, base: Base, cases: z.array(NewCase).min(1).max(50) }),
  /** Change a case's input, reference answer or note. Its split and where it came from stay as they are. */
  z.object({ action: z.literal("update"), actor: Actor, base: Base, case_id: z.string().min(1), input: Input, expected: Expected.optional(), notes: Notes }),
  z.object({ action: z.literal("remove"), actor: Actor, base: Base, case_id: z.string().min(1) }),
  /** Ask Claude for new practice questions like the existing ones. Live mode only; saves nothing. */
  z.object({ action: z.literal("draft"), actor: Actor, request: z.string().trim().max(1000).default(""), count: z.number().int().min(1).max(10).default(5), fresh: z.boolean().default(false) }),
]);

const blank = (v: unknown) => v === undefined || v === null || v === "";

/**
 * POST /api/agents/:agentId/cases
 *   add    → 201 { added: [case_id], definition_hash, needs_lock, next_version }
 *   update → { updated, … } · remove → { removed, … } (needs_lock: lock the new set as next_version before the next test)
 *   draft  → { drafts: [{ input, notes }], shape, cost_usd } · 400 in mock mode · 402 spend cap
 * 423 for a locked final-exam case (it can't be seen, changed or removed before its reveal) · 409 files changed ·
 * 403 the starter kit. Changing what a case asks or expects means locking the cases as a new version before the next
 * test, so old and new results are never compared as if they were on the same questions.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/cases">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      const body = Body.parse(await req.json().catch(() => null));
      if (body.action === "draft") {
        const agent = await getAgent(agentId);
        if (agent.config.example) throw new EditError("This is the starter kit: connect your own agent to draft questions for it.", 403);
        const res = await draftCases(agent, await getLockState(agent), body.request, body.count, body.fresh);
        await agentAudit(agentId, body.actor, "cases_drafted_by_ai", { request: body.request, proposed: res.drafts.length, cost_usd: res.cost_usd });
        return ok(res);
      }
      const res = await editDefinition(agentId, {
        actor: body.actor,
        base: body.base,
        action: `case_${body.action === "add" ? "added" : body.action === "update" ? "updated" : "removed"}`,
        apply: async (d) => {
          const lock = await getLockState(d.agent);
          if (body.action === "add") {
            const ids = nextCaseIds(d.agent.cases.map((c) => c.case_id), body.cases.length);
            const cases: AgentCase[] = body.cases.map((c, i) => ({
              case_id: ids[i],
              input: c.input as AgentCase["input"],
              split: c.split,
              ...(blank(c.expected) ? {} : { expected: c.expected }),
              ...(c.notes ? { notes: c.notes } : {}),
              ...(c.origin ? { origin: c.origin } : {}),
            }));
            return {
              casesText: withCasesAdded(d.casesText, cases),
              details: { case_ids: ids, heldout: cases.filter((c) => c.split === "heldout").map((c) => c.case_id), ai_drafted: cases.filter((c) => c.origin).map((c) => c.case_id) },
            };
          }
          const current = d.agent.cases.find((c) => c.case_id === body.case_id);
          if (!current) throw new EditError(`There is no test case "${body.case_id}".`, 404);
          if (lock.locked.has(body.case_id)) {
            throw new EditError(`"${body.case_id}" is a locked final-exam case: it can't be changed or removed before it's unlocked, so nobody sees it early.`, 423);
          }
          if (body.action === "remove") return { casesText: withCaseRemoved(d.casesText, body.case_id), details: { case_id: body.case_id, split: current.split } };
          const next: AgentCase = {
            case_id: current.case_id,
            split: current.split,
            input: body.input as AgentCase["input"],
            ...(blank(body.expected) ? {} : { expected: body.expected }),
            ...(body.notes ? { notes: body.notes } : {}),
            ...(current.origin ? { origin: current.origin } : {}),
          };
          const changed = (["input", "expected", "notes"] as const).filter((k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(next[k] ?? null));
          return { casesText: withCaseReplaced(d.casesText, next), details: { case_id: current.case_id, changed } };
        },
      });
      const key = body.action === "add" ? "added" : body.action === "update" ? "updated" : "removed";
      const value = body.action === "add" ? (res.details.case_ids as string[]) : body.case_id;
      // Tests already ran on a locked set and the questions changed: the next test needs the new set locked first.
      const latest = (await listFrozenVersions(agentId)).at(-1);
      const needsLock = latest !== undefined && latest.content_hash !== hashAgentCases(res.agent.cases);
      return ok({ [key]: value, definition_hash: res.hash, needs_lock: needsLock, next_version: needsLock ? latest.version + 1 : null }, { status: body.action === "add" ? 201 : 200 });
    }),
  );
}
