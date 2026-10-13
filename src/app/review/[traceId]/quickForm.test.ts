import { describe, expect, it } from "vitest";
import { DEFAULT_RUBRIC } from "@/lib/rubric/rubric";
import { EMPTY_QUICK, quickFromAnnotation, quickToPayload, unsupportedLabel, validateQuick } from "./quickForm";
import type { Annotation } from "@/lib/domain/schemas";

const R = DEFAULT_RUBRIC;
const ctx = { trace_id: "t1", case_id: "C04", reviewer: " Rich ", taxonomy_version: 2 };

describe("quick review form", () => {
  it("a pass needs only the verdict and the evidence answer", () => {
    const f = { ...EMPTY_QUICK, verdict: "pass" as const, checklist: { evidence: "ok" as const } };
    expect(validateQuick(f, "Rich", R)).toEqual({});
    const p = quickToPayload(f, R, ctx);
    expect(p).toMatchObject({ task_outcome: "pass", first_failure: null, severity: null, unsupported_justification_label: "absent", reviewer: "Rich" });
  });

  it("a fail needs severity and a one-line description", () => {
    const f = { ...EMPTY_QUICK, verdict: "fail" as const, checklist: { evidence: "skip" as const } };
    expect(Object.keys(validateQuick(f, "Rich", R)).sort()).toEqual(["severity", "whatWentWrong"]);
  });

  it("first problem in pipeline order becomes the first failure; others become extra tags", () => {
    const f = {
      ...EMPTY_QUICK,
      verdict: "fail" as const,
      severity: "critical" as const,
      whatWentWrong: "Used 2026.1 on a 2026-10-01 decision",
      checklist: { approvals: "problem" as const, policy: "problem" as const, floor: "problem" as const, evidence: "ok" as const },
    };
    const p = quickToPayload(f, R, ctx);
    expect(p.first_failure).toEqual({ description: "Used 2026.1 on a 2026-10-01 decision", failure_mode_id: "wrong_policy_version" });
    expect(p.additional_failure_mode_ids).toEqual(["margin_guardrail_violation", "missing_human_approval"]);
    expect(p.checklist).toEqual(f.checklist);
    expect(p.rubric_version).toBe(1);
  });

  it("reviewer can override which failure came first", () => {
    const f = {
      ...EMPTY_QUICK,
      verdict: "fail" as const,
      severity: "major" as const,
      whatWentWrong: "x",
      checklist: { policy: "problem" as const, math: "problem" as const, evidence: "ok" as const },
      firstFailureOverride: "incorrect_margin_calculation",
    };
    const p = quickToPayload(f, R, ctx);
    expect(p.first_failure?.failure_mode_id).toBe("incorrect_margin_calculation");
    expect(p.additional_failure_mode_ids).toEqual(["wrong_policy_version"]);
  });

  it("evidence answer maps to the judge's reference label", () => {
    expect(unsupportedLabel({ ...EMPTY_QUICK, checklist: { evidence: "problem" } }, R)).toBe("present");
    expect(unsupportedLabel({ ...EMPTY_QUICK, checklist: { evidence: "ok" } }, R)).toBe("absent");
    expect(unsupportedLabel({ ...EMPTY_QUICK, checklist: { evidence: "skip" } }, R)).toBe("not_assessed");
    expect(unsupportedLabel(EMPTY_QUICK, R)).toBe("not_assessed");
  });

  it("round-trips a saved annotation, including ones saved before the checklist existed", () => {
    const f = { ...EMPTY_QUICK, verdict: "fail" as const, severity: "critical" as const, whatWentWrong: "Stale policy", note: "Also skipped deal desk", checklist: { policy: "problem" as const, evidence: "ok" as const } };
    const p = quickToPayload(f, R, ctx);
    const saved = { ...p, annotation_id: "a", label_source: "human", created_at: "", updated_at: "" } as Annotation;
    expect(quickFromAnnotation(saved, R)).toEqual(f);
    const legacy = { ...saved, checklist: {}, unsupported_justification_label: "present" } as Annotation;
    expect(quickFromAnnotation(legacy, R).checklist).toEqual({ evidence: "problem" });
  });
});
