import { describe, expect, it } from "vitest";
import { Annotation } from "@/lib/domain/schemas";
import { EMPTY_FORM, formFromAnnotation, toPayload, validateForm, type FormState } from "./annotationForm";

const ctx = { trace_id: "trace_1", case_id: "C01", reviewer: " Ada ", taxonomy_version: 2 };

describe("annotation form", () => {
  it("requires reviewer, notes, outcome and the judge reference label", () => {
    expect(Object.keys(validateForm(EMPTY_FORM, "")).sort()).toEqual(["notes", "outcome", "reviewer", "unsupported"]);
  });

  it("requires a first-failure description and severity only when the outcome is Fail", () => {
    const pass: FormState = { ...EMPTY_FORM, notes: "ok", outcome: "pass", unsupported: "absent" };
    expect(validateForm(pass, "Ada")).toEqual({});
    const fail: FormState = { ...pass, outcome: "fail" };
    expect(Object.keys(validateForm(fail, "Ada")).sort()).toEqual(["firstFailure", "severity"]);
  });

  it("drops failure fields for Pass and de-duplicates additional modes for Fail", () => {
    const f: FormState = {
      notes: " saw X ",
      outcome: "pass",
      firstFailure: "leftover",
      firstFailureModeId: "wrong_policy_version",
      additionalModeIds: ["a"],
      severity: "major",
      unsupported: "absent",
    };
    const passBody = toPayload(f, ctx);
    expect(passBody).toMatchObject({ reviewer: "Ada", open_coding_notes: "saw X", first_failure: null, severity: null, additional_failure_mode_ids: [] });

    const failBody = toPayload({ ...f, outcome: "fail", additionalModeIds: ["a", "a", "wrong_policy_version"] }, ctx);
    expect(failBody.first_failure).toEqual({ description: "leftover", failure_mode_id: "wrong_policy_version" });
    expect(failBody.additional_failure_mode_ids).toEqual(["a"]);
    expect(failBody.severity).toBe("major");

    const uncategorised = toPayload({ ...f, outcome: "fail", firstFailureModeId: "" }, ctx);
    expect(uncategorised.first_failure?.failure_mode_id).toBeNull();
  });

  it("round-trips a saved human annotation into the form", () => {
    const a = Annotation.parse({
      annotation_id: "ann_1",
      trace_id: "trace_1",
      case_id: "C01",
      reviewer: "Ada",
      label_source: "human",
      created_at: "2026-10-13T00:00:00Z",
      updated_at: "2026-10-13T00:00:00Z",
      open_coding_notes: "notes",
      task_outcome: "fail",
      first_failure: { description: "first", failure_mode_id: null },
      additional_failure_mode_ids: ["x"],
      severity: "critical",
      unsupported_justification_label: "present",
      taxonomy_version: 1,
    });
    const f = formFromAnnotation(a);
    expect(validateForm(f, "Ada")).toEqual({});
    expect(toPayload(f, ctx)).toMatchObject({
      task_outcome: "fail",
      first_failure: { description: "first", failure_mode_id: null },
      additional_failure_mode_ids: ["x"],
      severity: "critical",
      unsupported_justification_label: "present",
    });
  });
});
