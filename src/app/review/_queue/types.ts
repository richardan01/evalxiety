/** Response shapes of the review API routes (type-only; safe to import from client components). */
import type { QueueItem } from "@/lib/services";
import type { Annotation, DeterministicResult, FailureMode, JudgeResult } from "@/lib/domain/schemas";
import type { EvaluatorDefinition } from "@/lib/evaluators/deterministic";

export type { QueueItem };

export interface QueueResponse {
  items: QueueItem[];
  reviewed_count: number;
  total: number;
}

export interface AnnotationsResponse {
  annotations: Annotation[];
}

/** GET /api/taxonomy (owned by the taxonomy area) — only the fields the review form needs. */
export interface TaxonomyResponse {
  version: number;
  failure_modes: FailureMode[];
}

export interface EvaluationsResponse {
  deterministic: DeterministicResult[];
  evaluator_definitions: EvaluatorDefinition[];
  judge_results: JudgeResult[];
  current_judge_version: string;
  judge_question: string;
  judge_locked: { reason: string } | null;
  judge_call: { mode: "live" | "mock"; estimated_usd: number; can_run?: boolean; unavailable_reason?: string | null };
}
