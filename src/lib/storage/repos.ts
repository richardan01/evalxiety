/**
 * Typed repositories over local JSON storage (data/ by default).
 */
import { z } from "zod";
import {
  Annotation,
  AuditEvent,
  ExperimentRun,
  GoldExample,
  JudgeResult,
  ReleaseApproval,
  TaxonomyVersion,
  Trace,
} from "../domain/schemas";
import {
  appendLine,
  listJsonFiles,
  newId,
  readJson,
  readLines,
  updateJson,
  writeJson,
} from "./store";
import { SEED_TAXONOMY } from "../taxonomy/seed";
import { DEFAULT_RUBRIC, RubricVersion } from "../rubric/rubric";

// ---------------------------------------------------------------------------
// Traces — one file per trace
// ---------------------------------------------------------------------------

export async function saveTrace(trace: Trace): Promise<void> {
  Trace.parse(trace);
  await writeJson(`traces/${trace.trace_id}.json`, trace);
}

export async function getTrace(traceId: string): Promise<Trace | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(traceId)) return null;
  return readJson(`traces/${traceId}.json`, Trace.nullable(), null);
}

export async function listTraces(): Promise<Trace[]> {
  const files = await listJsonFiles("traces");
  const traces = await Promise.all(files.map((f) => readJson(f, Trace.nullable(), null)));
  return traces
    .filter((t): t is Trace => t !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ---------------------------------------------------------------------------
// Annotations — one per (trace, reviewer)
// ---------------------------------------------------------------------------

const ANNOTATIONS = "annotations.json";
const AnnotationList = z.array(Annotation);

export async function listAnnotations(): Promise<Annotation[]> {
  return readJson(ANNOTATIONS, AnnotationList, []);
}

export type AnnotationInput = Omit<
  Annotation,
  "annotation_id" | "created_at" | "updated_at" | "label_source" | "checklist" | "rubric_version" | "demo"
> & { checklist?: Annotation["checklist"]; rubric_version?: number | null; /** Omit to keep an existing label's flag. */ demo?: boolean };

/** Invariants every stored human label must satisfy (enforced here, not only in routes). */
export function validateAnnotationInput(input: AnnotationInput): AnnotationInput {
  const reviewer = input.reviewer.trim();
  if (!reviewer) throw new Error("A named human reviewer is required");
  if (input.task_outcome === "fail") {
    if (!input.open_coding_notes.trim()) throw new Error("A failed trace needs a note describing what went wrong");
    if (!input.first_failure?.description.trim()) throw new Error("A failed trace needs a first-failure description");
    if (!input.severity) throw new Error("A failed trace needs a severity");
  } else if (input.first_failure || input.severity) {
    throw new Error("A passing trace cannot record a first failure or severity");
  }
  return { ...input, reviewer };
}

export async function upsertAnnotation(rawInput: AnnotationInput): Promise<Annotation> {
  const input = validateAnnotationInput(rawInput);
  let saved: Annotation | null = null;
  await updateJson(ANNOTATIONS, AnnotationList, [], (list) => {
    const now = new Date().toISOString();
    const idx = list.findIndex((a) => a.trace_id === input.trace_id && a.reviewer === input.reviewer);
    if (idx >= 0) {
      saved = Annotation.parse({ ...list[idx], ...input, label_source: "human", updated_at: now });
      const next = [...list];
      next[idx] = saved;
      return next;
    }
    saved = Annotation.parse({
      ...input,
      annotation_id: newId("ann"),
      label_source: "human",
      created_at: now,
      updated_at: now,
    });
    return [...list, saved];
  });
  return saved!;
}

// ---------------------------------------------------------------------------
// Failure taxonomy — append-only list of versions
// ---------------------------------------------------------------------------

const TAXONOMY = "taxonomy.json";
const TaxonomyList = z.array(TaxonomyVersion);

export async function listTaxonomyVersions(): Promise<TaxonomyVersion[]> {
  const list = await readJson(TAXONOMY, TaxonomyList, []);
  return list.length > 0 ? list : [SEED_TAXONOMY];
}

export async function latestTaxonomy(): Promise<TaxonomyVersion> {
  const list = await listTaxonomyVersions();
  return list[list.length - 1];
}

export class TaxonomyConflictError extends Error {}

/**
 * Save a new taxonomy version. Pass `expectedBaseVersion` (the version the change was computed
 * from) to get optimistic concurrency: if another change landed first, this throws
 * TaxonomyConflictError instead of silently discarding the other change.
 */
export async function appendTaxonomyVersion(
  author: string,
  changeNote: string,
  failureModes: TaxonomyVersion["failure_modes"],
  expectedBaseVersion?: number,
): Promise<TaxonomyVersion> {
  let created: TaxonomyVersion | null = null;
  await updateJson(TAXONOMY, TaxonomyList, [], (list) => {
    const base = list.length > 0 ? list : [SEED_TAXONOMY];
    const latestVersion = base[base.length - 1].version;
    if (expectedBaseVersion !== undefined && expectedBaseVersion !== latestVersion) {
      throw new TaxonomyConflictError(
        `Taxonomy changed concurrently (now v${latestVersion}, change was based on v${expectedBaseVersion}). Reload and re-apply.`,
      );
    }
    created = TaxonomyVersion.parse({
      version: base[base.length - 1].version + 1,
      created_at: new Date().toISOString(),
      author,
      change_note: changeNote,
      failure_modes: failureModes,
    });
    return [...base, created];
  });
  return created!;
}

// ---------------------------------------------------------------------------
// Gold dataset
// ---------------------------------------------------------------------------

const GOLD = "gold.json";
const GoldList = z.array(GoldExample);

export async function listGold(): Promise<GoldExample[]> {
  return readJson(GOLD, GoldList, []);
}

export async function upsertGold(example: GoldExample): Promise<GoldExample> {
  GoldExample.parse(example);
  await updateJson(GOLD, GoldList, [], (list) => [...list.filter((g) => g.gold_id !== example.gold_id), example]);
  return example;
}

export async function removeGold(goldId: string): Promise<void> {
  await updateJson(GOLD, GoldList, [], (list) => list.filter((g) => g.gold_id !== goldId));
}

// ---------------------------------------------------------------------------
// Judge results
// ---------------------------------------------------------------------------

const JUDGE = "judge_results.json";
const JudgeList = z.array(JudgeResult);

export async function listJudgeResults(): Promise<JudgeResult[]> {
  return readJson(JUDGE, JudgeList, []);
}

export async function saveJudgeResult(result: JudgeResult): Promise<void> {
  JudgeResult.parse(result);
  await updateJson(JUDGE, JudgeList, [], (list) => [...list, result]);
}

// ---------------------------------------------------------------------------
// Experiment runs — one file per run
// ---------------------------------------------------------------------------

export async function saveExperimentRun(run: ExperimentRun): Promise<void> {
  ExperimentRun.parse(run);
  await writeJson(`experiments/${run.run_id}.json`, run);
}

export async function getExperimentRun(runId: string): Promise<ExperimentRun | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) return null;
  return readJson(`experiments/${runId}.json`, ExperimentRun.nullable(), null);
}

export async function listExperimentRuns(): Promise<ExperimentRun[]> {
  const files = await listJsonFiles("experiments");
  const runs = await Promise.all(files.map((f) => readJson(f, ExperimentRun.nullable(), null)));
  return runs
    .filter((r): r is ExperimentRun => r !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ---------------------------------------------------------------------------
// Release approvals
// ---------------------------------------------------------------------------

const APPROVALS = "approvals.json";
const ApprovalList = z.array(ReleaseApproval);

export async function listApprovals(): Promise<ReleaseApproval[]> {
  return readJson(APPROVALS, ApprovalList, []);
}

export async function saveApproval(a: ReleaseApproval): Promise<void> {
  ReleaseApproval.parse(a);
  await updateJson(APPROVALS, ApprovalList, [], (list) => [...list, a]);
}

// ---------------------------------------------------------------------------
// Held-out access state + audit log
// ---------------------------------------------------------------------------

export const HeldoutState = z.object({
  revealed: z.boolean(),
  revealed_at: z.string().nullable(),
  revealed_by: z.string().nullable(),
  reason: z.string().nullable(),
});
export type HeldoutState = z.infer<typeof HeldoutState>;
const HELDOUT = "heldout_state.json";
const HELDOUT_DEFAULT: HeldoutState = { revealed: false, revealed_at: null, revealed_by: null, reason: null };

export async function getHeldoutState(): Promise<HeldoutState> {
  return readJson(HELDOUT, HeldoutState, HELDOUT_DEFAULT);
}

/** Irreversible and idempotent: the first reveal is kept; later calls return it unchanged. */
export async function revealHeldout(actor: string, reason: string): Promise<HeldoutState> {
  let first = false;
  const state = await updateJson(HELDOUT, HeldoutState, HELDOUT_DEFAULT, (current) => {
    if (current.revealed) return current;
    first = true;
    return { revealed: true, revealed_at: new Date().toISOString(), revealed_by: actor, reason };
  });
  if (first) await audit(actor, "heldout.revealed", { reason });
  return state;
}

const AUDIT = "audit_log.jsonl";

export async function audit(actor: string, action: string, details: Record<string, unknown>): Promise<void> {
  const ev: AuditEvent = { event_id: newId("evt"), at: new Date().toISOString(), actor, action, details };
  await appendLine(AUDIT, ev);
}

export async function listAudit(): Promise<AuditEvent[]> {
  return readLines(AUDIT, AuditEvent);
}

// ---------------------------------------------------------------------------
// Rubric — append-only list of versions (latest wins)
// ---------------------------------------------------------------------------

const RUBRIC = "rubric.json";
const RubricList = z.array(RubricVersion);

export async function listRubricVersions(): Promise<RubricVersion[]> {
  const list = await readJson(RUBRIC, RubricList, []);
  return list.length > 0 ? list : [DEFAULT_RUBRIC];
}

export async function latestRubric(): Promise<RubricVersion> {
  const list = await listRubricVersions();
  return list[list.length - 1];
}

export class RubricConflictError extends Error {}

export async function appendRubricVersion(
  author: string,
  changeNote: string,
  content: Pick<RubricVersion, "review_checklist" | "judge_criterion"> & { judge_model?: RubricVersion["judge_model"] },
  expectedBaseVersion: number,
): Promise<RubricVersion> {
  let created: RubricVersion | null = null;
  await updateJson(RUBRIC, RubricList, [], (list) => {
    const base = list.length > 0 ? list : [DEFAULT_RUBRIC];
    const latest = base[base.length - 1].version;
    if (expectedBaseVersion !== latest) {
      throw new RubricConflictError(`Rubric changed concurrently (now v${latest}, edit was based on v${expectedBaseVersion}). Reload.`);
    }
    created = RubricVersion.parse({
      version: latest + 1,
      created_at: new Date().toISOString(),
      author: author.trim(),
      change_note: changeNote,
      review_checklist: content.review_checklist,
      judge_criterion: content.judge_criterion,
      judge_model: content.judge_model ?? base[base.length - 1].judge_model,
    });
    return [...base, created];
  });
  return created!;
}
