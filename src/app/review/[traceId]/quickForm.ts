/**
 * Quick review: the rubric checklist IS the form.
 *
 * Mapping to the stored human annotation:
 * - each checklist "problem" tags its linked failure mode; the first problem in
 *   checklist order (policy → math → floor → approvals → evidence, i.e. pipeline
 *   order) is the first failure unless the reviewer overrides it;
 * - the judge-linked item becomes the judge's reference label
 *   (ok → absent, problem → present, skip → not assessed);
 * - the reviewer's one-line "what went wrong first" is the first-failure description.
 * Nothing is ever prefilled from automated results.
 */
import type { Annotation, CriterionLabel, Severity } from "@/lib/domain/schemas";
import type { ChecklistAnswer, ChecklistItem, RubricVersion } from "@/lib/rubric/rubric";

export interface QuickForm {
  checklist: Record<string, ChecklistAnswer>;
  verdict: "pass" | "fail" | null;
  severity: Severity | null;
  whatWentWrong: string; // first-failure description (required for Fail)
  note: string; // optional extra observations
  firstFailureOverride: string | null; // failure_mode_id chosen by the reviewer, or null = auto
}

export const EMPTY_QUICK: QuickForm = {
  checklist: {},
  verdict: null,
  severity: null,
  whatWentWrong: "",
  note: "",
  firstFailureOverride: null,
};

export function judgeItem(rubric: RubricVersion): ChecklistItem | null {
  return rubric.review_checklist.find((c) => c.checked_by === "judge") ?? null;
}

export function problemModes(form: QuickForm, rubric: RubricVersion): string[] {
  return rubric.review_checklist
    .filter((c) => form.checklist[c.id] === "problem" && c.failure_mode_id)
    .map((c) => c.failure_mode_id!);
}

export function autoFirstFailureMode(form: QuickForm, rubric: RubricVersion): string | null {
  return problemModes(form, rubric)[0] ?? null;
}

export function unsupportedLabel(form: QuickForm, rubric: RubricVersion): CriterionLabel {
  const item = judgeItem(rubric);
  if (!item) return "not_assessed";
  const a = form.checklist[item.id];
  return a === "ok" ? "absent" : a === "problem" ? "present" : "not_assessed";
}

export type QuickErrors = Partial<Record<"reviewer" | "verdict" | "severity" | "whatWentWrong" | "evidence", string>>;

export function validateQuick(form: QuickForm, reviewer: string, rubric: RubricVersion): QuickErrors {
  const e: QuickErrors = {};
  if (!reviewer.trim()) e.reviewer = "Enter your name.";
  if (!form.verdict) e.verdict = "Pick Pass or Fail.";
  const j = judgeItem(rubric);
  if (j && !form.checklist[j.id]) e.evidence = "Answer this one (or ? to skip) — it calibrates the AI judge.";
  if (form.verdict === "fail") {
    if (!form.severity) e.severity = "Pick a severity.";
    if (!form.whatWentWrong.trim()) e.whatWentWrong = "One line: what went wrong first?";
  }
  return e;
}

export function quickToPayload(
  form: QuickForm,
  rubric: RubricVersion,
  ctx: { trace_id: string; case_id: string; reviewer: string; taxonomy_version: number | null },
) {
  const fail = form.verdict === "fail";
  const modes = problemModes(form, rubric);
  const first = fail ? (form.firstFailureOverride ?? modes[0] ?? null) : null;
  return {
    trace_id: ctx.trace_id,
    case_id: ctx.case_id,
    reviewer: ctx.reviewer.trim(),
    open_coding_notes: [fail ? form.whatWentWrong.trim() : "", form.note.trim()].filter(Boolean).join("\n\n"),
    task_outcome: fail ? ("fail" as const) : ("pass" as const),
    first_failure: fail ? { description: form.whatWentWrong.trim(), failure_mode_id: first } : null,
    additional_failure_mode_ids: fail ? [...new Set(modes)].filter((m) => m !== first) : [],
    severity: fail ? form.severity : null,
    unsupported_justification_label: unsupportedLabel(form, rubric),
    taxonomy_version: ctx.taxonomy_version,
    checklist: form.checklist,
    rubric_version: rubric.version,
  };
}

/** Rebuild the form from the reviewer's own saved annotation (never from automated results). */
export function quickFromAnnotation(a: Annotation, rubric: RubricVersion): QuickForm {
  const checklist: Record<string, ChecklistAnswer> = { ...(a.checklist ?? {}) };
  // Older annotations (before the checklist existed): recover the judge item from the explicit label.
  const j = judgeItem(rubric);
  if (j && !checklist[j.id]) {
    checklist[j.id] = a.unsupported_justification_label === "present" ? "problem" : a.unsupported_justification_label === "absent" ? "ok" : "skip";
  }
  const auto = problemModes({ ...EMPTY_QUICK, checklist }, rubric)[0] ?? null;
  const savedFirst = a.first_failure?.failure_mode_id ?? null;
  const description = a.first_failure?.description ?? "";
  const extra = a.open_coding_notes.startsWith(description) ? a.open_coding_notes.slice(description.length).trim() : a.open_coding_notes;
  return {
    checklist,
    verdict: a.task_outcome,
    severity: a.severity,
    whatWentWrong: description,
    note: a.task_outcome === "fail" ? extra : a.open_coding_notes,
    firstFailureOverride: savedFirst !== auto ? savedFirst : null,
  };
}
