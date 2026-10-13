import { describe, expect, it } from "vitest";
import { ALL, DEFAULT_FILTERS, NO_RUN, filterRows, modeMix, tallyEvaluator, tallyJudge } from "./matrix";
import type { EvaluatorResultRow } from "./types";

function row(over: Partial<EvaluatorResultRow> & { outcome?: "PASS" | "FAIL" | "NOT_APPLICABLE" | "ERROR" }): EvaluatorResultRow {
  const { outcome = "PASS", ...rest } = over;
  return {
    trace_id: "t",
    case_id: "C01",
    agent_version: "pricing-agent@baseline-v1",
    execution_mode: "live",
    experiment_run_id: null,
    timestamp: "2026-10-13T00:00:00.000Z",
    split: "dev",
    execution_error: null,
    deterministic: [
      { evaluator_id: "stale_policy_used", evaluator_version: "1.0.0", outcome, severity: "critical", summary: "", details: {} },
    ],
    judge: null,
    ...rest,
  };
}

describe("filterRows", () => {
  const rows = [
    row({ trace_id: "a", execution_mode: "mock", experiment_run_id: "run_1" }),
    row({ trace_id: "b", agent_version: "pricing-agent@corrected-v2", split: "heldout", experiment_run_id: "run_2" }),
    row({ trace_id: "c", split: null }),
  ];
  const ids = (f: Partial<typeof DEFAULT_FILTERS>) => filterRows(rows, { ...DEFAULT_FILTERS, ...f }).map((r) => r.trace_id);

  it("returns everything with default filters", () => expect(ids({})).toEqual(["a", "b", "c"]));
  it("filters by mode", () => expect(ids({ mode: "mock" })).toEqual(["a"]));
  it("filters by config", () => expect(ids({ config: "pricing-agent@corrected-v2" })).toEqual(["b"]));
  it("filters by run id, including traces with no run", () => {
    expect(ids({ runId: "run_2" })).toEqual(["b"]);
    expect(ids({ runId: NO_RUN })).toEqual(["c"]);
    expect(ids({ runId: ALL })).toEqual(["a", "b", "c"]);
  });
  it("filters by split; custom = no split", () => {
    expect(ids({ split: "heldout" })).toEqual(["b"]);
    expect(ids({ split: "custom" })).toEqual(["c"]);
  });
});

describe("tallies", () => {
  it("counts every outcome against the number of rows shown", () => {
    const rows = [row({ outcome: "PASS" }), row({ outcome: "FAIL" }), row({ outcome: "NOT_APPLICABLE" }), row({ outcome: "ERROR" })];
    expect(tallyEvaluator(rows, "stale_policy_used")).toEqual({ pass: 1, fail: 1, not_applicable: 1, error: 1, missing: 0, total: 4 });
    expect(tallyEvaluator(rows, "unknown")).toMatchObject({ missing: 4, total: 4 });
  });

  it("is all zeros on an empty set (no invented rates)", () => {
    expect(tallyEvaluator([], "stale_policy_used")).toEqual({ pass: 0, fail: 0, not_applicable: 0, error: 0, missing: 0, total: 0 });
  });

  it("tallies judge verdicts separately, with not-judged traces counted", () => {
    const j = (verdict: "PASS" | "FAIL" | "REQUIRES_REVIEW" | "ERROR") => ({
      judge_result_id: "j",
      judge_version: "v",
      model_id: "m",
      verdict,
      output: null,
      error: null,
      execution_mode: "live" as const,
      created_at: "",
    });
    const rows = [row({ judge: j("FAIL") }), row({ judge: j("REQUIRES_REVIEW") }), row({ judge: j("PASS") }), row({ judge: j("ERROR") }), row({})];
    expect(tallyJudge(rows)).toEqual({ pass: 1, fail: 1, requires_review: 1, error: 1, not_judged: 1, total: 5 });
    expect(modeMix([row({}), row({ execution_mode: "mock" })])).toEqual({ live: 1, mock: 1 });
  });
});
