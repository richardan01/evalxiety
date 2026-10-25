import { connection } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent, validateDefinition } from "@/lib/agents/config";
import { nextCaseIds } from "@/lib/agents/define";
import { draftCases } from "@/lib/agents/draft";
import { editDefinition, EditError, withCaseRemoved, withCaseReplaced, withCasesAdded, type Definition } from "@/lib/agents/edit";
import { caseInputHash, computeLockState, hashAgentCases } from "@/lib/agents/ingest";
import { agentAudit, getAgentHeldout, listAgentRuns, listFrozenVersions } from "@/lib/agents/repo";
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
  /**
   * Change a case's input, reference answer (null removes it) or note ("" removes it); only what is sent changes. Its
   * split and where it came from stay as they are.
   */
  z.object({ action: z.literal("update"), actor: Actor, base: Base, case_id: z.string().min(1), input: Input.optional(), expected: Expected.optional(), notes: Notes }),
  z.object({ action: z.literal("remove"), actor: Actor, base: Base, case_id: z.string().min(1) }),
  /** Ask Claude for new practice questions like the existing ones. Live mode only; saves nothing. */
  z.object({ action: z.literal("draft"), actor: Actor, request: z.string().trim().max(1000).default(""), count: z.number().int().min(1).max(10).default(5), fresh: z.boolean().default(false) }),
]);

const blank = (v: unknown) => v === undefined || v === null || v === "";

const CLASH = "Your test cases already ask exactly this (or did in an earlier locked version). Write a different question.";

/**
 * Refuse a new or changed case that asks exactly what another case asks, or that would be locked the moment it's saved
 * (it matches a question held out in an earlier version): the person couldn't run, edit or remove it. The message
 * doesn't say which case, so it can't be used to find out what the final exam asks.
 */
async function refuseClashes(d: Definition, casesText: string, ids: string[]) {
  const { agent } = validateDefinition(d.agent.agent_id, d.agent.dir, d.configText, casesText);
  if (!agent) return; // editDefinition reports what's wrong with the file
  const [frozen, heldout] = await Promise.all([listFrozenVersions(agent.agent_id), getAgentHeldout(agent.agent_id)]);
  const lock = computeLockState(agent, frozen, heldout);
  for (const id of ids) {
    const c = agent.cases.find((x) => x.case_id === id)!;
    const hash = caseInputHash(c.input);
    if (agent.cases.some((x) => x.case_id !== id && caseInputHash(x.input) === hash) || (c.split === "dev" && lock.locked.has(id))) throw new EditError(CLASH, 409);
  }
}

/** Every case id an earlier test or lock used: a new case never reuses one, so it never inherits an old answer. */
async function usedCaseIds(agentId: string): Promise<string[]> {
  const [runs, frozen] = await Promise.all([listAgentRuns(agentId), listFrozenVersions(agentId)]);
  return [...runs.flatMap((r) => [...r.case_ids, ...Object.keys(r.trace_ids)]), ...frozen.flatMap((f) => [...f.case_ids, ...f.heldout_cases.map((h) => h.case_id)])];
}

/**
 * POST /api/agents/:agentId/cases
 *   add    → 201 { added: [case_id], definition_hash, needs_lock, next_version }
 *   update → { updated, …, relocked } · remove → { removed, … } (needs_lock: lock the new set as next_version before the
 *   next test; relocked: a revealed final-exam case got a new question, so it's locked again)
 * 409 a question another case already asks (or one held out in an earlier version) · 400 nothing changed
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
            const ids = nextCaseIds([...d.agent.cases.map((c) => c.case_id), ...(await usedCaseIds(agentId))], body.cases.length);
            const cases: AgentCase[] = body.cases.map((c, i) => ({
              case_id: ids[i],
              input: c.input as AgentCase["input"],
              split: c.split,
              ...(blank(c.expected) ? {} : { expected: c.expected }),
              ...(c.notes ? { notes: c.notes } : {}),
              ...(c.origin ? { origin: c.origin } : {}),
            }));
            const casesText = withCasesAdded(d.casesText, cases);
            await refuseClashes(d, casesText, ids);
            return {
              casesText,
              details: { case_ids: ids, heldout: cases.filter((c) => c.split === "heldout").map((c) => c.case_id), ai_drafted: cases.filter((c) => c.origin).map((c) => c.case_id) },
            };
          }
          const current = d.agent.cases.find((c) => c.case_id === body.case_id);
          if (!current) throw new EditError(`There is no test case "${body.case_id}".`, 404);
          if (lock.locked.has(body.case_id)) {
            throw new EditError(`"${body.case_id}" is a locked final-exam case: it can't be changed or removed before it's unlocked, so nobody sees it early.`, 423);
          }
          if (body.action === "remove") return { casesText: withCaseRemoved(d.casesText, body.case_id), details: { case_id: body.case_id, split: current.split } };
          const expected = body.expected === undefined ? current.expected : blank(body.expected) ? undefined : body.expected;
          const notes = body.notes === undefined ? current.notes : body.notes || undefined;
          const next: AgentCase = {
            case_id: current.case_id,
            split: current.split,
            input: (body.input === undefined ? current.input : body.input) as AgentCase["input"],
            ...(expected !== undefined ? { expected } : {}),
            ...(notes ? { notes } : {}),
            ...(current.origin ? { origin: current.origin } : {}),
          };
          const changed = (["input", "expected", "notes"] as const).filter((k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(next[k] ?? null));
          if (!changed.length) throw new EditError("Nothing changed: edit the question, reference answer or note first.");
          const casesText = withCaseReplaced(d.casesText, next);
          if (changed.includes("input")) await refuseClashes(d, casesText, [current.case_id]);
          // A revealed final-exam case with a new question is new content: it's locked again until it's unlocked.
          return { casesText, details: { case_id: current.case_id, changed, relocked: current.split === "heldout" && changed.includes("input") } };
        },
      });
      const key = body.action === "add" ? "added" : body.action === "update" ? "updated" : "removed";
      const value = body.action === "add" ? (res.details.case_ids as string[]) : body.case_id;
      // Tests already ran on a locked set and the questions changed: the next test needs the new set locked first.
      const latest = (await listFrozenVersions(agentId)).at(-1);
      const needsLock = latest !== undefined && latest.content_hash !== hashAgentCases(res.agent.cases);
      return ok(
        { [key]: value, definition_hash: res.hash, needs_lock: needsLock, next_version: needsLock ? latest.version + 1 : null, relocked: res.details.relocked === true },
        { status: body.action === "add" ? 201 : 200 },
      );
    }),
  );
}
