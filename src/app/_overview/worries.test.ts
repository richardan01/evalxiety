import { describe, expect, it } from "vitest";
import { headline, worries } from "./worries";
import type { OverviewData } from "./types";

function overview(over: Partial<OverviewData> = {}): OverviewData {
  return {
    executions: { total: 40, live: 40, mock: 0, errors: 0, live_cost_usd: 1 },
    review: { reviewed_traces: 6, reviewed_live: 6, target_min: 5, target_max: 10, unreviewed: 0, gold_examples: 0, gold_dev: 0, gold_heldout: 0 },
    pass_all_rate: 0.9,
    candidate_summary: null,
    candidate_run: { run_id: "r" } as OverviewData["candidate_run"],
    critical_failures: 0,
    release_status: "ELIGIBLE_FOR_DEMO_APPROVAL",
    release_reasons: [],
    observed_failure_modes: 1,
    taxonomy_version: 1,
    scenario_count: 20,
    trend: { frozen_set_id: "FROZEN-FULL-v1", points: [], fixed: [], regressed: [], new_critical_regressions: [], still_failing: [] },
    history: [],
    pipeline: [],
    judge: { n: 12, tpr: 0.9, tnr: 0.9, status_label: "x", mode: "live" },
    ...over,
  };
}

describe("Evalxiety worries", () => {
  it("leads with blockers: regressions and policy violations", () => {
    const w = worries(
      overview({
        release_status: "NO_SHIP",
        trend: { frozen_set_id: "FROZEN-FULL-v1", points: [], fixed: [], regressed: ["C13"], new_critical_regressions: [{ case_id: "C13", evaluator_id: "missing_mandatory_approval" }], still_failing: [] },
        release_reasons: [{ code: "critical_policy_violation", level: "NO_SHIP", message: "", case_ids: ["C07", "C13"] }],
      }),
    );
    expect(w[0]).toMatchObject({ level: "blocker" });
    expect(w[0].text).toContain("C13");
    expect(w[1].text).toContain("C07, C13");
  });

  it("worries about thin human review, an unchecked judge, mock data and unrun held-out cases", () => {
    const texts = worries(
      overview({ review: { ...overview().review, reviewed_traces: 2 }, judge: { n: 0, tpr: null, tnr: null, status_label: "", mode: "live" }, executions: { total: 5, live: 0, mock: 5, errors: 0, live_cost_usd: 0 }, candidate_run: null }),
    ).map((x) => x.text);
    expect(texts.some((t) => t.includes("Only 2 human reviews"))).toBe(true);
    expect(texts.some((t) => t.includes("never been compared"))).toBe(true);
    expect(texts.some((t) => t.includes("MOCK"))).toBe(true);
    expect(texts.some((t) => t.includes("held-out"))).toBe(true);
  });

  it("always keeps the synthetic-data caveat, even when everything else is fine", () => {
    const w = worries(overview());
    expect(w.every((x) => x.level === "caveat")).toBe(true);
    expect(w.at(-1)!.text).toContain("synthetic");
  });

  it("has a nervous headline for every release status", () => {
    for (const s of ["NO_SHIP", "INSUFFICIENT_EVIDENCE", "ELIGIBLE_FOR_DEMO_APPROVAL", "APPROVED_FOR_DEMO"]) expect(headline(s)).not.toBe("Checking…");
  });
});
