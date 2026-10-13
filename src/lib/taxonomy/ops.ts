/**
 * Failure-taxonomy operations (axial coding). Pure functions on a list of
 * failure modes; persistence creates a new taxonomy version per change.
 *
 * Frequency counts come ONLY from human annotations. Seed hypotheses with no
 * human-tagged traces show zero observations — never an assumed rate.
 */
import type { Annotation, FailureMode, Severity } from "../domain/schemas";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Follow merged_into links to the surviving mode (guards against cycles). */
export function resolveModeId(modes: FailureMode[], id: string): string {
  let current = id;
  const seen = new Set<string>();
  for (;;) {
    const m = modes.find((x) => x.failure_mode_id === current);
    if (!m || m.status !== "merged" || !m.merged_into || seen.has(current)) return current;
    seen.add(current);
    current = m.merged_into;
  }
}

export function addMode(
  modes: FailureMode[],
  input: { name: string; definition: string; severity: Severity; failure_mode_id?: string },
): FailureMode[] {
  const id = input.failure_mode_id ?? slugify(input.name);
  if (!id) throw new Error("Failure mode needs a name");
  if (modes.some((m) => m.failure_mode_id === id)) throw new Error(`Failure mode ${id} already exists`);
  return [
    ...modes,
    {
      failure_mode_id: id,
      name: input.name.trim(),
      definition: input.definition.trim(),
      severity: input.severity,
      status: "provisional",
      merged_into: null,
      representative_trace_ids: [],
      linked_evaluator_id: null,
      origin: "reviewer_added",
    },
  ];
}

export function editMode(
  modes: FailureMode[],
  id: string,
  patch: Partial<Pick<FailureMode, "name" | "definition" | "severity" | "linked_evaluator_id">>,
): FailureMode[] {
  if (!modes.some((m) => m.failure_mode_id === id)) throw new Error(`Unknown failure mode ${id}`);
  return modes.map((m) => (m.failure_mode_id === id ? { ...m, ...patch } : m));
}

/** Merge `sourceId` into `targetId`: the source is kept (for history) with status "merged". */
export function mergeModes(modes: FailureMode[], sourceId: string, targetId: string): FailureMode[] {
  if (sourceId === targetId) throw new Error("Cannot merge a failure mode into itself");
  const source = modes.find((m) => m.failure_mode_id === sourceId);
  const target = modes.find((m) => m.failure_mode_id === targetId);
  if (!source || !target) throw new Error("Unknown failure mode in merge");
  if (target.status === "merged") throw new Error(`${targetId} is itself merged; merge into ${resolveModeId(modes, targetId)} instead`);
  const reps = [...new Set([...target.representative_trace_ids, ...source.representative_trace_ids])];
  return modes.map((m) => {
    if (m.failure_mode_id === sourceId) return { ...m, status: "merged", merged_into: targetId };
    if (m.failure_mode_id === targetId) return { ...m, representative_trace_ids: reps };
    // Re-point anything previously merged into the source.
    if (m.merged_into === sourceId) return { ...m, merged_into: targetId };
    return m;
  });
}

export function retireMode(modes: FailureMode[], id: string): FailureMode[] {
  const m = modes.find((x) => x.failure_mode_id === id);
  if (!m) throw new Error(`Unknown failure mode ${id}`);
  if (m.status === "merged") throw new Error(`${id} is merged into ${m.merged_into}; retire that mode instead`);
  if (modes.some((x) => x.status === "merged" && x.merged_into === id)) {
    throw new Error(`Other modes are merged into ${id}; retiring it would orphan their observations`);
  }
  return modes.map((x) => (x.failure_mode_id === id ? { ...x, status: "retired" } : x));
}

export function attachRepresentativeTrace(modes: FailureMode[], id: string, traceId: string): FailureMode[] {
  if (!modes.some((m) => m.failure_mode_id === id)) throw new Error(`Unknown failure mode ${id}`);
  const target = resolveModeId(modes, id);
  if (modes.find((m) => m.failure_mode_id === target)?.status === "retired") throw new Error(`${target} is retired`);
  return modes.map((m) =>
    m.failure_mode_id === target && !m.representative_trace_ids.includes(traceId)
      ? { ...m, representative_trace_ids: [...m.representative_trace_ids, traceId] }
      : m,
  );
}

export interface ModeFrequency {
  failure_mode_id: string;
  /** traces where this mode is the FIRST observed failure */
  first_failure_count: number;
  /** traces where this mode appears as first or additional failure (each trace counted once) */
  any_count: number;
  trace_ids: string[];
}

/**
 * Observed frequencies from human annotations only. Each trace counts once per
 * mode even if several reviewers tagged it. Merged modes roll up into their target.
 */
export function observedFrequencies(modes: FailureMode[], annotations: Annotation[]): ModeFrequency[] {
  const first = new Map<string, Set<string>>();
  const any = new Map<string, Set<string>>();
  const bump = (map: Map<string, Set<string>>, id: string, traceId: string) => {
    const set = map.get(id) ?? new Set<string>();
    set.add(traceId);
    map.set(id, set);
  };
  for (const a of annotations) {
    if (a.label_source !== "human") continue;
    const ids = new Set<string>();
    if (a.first_failure?.failure_mode_id) {
      const id = resolveModeId(modes, a.first_failure.failure_mode_id);
      bump(first, id, a.trace_id);
      ids.add(id);
    }
    for (const extra of a.additional_failure_mode_ids) ids.add(resolveModeId(modes, extra));
    for (const id of ids) bump(any, id, a.trace_id);
  }
  return modes
    .filter((m) => m.status !== "merged")
    .map((m) => ({
      failure_mode_id: m.failure_mode_id,
      first_failure_count: first.get(m.failure_mode_id)?.size ?? 0,
      any_count: any.get(m.failure_mode_id)?.size ?? 0,
      trace_ids: [...(any.get(m.failure_mode_id) ?? [])],
    }));
}

/** A mode is "observed" once at least one human annotation tags it; otherwise it stays a hypothesis. */
export function withObservedStatus(modes: FailureMode[], freqs: ModeFrequency[]): FailureMode[] {
  return modes.map((m) => {
    if (m.status === "merged" || m.status === "retired") return m;
    const f = freqs.find((x) => x.failure_mode_id === m.failure_mode_id);
    return { ...m, status: f && f.any_count > 0 ? "observed" : "provisional" };
  });
}
