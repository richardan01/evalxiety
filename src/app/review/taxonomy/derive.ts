/**
 * Pure helpers for the axial-coding screen and the /api/taxonomy route.
 * No server-only imports: safe for client components and unit tests.
 */
import type { Annotation, ExecutionMode, FailureMode } from "@/lib/domain/schemas";
import {
  addMode,
  attachRepresentativeTrace,
  editMode,
  mergeModes,
  resolveModeId,
  retireMode,
  type ModeFrequency,
} from "@/lib/taxonomy/ops";
import type { TaxonomyOp } from "./types";

// ---------------------------------------------------------------------------
// Op application with guards (used by POST /api/taxonomy)
// ---------------------------------------------------------------------------

export interface OpContext {
  /** Human annotations — used to require that representative traces are observed examples. */
  annotations: Annotation[];
  /** Does the trace referenced by attach_trace exist in storage? */
  traceExists: boolean;
  /** Evaluator ids that may be linked to a failure mode. */
  evaluatorIds: string[];
}

function mustFind(modes: FailureMode[], id: string): FailureMode {
  const m = modes.find((x) => x.failure_mode_id === id);
  if (!m) throw new Error(`Unknown failure mode "${id}"`);
  return m;
}

/** Mode ids a human tagged on an annotation (first failure + additional), resolved through merges. */
export function taggedModeIds(modes: FailureMode[], a: Annotation): string[] {
  const ids = [a.first_failure?.failure_mode_id, ...a.additional_failure_mode_ids].filter((x): x is string => Boolean(x));
  return [...new Set(ids.map((id) => resolveModeId(modes, id)))];
}

/**
 * Apply one axial-coding operation to the latest failure modes. Throws an Error
 * with a reviewer-readable message when the operation is not allowed.
 */
export function applyTaxonomyOp(
  modes: FailureMode[],
  op: TaxonomyOp,
  ctx: OpContext,
): { modes: FailureMode[]; failure_mode_id: string } {
  switch (op.type) {
    case "add": {
      const next = addMode(modes, { name: op.name, definition: op.definition, severity: op.severity });
      return { modes: next, failure_mode_id: next[next.length - 1].failure_mode_id };
    }
    case "edit": {
      const current = mustFind(modes, op.failure_mode_id);
      const patch: Partial<Pick<FailureMode, "name" | "definition" | "severity" | "linked_evaluator_id">> = {};
      if (op.name !== undefined && op.name.trim() !== current.name) patch.name = op.name.trim();
      if (op.definition !== undefined && op.definition.trim() !== current.definition) patch.definition = op.definition.trim();
      if (op.severity !== undefined && op.severity !== current.severity) patch.severity = op.severity;
      if (op.linked_evaluator_id !== undefined && op.linked_evaluator_id !== current.linked_evaluator_id) {
        if (op.linked_evaluator_id !== null && !ctx.evaluatorIds.includes(op.linked_evaluator_id)) {
          throw new Error(`Unknown evaluator "${op.linked_evaluator_id}"`);
        }
        patch.linked_evaluator_id = op.linked_evaluator_id;
      }
      if (patch.name !== undefined && !patch.name) throw new Error("Name cannot be empty");
      if (patch.definition !== undefined && !patch.definition) throw new Error("Definition cannot be empty");
      if (Object.keys(patch).length === 0) throw new Error("Nothing changed — edit at least one field");
      return { modes: editMode(modes, op.failure_mode_id, patch), failure_mode_id: op.failure_mode_id };
    }
    case "merge": {
      const source = mustFind(modes, op.source_id);
      const target = mustFind(modes, op.target_id);
      if (source.status === "merged") throw new Error(`${source.failure_mode_id} is already merged into ${source.merged_into}`);
      if (target.status === "retired") throw new Error(`Cannot merge into ${target.failure_mode_id}: it is retired`);
      return { modes: mergeModes(modes, op.source_id, op.target_id), failure_mode_id: op.target_id };
    }
    case "retire": {
      const m = mustFind(modes, op.failure_mode_id);
      if (m.status === "merged") throw new Error(`${m.failure_mode_id} is merged into ${m.merged_into}; it cannot also be retired`);
      if (m.status === "retired") throw new Error(`${m.failure_mode_id} is already retired`);
      return { modes: retireMode(modes, op.failure_mode_id), failure_mode_id: op.failure_mode_id };
    }
    case "attach_trace": {
      mustFind(modes, op.failure_mode_id);
      const target = resolveModeId(modes, op.failure_mode_id);
      if (!ctx.traceExists) throw new Error(`Trace ${op.trace_id} not found`);
      const observed = ctx.annotations.some(
        (a) => a.label_source === "human" && a.trace_id === op.trace_id && taggedModeIds(modes, a).includes(target),
      );
      if (!observed) {
        throw new Error(
          `No human annotation tags trace ${op.trace_id} with ${target}. Representative traces must be human-observed examples of the failure.`,
        );
      }
      if (mustFind(modes, target).representative_trace_ids.includes(op.trace_id)) {
        throw new Error(`Trace ${op.trace_id} is already a representative trace of ${target}`);
      }
      return { modes: attachRepresentativeTrace(modes, op.failure_mode_id, op.trace_id), failure_mode_id: target };
    }
  }
}

// ---------------------------------------------------------------------------
// Read-side helpers for the UI
// ---------------------------------------------------------------------------

/** Human annotations that record a first failure but have no category yet (open coding not yet axially coded). */
export function uncategorisedNotes(annotations: Annotation[]): Annotation[] {
  return annotations
    .filter((a) => a.label_source === "human" && a.first_failure !== null && a.first_failure.failure_mode_id === null)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

/** Human annotations whose first failure already has a category (can be re-assigned). */
export function categorisedNotes(annotations: Annotation[]): Annotation[] {
  return annotations
    .filter((a) => a.label_source === "human" && a.first_failure?.failure_mode_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** Distinct traces per (resolved) mode where a human tagged it as the FIRST failure. */
export function firstFailureTraces(modes: FailureMode[], annotations: Annotation[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const a of annotations) {
    if (a.label_source !== "human" || !a.first_failure?.failure_mode_id) continue;
    const id = resolveModeId(modes, a.first_failure.failure_mode_id);
    const set = map.get(id) ?? new Set<string>();
    set.add(a.trace_id);
    map.set(id, set);
  }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
}

export interface ModeSplit {
  live: number;
  mock: number;
  unknown: number;
}

/** Count traces by execution mode so mock-derived observations are always visible as such. */
export function modeSplit(traceIds: string[], traceModes: Record<string, ExecutionMode>): ModeSplit {
  const out: ModeSplit = { live: 0, mock: 0, unknown: 0 };
  for (const id of traceIds) {
    const m = traceModes[id];
    if (m === "live") out.live++;
    else if (m === "mock") out.mock++;
    else out.unknown++;
  }
  return out;
}

export interface FrequencyRow {
  mode: FailureMode;
  freq: ModeFrequency;
  /** first-failure count / reviewed traces; null when no trace has been reviewed */
  first_share: number | null;
  any_share: number | null;
}

/** Frequency table rows sorted by first-failure count, then mentions, then name. Merged modes roll into their target. */
export function frequencyRows(modes: FailureMode[], freqs: ModeFrequency[], reviewed: number): FrequencyRow[] {
  const rows: FrequencyRow[] = [];
  for (const f of freqs) {
    const mode = modes.find((m) => m.failure_mode_id === f.failure_mode_id);
    if (!mode) continue;
    rows.push({
      mode,
      freq: f,
      first_share: reviewed > 0 ? f.first_failure_count / reviewed : null,
      any_share: reviewed > 0 ? f.any_count / reviewed : null,
    });
  }
  return rows.sort(
    (a, b) =>
      b.freq.first_failure_count - a.freq.first_failure_count ||
      b.freq.any_count - a.freq.any_count ||
      a.mode.name.localeCompare(b.mode.name),
  );
}

/** Modes a note can be assigned to: not merged, not retired. */
export function assignableModes(modes: FailureMode[]): FailureMode[] {
  return modes.filter((m) => m.status !== "merged" && m.status !== "retired");
}
