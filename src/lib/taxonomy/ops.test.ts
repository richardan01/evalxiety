import { describe, expect, it } from "vitest";
import {
  addMode,
  attachRepresentativeTrace,
  editMode,
  mergeModes,
  observedFrequencies,
  resolveModeId,
  withObservedStatus,
} from "./ops";
import { SEED_TAXONOMY } from "./seed";
import type { Annotation } from "../domain/schemas";

const modes = SEED_TAXONOMY.failure_modes;

const ann = (traceId: string, first: string | null, extra: string[] = [], reviewer = "rich"): Annotation => ({
  annotation_id: `a_${traceId}_${reviewer}`,
  trace_id: traceId,
  case_id: "C01",
  reviewer,
  label_source: "human", checklist: {}, rubric_version: null, demo: false,
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
  open_coding_notes: "note",
  task_outcome: first ? "fail" : "pass",
  first_failure: first ? { description: "x", failure_mode_id: first } : null,
  additional_failure_mode_ids: extra,
  severity: first ? "major" : null,
  unsupported_justification_label: "not_assessed",
  taxonomy_version: 1,
});

describe("taxonomy editing", () => {
  it("adds a reviewer-defined mode with a slug id", () => {
    const next = addMode(modes, { name: "Expired promo applied", definition: "Uses a promo outside its window", severity: "major" });
    const m = next.find((x) => x.failure_mode_id === "expired_promo_applied")!;
    expect(m.origin).toBe("reviewer_added");
    expect(m.status).toBe("provisional");
    expect(() => addMode(next, { name: "Expired promo applied", definition: "dup", severity: "minor" })).toThrow(/exists/);
  });

  it("edits definitions and severity", () => {
    const next = editMode(modes, "incorrect_task_outcome", { definition: "new def", severity: "critical" });
    expect(next.find((m) => m.failure_mode_id === "incorrect_task_outcome")).toMatchObject({ definition: "new def", severity: "critical" });
  });

  it("merges a mode, keeps it for history, and rolls representative traces into the target", () => {
    let next = attachRepresentativeTrace(modes, "margin_guardrail_violation", "t1");
    next = mergeModes(next, "margin_guardrail_violation", "incorrect_task_outcome");
    expect(next.find((m) => m.failure_mode_id === "margin_guardrail_violation")).toMatchObject({ status: "merged", merged_into: "incorrect_task_outcome" });
    expect(next.find((m) => m.failure_mode_id === "incorrect_task_outcome")!.representative_trace_ids).toContain("t1");
    expect(resolveModeId(next, "margin_guardrail_violation")).toBe("incorrect_task_outcome");
    expect(() => mergeModes(next, "incorrect_task_outcome", "incorrect_task_outcome")).toThrow();
    expect(() => mergeModes(next, "wrong_policy_version", "margin_guardrail_violation")).toThrow(/itself merged/);
  });
});

describe("observed frequencies (human annotations only)", () => {
  it("seed hypotheses have zero observations until a human tags them", () => {
    const f = observedFrequencies(modes, []);
    expect(f.every((x) => x.any_count === 0)).toBe(true);
    expect(withObservedStatus(modes, f).every((m) => m.status === "provisional")).toBe(true);
  });

  it("counts first failures and any-mentions per trace, once per trace across reviewers", () => {
    const f = observedFrequencies(modes, [
      ann("t1", "wrong_policy_version", ["missing_human_approval"]),
      ann("t1", "wrong_policy_version", [], "second-reviewer"),
      ann("t2", "missing_human_approval"),
      ann("t3", null),
    ]);
    const get = (id: string) => f.find((x) => x.failure_mode_id === id)!;
    expect(get("wrong_policy_version")).toMatchObject({ first_failure_count: 1, any_count: 1 });
    expect(get("missing_human_approval")).toMatchObject({ first_failure_count: 1, any_count: 2 });
    expect(withObservedStatus(modes, f).find((m) => m.failure_mode_id === "wrong_policy_version")!.status).toBe("observed");
  });

  it("merged modes roll up into their target", () => {
    const merged = mergeModes(modes, "margin_guardrail_violation", "incorrect_task_outcome");
    const f = observedFrequencies(merged, [ann("t1", "margin_guardrail_violation")]);
    expect(f.find((x) => x.failure_mode_id === "incorrect_task_outcome")!.first_failure_count).toBe(1);
    expect(f.some((x) => x.failure_mode_id === "margin_guardrail_violation")).toBe(false);
  });

  it("ignores anything that is not a human label", () => {
    const fake = { ...ann("t9", "wrong_policy_version"), label_source: "ai" } as unknown as Annotation;
    expect(observedFrequencies(modes, [fake]).find((x) => x.failure_mode_id === "wrong_policy_version")!.any_count).toBe(0);
  });
});

describe("guards", () => {
  it("retire/attach validate the mode and protect merge roll-ups", async () => {
    const { retireMode } = await import("./ops");
    expect(() => retireMode(modes, "nope")).toThrow(/Unknown/);
    const merged = mergeModes(modes, "margin_guardrail_violation", "incorrect_task_outcome");
    expect(() => retireMode(merged, "margin_guardrail_violation")).toThrow(/merged into/);
    expect(() => retireMode(merged, "incorrect_task_outcome")).toThrow(/orphan/);
    expect(() => attachRepresentativeTrace(modes, "nope", "t1")).toThrow(/Unknown/);
    const retired = retireMode(modes, "wrong_policy_version");
    expect(() => attachRepresentativeTrace(retired, "wrong_policy_version", "t1")).toThrow(/retired/);
  });
});
