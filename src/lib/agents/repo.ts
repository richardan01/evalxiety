/**
 * Storage for "your agents": everything generated lives under data/agents/<agent_id>/ (runs, traces, human
 * labels, judge results, approvals, frozen case-set versions, held-out state, audit log). Nothing here is shared
 * with the pricing demo's files.
 */
import { z } from "zod";
import { AuditEvent, ReleaseApproval } from "../domain/schemas";
import { appendLine, listJsonFiles, newId, readJson, readLines, updateJson, writeJson } from "../storage/store";
import {
  AgentAnnotation,
  AgentJudgeResult,
  AgentRun,
  AgentTrace,
  FrozenVersion,
  HeldoutState,
} from "./schemas";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const base = (agentId: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agentId)) throw new Error(`Invalid agent id "${agentId}"`);
  return `agents/${agentId}`;
};

// ---------------------------------------------------------------------------
// Traces & runs
// ---------------------------------------------------------------------------

export async function saveAgentTrace(trace: AgentTrace): Promise<void> {
  AgentTrace.parse(trace);
  await writeJson(`${base(trace.agent_id)}/traces/${trace.trace_id}.json`, trace);
}

export async function getAgentTrace(agentId: string, traceId: string): Promise<AgentTrace | null> {
  if (!SAFE_ID.test(traceId)) return null;
  return readJson(`${base(agentId)}/traces/${traceId}.json`, AgentTrace.nullable(), null);
}

export async function listAgentTraces(agentId: string): Promise<AgentTrace[]> {
  const files = await listJsonFiles(`${base(agentId)}/traces`);
  const traces = await Promise.all(files.map((f) => readJson(f, AgentTrace.nullable(), null)));
  return traces.filter((t): t is AgentTrace => t !== null).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function saveAgentRun(run: AgentRun): Promise<void> {
  AgentRun.parse(run);
  await writeJson(`${base(run.agent_id)}/runs/${run.run_id}.json`, run);
}

export async function getAgentRun(agentId: string, runId: string): Promise<AgentRun | null> {
  if (!SAFE_ID.test(runId)) return null;
  return readJson(`${base(agentId)}/runs/${runId}.json`, AgentRun.nullable(), null);
}

/** Read-modify-write one run under its file lock (HTTP runs record each trace as it lands). */
export async function updateAgentRun(agentId: string, runId: string, mutate: (run: AgentRun) => AgentRun): Promise<AgentRun> {
  if (!SAFE_ID.test(runId)) throw new Error(`Invalid run id "${runId}"`);
  const rel = `${base(agentId)}/runs/${runId}.json`;
  return updateJson(rel, AgentRun.nullable(), null, (cur) => {
    if (!cur) throw new Error(`Run ${runId} not found`);
    return mutate(cur);
  }) as Promise<AgentRun>;
}

export async function listAgentRuns(agentId: string): Promise<AgentRun[]> {
  const files = await listJsonFiles(`${base(agentId)}/runs`);
  const runs = await Promise.all(files.map((f) => readJson(f, AgentRun.nullable(), null)));
  return runs.filter((r): r is AgentRun => r !== null).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ---------------------------------------------------------------------------
// Human annotations — one per (trace, reviewer)
// ---------------------------------------------------------------------------

const AnnotationList = z.array(AgentAnnotation);

export async function listAgentAnnotations(agentId: string): Promise<AgentAnnotation[]> {
  return readJson(`${base(agentId)}/annotations.json`, AnnotationList, []);
}

export type AgentAnnotationInput = Omit<AgentAnnotation, "annotation_id" | "created_at" | "updated_at" | "label_source">;

/** Invariants every stored human label must satisfy (enforced here, not only in routes). */
export function validateAgentAnnotation(input: AgentAnnotationInput): AgentAnnotationInput {
  const reviewer = input.reviewer.trim();
  if (!reviewer) throw new Error("A named human reviewer is required");
  const notes = input.notes.trim();
  const first = input.first_failure?.trim() || null;
  const type = input.failure_type?.trim() || null;
  if (input.task_outcome === "fail") {
    if (!first) throw new Error("A failed trace needs a description of the first thing that went wrong");
    if (!input.severity) throw new Error("A failed trace needs a severity");
  } else if (first || type || input.severity) {
    throw new Error("A passing trace cannot record a failure, failure type or severity");
  }
  return { ...input, reviewer, notes, first_failure: first, failure_type: type };
}

export async function upsertAgentAnnotation(raw: AgentAnnotationInput): Promise<{ annotation: AgentAnnotation; created: boolean }> {
  const input = validateAgentAnnotation(raw);
  let saved: AgentAnnotation | null = null;
  let created = false;
  await updateJson(`${base(input.agent_id)}/annotations.json`, AnnotationList, [], (list) => {
    const now = new Date().toISOString();
    const idx = list.findIndex((a) => a.trace_id === input.trace_id && a.reviewer === input.reviewer);
    if (idx >= 0) {
      saved = AgentAnnotation.parse({ ...list[idx], ...input, label_source: "human", updated_at: now });
      const next = [...list];
      next[idx] = saved;
      return next;
    }
    created = true;
    saved = AgentAnnotation.parse({ ...input, annotation_id: newId("ann"), label_source: "human", created_at: now, updated_at: now });
    return [...list, saved];
  });
  return { annotation: saved!, created };
}

// ---------------------------------------------------------------------------
// Judge results
// ---------------------------------------------------------------------------

const JudgeList = z.array(AgentJudgeResult);

export async function listAgentJudgeResults(agentId: string): Promise<AgentJudgeResult[]> {
  return readJson(`${base(agentId)}/judge_results.json`, JudgeList, []);
}

export async function saveAgentJudgeResults(agentId: string, results: AgentJudgeResult[]): Promise<void> {
  if (results.length === 0) return;
  await updateJson(`${base(agentId)}/judge_results.json`, JudgeList, [], (list) => [...list, ...results]);
}

// ---------------------------------------------------------------------------
// Frozen case-set versions
// ---------------------------------------------------------------------------

const FrozenList = z.array(FrozenVersion);

export async function listFrozenVersions(agentId: string): Promise<FrozenVersion[]> {
  return readJson(`${base(agentId)}/frozen.json`, FrozenList, []);
}

/** Append a new frozen version unless the latest already has this hash. Returns the latest version. */
export async function freezeVersion(
  agentId: string,
  hash: string,
  caseIds: string[],
  heldout: Array<{ case_id: string; input_hash: string }>,
  actor: string,
  note: string,
): Promise<{ version: FrozenVersion; created: boolean; previous: FrozenVersion | null }> {
  let previous: FrozenVersion | null = null;
  let result: FrozenVersion | null = null;
  let created = false;
  await updateJson(`${base(agentId)}/frozen.json`, FrozenList, [], (list) => {
    const latest = list[list.length - 1];
    previous = latest ?? null;
    if (latest && latest.content_hash === hash) {
      result = latest;
      return list;
    }
    created = true;
    result = {
      version: (latest?.version ?? 0) + 1,
      content_hash: hash,
      case_ids: [...caseIds].sort(),
      created_at: new Date().toISOString(),
      created_by: actor,
      note,
      heldout_cases: heldout,
    };
    return [...list, result];
  });
  return { version: result!, created, previous };
}

// ---------------------------------------------------------------------------
// Held-out reveal
// ---------------------------------------------------------------------------

const HIDDEN: HeldoutState = { revealed: false, revealed_at: null, revealed_by: null, reason: null, revealed_cases: [] };

export async function getAgentHeldout(agentId: string): Promise<HeldoutState> {
  return readJson(`${base(agentId)}/heldout.json`, HeldoutState, HIDDEN);
}

/** Audited, irreversible reveal of these held-out cases' content (added to any revealed earlier). */
export async function revealAgentHeldout(agentId: string, actor: string, reason: string, cases: Array<{ case_id: string; input_hash: string }>): Promise<HeldoutState> {
  const at = new Date().toISOString();
  return updateJson(`${base(agentId)}/heldout.json`, HeldoutState, HIDDEN, (cur) => {
    const known = new Set(cur.revealed_cases.map((c) => c.input_hash));
    return {
      revealed: true,
      revealed_at: at,
      revealed_by: actor,
      reason,
      revealed_cases: [...cur.revealed_cases, ...cases.filter((c) => !known.has(c.input_hash)).map((c) => ({ ...c, revealed_at: at, revealed_by: actor }))],
    };
  });
}

// ---------------------------------------------------------------------------
// Release approvals
// ---------------------------------------------------------------------------

const ApprovalList = z.array(ReleaseApproval);

export async function listAgentApprovals(agentId: string): Promise<ReleaseApproval[]> {
  return readJson(`${base(agentId)}/approvals.json`, ApprovalList, []);
}

export async function saveAgentApproval(agentId: string, a: ReleaseApproval): Promise<void> {
  await updateJson(`${base(agentId)}/approvals.json`, ApprovalList, [], (list) => [...list, ReleaseApproval.parse(a)]);
}

// ---------------------------------------------------------------------------
// Audit log (per agent)
// ---------------------------------------------------------------------------

export async function agentAudit(agentId: string, actor: string, action: string, details: Record<string, unknown>): Promise<void> {
  const ev: AuditEvent = { event_id: newId("evt"), at: new Date().toISOString(), actor, action, details: { agent_id: agentId, ...details } };
  await appendLine(`${base(agentId)}/audit_log.jsonl`, ev);
}

export async function listAgentAudit(agentId: string): Promise<AuditEvent[]> {
  return readLines(`${base(agentId)}/audit_log.jsonl`, AuditEvent);
}
