/**
 * Response shapes for /api/taxonomy and /api/annotations/categorize.
 * Type-only module: safe to import from both the route handlers and client components.
 */
import type { Annotation, ExecutionMode, FailureMode, Severity, TaxonomyVersion } from "@/lib/domain/schemas";
import type { ModeFrequency } from "@/lib/taxonomy/ops";

export interface TaxonomyVersionSummary {
  version: number;
  created_at: string;
  author: string;
  change_note: string;
  mode_count: number;
}

export interface EvaluatorOption {
  evaluator_id: string;
  kind: "deterministic" | "llm_judge";
  label: string;
  /** true for the LLM judge: not validated, never counts as human evidence */
  experimental: boolean;
}

export interface TaxonomyApiResponse {
  version: number;
  author: string;
  change_note: string;
  created_at: string;
  failure_modes: FailureMode[];
  frequencies: ModeFrequency[];
  /** Distinct traces with at least one human annotation — the denominator for every count. */
  reviewed_trace_count: number;
  versions: TaxonomyVersionSummary[];
  /** All human annotations (the only source of observed counts). */
  annotations: Annotation[];
  /** trace_id -> execution mode, for MOCK/LIVE badges next to trace-derived counts. */
  trace_modes: Record<string, ExecutionMode>;
  evaluator_options: EvaluatorOption[];
}

export type TaxonomyOp =
  | { type: "add"; name: string; definition: string; severity: Severity }
  | {
      type: "edit";
      failure_mode_id: string;
      name?: string;
      definition?: string;
      severity?: Severity;
      linked_evaluator_id?: string | null;
    }
  | { type: "merge"; source_id: string; target_id: string }
  | { type: "retire"; failure_mode_id: string }
  | { type: "attach_trace"; failure_mode_id: string; trace_id: string };

export interface TaxonomyPostResponse {
  taxonomy_version: TaxonomyVersion;
  /** The failure mode the op created or changed. */
  failure_mode_id: string;
}

export interface CategorizeRequest {
  annotation_id: string;
  actor: string;
  first_failure_mode_id: string | null;
  additional_failure_mode_ids?: string[];
}

export interface CategorizeResponse {
  annotation: Annotation;
}
