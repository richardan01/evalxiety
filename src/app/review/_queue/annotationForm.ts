/**
 * Pure helpers for the open-coding annotation form. The form is only ever prefilled from the
 * reviewer's OWN saved human annotation — never from an automated result.
 */
import type { Annotation, CriterionLabel, FailureMode, Severity } from "@/lib/domain/schemas";

export interface FormState {
  notes: string;
  outcome: "pass" | "fail" | null;
  firstFailure: string;
  firstFailureModeId: string; // "" = uncategorised (assigned later in axial coding)
  additionalModeIds: string[];
  severity: Severity | null;
  unsupported: CriterionLabel | null;
}

export const EMPTY_FORM: FormState = {
  notes: "",
  outcome: null,
  firstFailure: "",
  firstFailureModeId: "",
  additionalModeIds: [],
  severity: null,
  unsupported: null,
};

export function formFromAnnotation(a: Annotation): FormState {
  return {
    notes: a.open_coding_notes,
    outcome: a.task_outcome,
    firstFailure: a.first_failure?.description ?? "",
    firstFailureModeId: a.first_failure?.failure_mode_id ?? "",
    additionalModeIds: a.additional_failure_mode_ids,
    severity: a.severity,
    unsupported: a.unsupported_justification_label,
  };
}

export type FieldKey = "reviewer" | "notes" | "outcome" | "firstFailure" | "severity" | "unsupported";
export type FieldErrors = Partial<Record<FieldKey, string>>;

export function validateForm(f: FormState, reviewer: string): FieldErrors {
  const e: FieldErrors = {};
  if (!reviewer.trim()) e.reviewer = "Enter your name — every human label must carry a named reviewer.";
  if (!f.notes.trim()) e.notes = "Write what you observed (required).";
  if (!f.outcome) e.outcome = "Choose Pass or Fail.";
  if (f.outcome === "fail") {
    if (!f.firstFailure.trim()) e.firstFailure = "Describe the first thing that went wrong (required for Fail).";
    if (!f.severity) e.severity = "Choose a severity (required for Fail).";
  }
  if (!f.unsupported) e.unsupported = "Choose Yes, No or Not assessed.";
  return e;
}

export interface AnnotationPayload {
  trace_id: string;
  case_id: string;
  reviewer: string;
  open_coding_notes: string;
  task_outcome: "pass" | "fail";
  first_failure: { description: string; failure_mode_id: string | null } | null;
  additional_failure_mode_ids: string[];
  severity: Severity | null;
  unsupported_justification_label: CriterionLabel;
  taxonomy_version: number | null;
}

/** Build the POST body. Failure fields are only sent for Fail; call validateForm first. */
export function toPayload(
  f: FormState,
  ctx: { trace_id: string; case_id: string; reviewer: string; taxonomy_version: number | null },
): AnnotationPayload {
  const fail = f.outcome === "fail";
  const firstMode = f.firstFailureModeId || null;
  return {
    trace_id: ctx.trace_id,
    case_id: ctx.case_id,
    reviewer: ctx.reviewer.trim(),
    open_coding_notes: f.notes.trim(),
    task_outcome: fail ? "fail" : "pass",
    first_failure: fail ? { description: f.firstFailure.trim(), failure_mode_id: firstMode } : null,
    additional_failure_mode_ids: fail ? [...new Set(f.additionalModeIds)].filter((id) => id !== firstMode) : [],
    severity: fail ? f.severity : null,
    unsupported_justification_label: f.unsupported ?? "not_assessed",
    taxonomy_version: ctx.taxonomy_version,
  };
}

// ---------------------------------------------------------------------------
// Taxonomy presentation
// ---------------------------------------------------------------------------

export function isActiveMode(m: FailureMode): boolean {
  return m.status !== "merged" && m.status !== "retired";
}

/** Seed categories are hypotheses until a human tags them on a reviewed trace. */
export function modeTag(m: FailureMode): string {
  if (m.origin === "seed_hypothesis") return m.status === "observed" ? "seed hypothesis · observed" : "seed hypothesis";
  return m.status === "observed" ? "reviewer-added · observed" : "reviewer-added · provisional";
}

export function modeName(modes: FailureMode[] | null | undefined, id: string | null | undefined): string {
  if (!id) return "Uncategorised";
  const m = modes?.find((x) => x.failure_mode_id === id);
  if (!m) return id;
  return m.status === "merged" && m.merged_into ? `${m.name} (merged into ${m.merged_into})` : m.name;
}

export const CRITERION_TEXT: Record<CriterionLabel, string> = {
  present: "Yes — unsupported claim present",
  absent: "No — claims are supported",
  not_assessed: "Not assessed",
};
