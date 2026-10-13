import { describe, expect, it } from "vitest";
import type { Annotation } from "@/lib/domain/schemas";
import { SEED_TAXONOMY } from "@/lib/taxonomy/seed";
import { observedFrequencies } from "@/lib/taxonomy/ops";
import { applyTaxonomyOp, frequencyRows, modeSplit, uncategorisedNotes } from "./derive";

const seed = SEED_TAXONOMY.failure_modes;
const ctx = { annotations: [] as Annotation[], traceExists: true, evaluatorIds: ["stale_policy_used"] };

function ann(over: Partial<Annotation>): Annotation {
  return {
    annotation_id: "ann_1",
    trace_id: "trace_1",
    case_id: "C01",
    reviewer: "Dana",
    label_source: "human", checklist: {}, rubric_version: null,
    created_at: "2026-10-13T00:00:00.000Z",
    updated_at: "2026-10-13T00:00:00.000Z",
    open_coding_notes: "",
    task_outcome: "fail",
    first_failure: { description: "Used the 2025 rate card", failure_mode_id: null },
    additional_failure_mode_ids: [],
    severity: "major",
    unsupported_justification_label: "not_assessed",
    taxonomy_version: null,
    ...over,
  };
}

describe("applyTaxonomyOp", () => {
  it("adds a reviewer category as provisional and returns its id", () => {
    const r = applyTaxonomyOp(seed, { type: "add", name: "Quotes expired promo", definition: "x", severity: "minor" }, ctx);
    expect(r.failure_mode_id).toBe("quotes_expired_promo");
    expect(r.modes.at(-1)).toMatchObject({ status: "provisional", origin: "reviewer_added" });
  });

  it("rejects edits that change nothing, empty names and unknown evaluators", () => {
    const id = seed[0].failure_mode_id;
    expect(() => applyTaxonomyOp(seed, { type: "edit", failure_mode_id: id, name: seed[0].name }, ctx)).toThrow(/Nothing changed/);
    expect(() => applyTaxonomyOp(seed, { type: "edit", failure_mode_id: id, name: "  " }, ctx)).toThrow(/empty/);
    expect(() => applyTaxonomyOp(seed, { type: "edit", failure_mode_id: id, linked_evaluator_id: "nope" }, ctx)).toThrow(/Unknown evaluator/);
    const ok = applyTaxonomyOp(seed, { type: "edit", failure_mode_id: id, linked_evaluator_id: null }, ctx);
    expect(ok.modes[0].linked_evaluator_id).toBeNull();
  });

  it("guards merge and retire against merged/retired modes", () => {
    const [a, b, c] = seed.map((m) => m.failure_mode_id);
    const merged = applyTaxonomyOp(seed, { type: "merge", source_id: a, target_id: b }, ctx).modes;
    expect(() => applyTaxonomyOp(merged, { type: "merge", source_id: a, target_id: c }, ctx)).toThrow(/already merged/);
    expect(() => applyTaxonomyOp(merged, { type: "retire", failure_mode_id: a }, ctx)).toThrow(/merged/);
    const retired = applyTaxonomyOp(merged, { type: "retire", failure_mode_id: c }, ctx).modes;
    expect(() => applyTaxonomyOp(retired, { type: "retire", failure_mode_id: c }, ctx)).toThrow(/already retired/);
    expect(() => applyTaxonomyOp(retired, { type: "merge", source_id: b, target_id: c }, ctx)).toThrow(/retired/);
    expect(() => applyTaxonomyOp(seed, { type: "retire", failure_mode_id: "ghost" }, ctx)).toThrow(/Unknown failure mode/);
  });

  it("only attaches traces a human tagged with the (resolved) mode", () => {
    const [a, b] = seed.map((m) => m.failure_mode_id);
    const merged = applyTaxonomyOp(seed, { type: "merge", source_id: a, target_id: b }, ctx).modes;
    const tagged = ann({ first_failure: { description: "d", failure_mode_id: a } });
    const op = { type: "attach_trace" as const, failure_mode_id: b, trace_id: "trace_1" };
    expect(() => applyTaxonomyOp(merged, op, { ...ctx, annotations: [] })).toThrow(/No human annotation/);
    expect(() => applyTaxonomyOp(merged, op, { ...ctx, traceExists: false, annotations: [tagged] })).toThrow(/not found/);
    const r = applyTaxonomyOp(merged, op, { ...ctx, annotations: [tagged] });
    expect(r.modes.find((m) => m.failure_mode_id === b)!.representative_trace_ids).toEqual(["trace_1"]);
    expect(() => applyTaxonomyOp(r.modes, op, { ...ctx, annotations: [tagged] })).toThrow(/already/);
  });
});

describe("read helpers", () => {
  it("lists only failed notes without a category as uncategorised", () => {
    const notes = [
      ann({ annotation_id: "a" }),
      ann({ annotation_id: "b", first_failure: { description: "d", failure_mode_id: seed[0].failure_mode_id } }),
      ann({ annotation_id: "c", task_outcome: "pass", first_failure: null }),
    ];
    expect(uncategorisedNotes(notes).map((a) => a.annotation_id)).toEqual(["a"]);
  });

  it("never turns a zero denominator into 0%", () => {
    const rows = frequencyRows(seed, observedFrequencies(seed, []), 0);
    expect(rows.every((r) => r.first_share === null && r.any_share === null)).toBe(true);
  });

  it("sorts by first-failure count and keeps the denominator", () => {
    const id = seed[3].failure_mode_id;
    const anns = [
      ann({ trace_id: "t1", first_failure: { description: "d", failure_mode_id: id } }),
      ann({ trace_id: "t2", reviewer: "Lee", first_failure: { description: "d", failure_mode_id: id } }),
    ];
    const rows = frequencyRows(seed, observedFrequencies(seed, anns), 4);
    expect(rows[0].mode.failure_mode_id).toBe(id);
    expect(rows[0].first_share).toBe(0.5);
  });

  it("splits trace ids by execution mode", () => {
    expect(modeSplit(["a", "b", "c"], { a: "live", b: "mock" })).toEqual({ live: 1, mock: 1, unknown: 1 });
  });
});
