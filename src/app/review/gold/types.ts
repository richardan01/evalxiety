/**
 * Response shapes for /api/gold. Type-only module: safe for route handlers and client components.
 */
import type { Annotation, DatasetSplit, ExecutionMode, GoldExample } from "@/lib/domain/schemas";

export type CandidateReason = "not_promoted" | "annotation_updated_since_promotion";

export interface GoldCandidate {
  annotation: Annotation;
  case_id: string;
  trace_id: string;
  split: DatasetSplit;
  execution_mode: ExecutionMode;
  /** Deterministic preview derived from the synthetic policy rules (services.expectedBehaviorFor) — not Claude output. */
  expected_behavior: { text: string; reference_policy_ids: string[] } | null;
  expected_behavior_error: string | null;
  reason: CandidateReason;
  existing_gold_id: string | null;
}

export interface GoldApiResponse {
  gold: GoldExample[];
  candidates: GoldCandidate[];
  /** failure_mode_id -> display name from the latest taxonomy */
  failure_mode_names: Record<string, string>;
  /** Number of frozen synthetic cases per split (the most gold examples each split can hold, one per case trace). */
  split_case_counts: Record<DatasetSplit, number>;
  split_version: string;
  heldout: { revealed: boolean; revealed_at: string | null; revealed_by: string | null };
  /** Human annotations on frozen cases not shown as candidates because another annotation of the same trace is already gold. */
  superseded_by_other_annotation: number;
}

export type GoldPostRequest =
  | { action: "promote"; annotation_id: string; promoted_by: string; expected_behavior?: string }
  | { action: "remove"; gold_id: string; actor: string };
