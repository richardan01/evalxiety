import { describe, expect, it } from "vitest";
import type { Annotation, GoldExample } from "@/lib/domain/schemas";
import { SPLIT_ASSIGNMENT } from "@/lib/domain/scenarios";
import { selectCandidates, type TraceInfo } from "./candidates";

function ann(over: Partial<Annotation>): Annotation {
  return {
    annotation_id: "ann_1",
    trace_id: "t1",
    case_id: "C01",
    reviewer: "Dana",
    label_source: "human", checklist: {}, rubric_version: null,
    created_at: "2026-10-13T00:00:00.000Z",
    updated_at: "2026-10-13T00:00:00.000Z",
    open_coding_notes: "",
    task_outcome: "pass",
    first_failure: null,
    additional_failure_mode_ids: [],
    severity: null,
    unsupported_justification_label: "absent",
    taxonomy_version: null,
    ...over,
  };
}

const traces: TraceInfo[] = [
  { trace_id: "t1", case_id: "C01", execution_mode: "live", data_origin: "synthetic" },
  { trace_id: "t2", case_id: "C06", execution_mode: "mock", data_origin: "synthetic" },
  { trace_id: "t3", case_id: "CUSTOM-X", execution_mode: "live", data_origin: "user_supplied" },
];

const gold = (over: Partial<GoldExample>) => ({ gold_id: "g1", trace_id: "t1", annotation_id: "ann_1", review_timestamp: "2026-10-13T00:00:00.000Z", ...over }) as GoldExample;

describe("selectCandidates", () => {
  it("includes human annotations on frozen synthetic cases only, with their split", () => {
    const { candidates } = selectCandidates(
      [ann({}), ann({ annotation_id: "a2", trace_id: "t2", case_id: "C06" }), ann({ annotation_id: "a3", trace_id: "t3", case_id: "CUSTOM-X" }), ann({ annotation_id: "a4", trace_id: "missing" })],
      [],
      traces,
      SPLIT_ASSIGNMENT,
    );
    expect(candidates.map((c) => [c.annotation.annotation_id, c.split])).toEqual([
      ["ann_1", "dev"],
      ["a2", "heldout"],
    ]);
  });

  it("drops already-promoted annotations unless they changed after promotion", () => {
    const same = selectCandidates([ann({})], [gold({})], traces, SPLIT_ASSIGNMENT);
    expect(same.candidates).toHaveLength(0);
    const changed = selectCandidates([ann({ updated_at: "2026-10-14T00:00:00.000Z" })], [gold({})], traces, SPLIT_ASSIGNMENT);
    expect(changed.candidates[0]).toMatchObject({ reason: "annotation_updated_since_promotion", existing_gold_id: "g1" });
  });

  it("counts other reviewers' annotations of an already-gold trace as superseded", () => {
    const r = selectCandidates([ann({ annotation_id: "other", reviewer: "Lee" })], [gold({})], traces, SPLIT_ASSIGNMENT);
    expect(r.candidates).toHaveLength(0);
    expect(r.superseded).toBe(1);
  });
});
