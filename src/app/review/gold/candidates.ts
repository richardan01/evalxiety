/**
 * Pure selection of gold-promotion candidates. No server-only imports.
 *
 * A candidate is a HUMAN annotation on a trace of a frozen synthetic case (one
 * with a dev/held-out split) that is either not yet gold, or is the annotation
 * the current gold example came from and has been edited since promotion.
 */
import type { Annotation, DatasetSplit, ExecutionMode, GoldExample } from "@/lib/domain/schemas";
import type { CandidateReason } from "./types";

export interface TraceInfo {
  trace_id: string;
  case_id: string;
  execution_mode: ExecutionMode;
  data_origin: "synthetic" | "user_supplied";
}

export interface RawCandidate {
  annotation: Annotation;
  trace: TraceInfo;
  split: DatasetSplit;
  reason: CandidateReason;
  existing_gold_id: string | null;
}

export function selectCandidates(
  annotations: Annotation[],
  gold: GoldExample[],
  traces: TraceInfo[],
  splitAssignment: Record<string, DatasetSplit>,
): { candidates: RawCandidate[]; superseded: number } {
  const traceById = new Map(traces.map((t) => [t.trace_id, t]));
  const goldByTrace = new Map(gold.map((g) => [g.trace_id, g]));
  const candidates: RawCandidate[] = [];
  let superseded = 0;
  for (const a of annotations) {
    if (a.label_source !== "human" || !a.reviewer.trim()) continue;
    const trace = traceById.get(a.trace_id);
    if (!trace || trace.data_origin !== "synthetic") continue;
    const split = splitAssignment[trace.case_id];
    if (!split) continue; // not a frozen synthetic case
    const g = goldByTrace.get(a.trace_id);
    if (!g) {
      candidates.push({ annotation: a, trace, split, reason: "not_promoted", existing_gold_id: null });
    } else if (g.annotation_id === a.annotation_id) {
      if (g.review_timestamp !== a.updated_at) {
        candidates.push({ annotation: a, trace, split, reason: "annotation_updated_since_promotion", existing_gold_id: g.gold_id });
      }
    } else {
      superseded++;
    }
  }
  candidates.sort(
    (x, y) => x.trace.case_id.localeCompare(y.trace.case_id) || x.annotation.updated_at.localeCompare(y.annotation.updated_at),
  );
  return { candidates, superseded };
}
