import { describe, expect, it } from "vitest";
import { SCENARIOS, SPLIT_ASSIGNMENT } from "./scenarios";
import { MerchantScenario } from "./schemas";
import { selectEffectivePolicy } from "./policies";
import { applicablePromotion, marginAtRequestedPrice, marginFloor } from "./economics";

function proximity(delta: number) {
  if (delta >= 3) return "comfortable";
  if (delta >= 0) return "near_above";
  if (delta >= -3) return "near_below";
  return "far_below";
}

function volumeBand(v: number) {
  if (v < 50_000) return "low";
  if (v < 1_000_000) return "medium";
  if (v <= 3_000_000) return "high";
  return "very_high";
}

const PERIOD: Record<string, string> = { "PRC-2025.1": "v1", "PRC-2026.1": "v2", "PRC-2026.2": "v3" };
const BOUNDARY_DATES = new Set(["2026-03-31", "2026-04-01", "2026-08-31", "2026-09-01"]);

describe("synthetic scenarios", () => {
  it("has 20 schema-valid cases with unique ids", () => {
    expect(SCENARIOS).toHaveLength(20);
    for (const s of SCENARIOS) MerchantScenario.parse(s);
    expect(new Set(SCENARIOS.map((s) => s.case_id)).size).toBe(20);
  });

  it("variation labels are re-derivable from the raw numbers", () => {
    for (const s of SCENARIOS) {
      const v = s.variation!;
      const policy = selectEffectivePolicy(s.decision_date)!;
      expect(v.merchant_size, s.case_id).toBe(s.merchant.size);
      expect(v.volume_band, s.case_id).toBe(volumeBand(s.monthly_volume_usd));
      expect(v.source_completeness, s.case_id).toBe(s.cost_data.status === "complete" ? "complete" : "missing_cost_data");
      const expectedPeriod = BOUNDARY_DATES.has(s.decision_date) ? "boundary" : PERIOD[policy.policy_id];
      expect(v.policy_period, s.case_id).toBe(expectedPeriod);
      const promo = applicablePromotion(s, policy);
      const exc =
        s.exception.status === "promotion" ? (promo ? "promotion_valid" : "promotion_expired") : s.exception.status;
      expect(v.exception_status, s.case_id).toBe(exc);
      const margin = marginAtRequestedPrice(s, policy)!;
      const floor = marginFloor(s, policy).effective_floor_pct;
      expect(v.margin_proximity, `${s.case_id} margin ${margin.toFixed(2)} floor ${floor}`).toBe(proximity(margin - floor));
    }
  });

  it("covers every level of every variation dimension", () => {
    const levels = (k: keyof NonNullable<(typeof SCENARIOS)[0]["variation"]>) => new Set(SCENARIOS.map((s) => s.variation![k]));
    expect(levels("merchant_size").size).toBe(4);
    expect(levels("volume_band").size).toBe(4);
    expect(levels("margin_proximity").size).toBe(4);
    expect(levels("policy_period").size).toBe(4);
    expect(levels("exception_status").size).toBe(4);
    expect(levels("source_completeness").size).toBe(2);
  });

  it("split assigns every case exactly once: 12 dev / 8 held-out", () => {
    expect(Object.keys(SPLIT_ASSIGNMENT).sort()).toEqual(SCENARIOS.map((s) => s.case_id).sort());
    const vals = Object.values(SPLIT_ASSIGNMENT);
    expect(vals.filter((v) => v === "dev")).toHaveLength(12);
    expect(vals.filter((v) => v === "heldout")).toHaveLength(8);
  });

  it("held-out split contains two cases of each merchant size", () => {
    const held = SCENARIOS.filter((s) => SPLIT_ASSIGNMENT[s.case_id] === "heldout");
    for (const size of ["micro", "small", "mid", "enterprise"]) {
      expect(held.filter((s) => s.merchant.size === size)).toHaveLength(2);
    }
  });
});
