import { describe, expect, it } from "vitest";
import type { ExperimentRun } from "@/lib/domain/schemas";
import { demoSteps } from "./demoPath";
import type { OverviewData } from "./types";

function overview(over: Partial<OverviewData> = {}): OverviewData {
  return {
    executions: { total: 0, live: 0, mock: 0, errors: 0, live_cost_usd: 0 },
    review: { reviewed_traces: 0, reviewed_live: 0, target_min: 10, target_max: 15, unreviewed: 0, gold_examples: 0, gold_dev: 0, gold_heldout: 0, demo_labels: 0, demo_gold: 0 },
    pass_all_rate: null,
    candidate_summary: null,
    candidate_run: null,
    critical_failures: null,
    release_status: "INSUFFICIENT_EVIDENCE",
    release_reasons: [
      { code: "no_candidate_run", level: "INSUFFICIENT_EVIDENCE", message: "No candidate run selected.", case_ids: [] },
      { code: "no_baseline", level: "INSUFFICIENT_EVIDENCE", message: "No baseline run on the same frozen set.", case_ids: [] },
    ],
    observed_failure_modes: 0,
    taxonomy_version: 1,
    scenario_count: 20,
    trend: { frozen_set_id: null, points: [], fixed: [], regressed: [], new_critical_regressions: [], still_failing: [] },
    history: [],
    pipeline: [],
    judge: null,
    ...over,
  };
}

const run = { run_id: "run_x" } as ExperimentRun;

describe("demo path", () => {
  it("has exactly the 9 demo steps with their links", () => {
    const steps = demoSteps(overview());
    expect(steps.map((s) => s.href)).toEqual([
      "/review",
      "/review",
      "/review",
      "/review/taxonomy",
      "/evaluators",
      "/evaluators#calibration",
      "/experiments",
      "/experiments",
      "/release",
    ]);
  });

  it("an empty store marks nothing done and never claims untracked steps", () => {
    const states = demoSteps(overview()).map((s) => s.state);
    expect(states).toEqual(["todo", "neutral", "todo", "todo", "neutral", "todo", "todo", "todo", "neutral"]);
    expect(demoSteps(overview())[7].detail).toBe("No candidate run selected.");
  });

  it("derives done states from overview data", () => {
    const steps = demoSteps(
      overview({
        executions: { total: 42, live: 0, mock: 42, errors: 0, live_cost_usd: 0 },
        review: { reviewed_traces: 12, reviewed_live: 0, target_min: 10, target_max: 15, unreviewed: 30, gold_examples: 5, gold_dev: 3, gold_heldout: 2, demo_labels: 0, demo_gold: 0 },
        observed_failure_modes: 2,
        taxonomy_version: 3,
        candidate_run: run,
        release_status: "APPROVED_FOR_DEMO",
        release_reasons: [],
      }),
    );
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "neutral", "neutral", "done", "done", "done"]);
    expect(steps[3].detail).toContain("taxonomy v3");
  });

  it("step 8 stays open while the baseline is missing, even with a candidate run", () => {
    const steps = demoSteps(
      overview({
        candidate_run: run,
        release_reasons: [{ code: "no_baseline", level: "INSUFFICIENT_EVIDENCE", message: "No baseline run.", case_ids: [] }],
      }),
    );
    expect(steps[6].state).toBe("done");
    expect(steps[7].state).toBe("todo");
    expect(steps[7].detail).toBe("No baseline run.");
  });
});
