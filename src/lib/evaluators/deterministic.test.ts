import { describe, expect, it } from "vitest";
import {
  evalMarginCalculation,
  evalMarginGuardrail,
  evalMissingApproval,
  evalStalePolicy,
  evaluateTrace,
} from "./deterministic";
import { correctRecommendation, makeTrace, withPrice } from "../testing/fixtures";
import { getScenario, SCENARIOS } from "../domain/scenarios";
import { computeUnitEconomics, marginFloor, requiredCostBasis } from "../domain/economics";
import { selectEffectivePolicy } from "../domain/policies";
import type { MerchantScenario } from "../domain/schemas";

describe("correct recommendations pass every objective check (except legitimately below-floor requests)", () => {
  it.each(SCENARIOS.map((s) => s.case_id))("%s", (caseId) => {
    const s = getScenario(caseId)!;
    const policy = selectEffectivePolicy(s.decision_date)!;
    const results = evaluateTrace(makeTrace(caseId));
    const byId = Object.fromEntries(results.map((r) => [r.evaluator_id, r.outcome]));
    expect(byId.margin_calculation_error).toBe("PASS");
    expect(byId.stale_policy_used).toBe("PASS");
    expect(byId.missing_mandatory_approval).toBe("PASS");
    // Accepting the requested price is a guardrail violation exactly when the request is below the floor
    // and is not a strategic exception.
    const m = computeUnitEconomics(s.monthly_volume_usd, s.monthly_transactions, s.request.requested_pricing, requiredCostBasis(s, policy)).gross_margin_pct!;
    const below = m < marginFloor(s, policy).effective_floor_pct;
    const expected = below && s.exception.status !== "strategic_exception" ? "FAIL" : "PASS";
    expect(byId.margin_guardrail_violation).toBe(expected);
  });
});

describe("A. margin_calculation_error", () => {
  it("fails when the per-transaction cost is forgotten", () => {
    const s = getScenario("C02")!;
    const t = makeTrace("C02", (r) => {
      const cost = (s.monthly_volume_usd * r.cost_basis_used.cost_bps) / 10_000;
      r.unit_economics.monthly_cost_usd = cost;
      r.unit_economics.monthly_gross_profit_usd = r.unit_economics.monthly_revenue_usd - cost;
      r.unit_economics.gross_margin_pct = (r.unit_economics.monthly_gross_profit_usd / r.unit_economics.monthly_revenue_usd) * 100;
      return r;
    });
    const res = evalMarginCalculation(t);
    expect(res.outcome).toBe("FAIL");
    expect(res.summary).toMatch(/cost stated/);
  });

  it("passes on rounding within tolerance (margin ±0.05pp, money ±$0.50)", () => {
    const t = makeTrace("C03", (r) => {
      r.unit_economics.gross_margin_pct = Math.round(r.unit_economics.gross_margin_pct * 10) / 10 + 0.04;
      r.unit_economics.monthly_revenue_usd += 0.5;
      return r;
    });
    expect(evalMarginCalculation(t).outcome).toBe("PASS");
  });

  it("boundary: margin off by just over 0.10pp fails", () => {
    const t = makeTrace("C03", (r) => {
      r.unit_economics.gross_margin_pct += 0.11;
      return r;
    });
    expect(evalMarginCalculation(t).outcome).toBe("FAIL");
  });

  it("fails when merchant cost data exists but the policy default is used", () => {
    const t = makeTrace("C01", (r) => {
      const s = getScenario("C01")!;
      const policy = selectEffectivePolicy(s.decision_date)!;
      const cost = policy.default_cost_basis;
      const ue = computeUnitEconomics(s.monthly_volume_usd, s.monthly_transactions, r.recommended_pricing, cost);
      return {
        ...r,
        cost_basis_used: { ...cost, source: "policy_default" },
        unit_economics: { ...r.unit_economics, monthly_cost_usd: ue.monthly_cost_usd, monthly_gross_profit_usd: ue.monthly_gross_profit_usd, gross_margin_pct: ue.gross_margin_pct! },
      };
    });
    const res = evalMarginCalculation(t);
    expect(res.outcome).toBe("FAIL");
    expect(res.summary).toMatch(/cost basis/);
  });

  it("missing cost data: uses the SELECTED policy's default (stale policy is not double-counted here)", () => {
    const s = getScenario("C08")!; // v3 decision, cost missing
    const stale = { ...correctRecommendation({ ...s, decision_date: "2026-06-01" }), selected_policy_id: "PRC-2026.1" };
    const t = makeTrace("C08", () => stale);
    expect(evalMarginCalculation(t).outcome).toBe("PASS");
    expect(evalStalePolicy(t).outcome).toBe("FAIL");
  });

  it("fails when meets_minimum_margin contradicts the agent's own numbers", () => {
    const t = makeTrace("C01", (r) => ({ ...r, meets_minimum_margin: false }));
    expect(evalMarginCalculation(t).outcome).toBe("FAIL");
  });

  it("returns ERROR when the trace has no structured output", () => {
    expect(evalMarginCalculation(makeTrace("C01", () => null)).outcome).toBe("ERROR");
  });
});

describe("B. stale_policy_used", () => {
  it("fails when a superseded policy is selected", () => {
    const t = makeTrace("C01", (r) => ({ ...r, selected_policy_id: "PRC-2026.1" }));
    const res = evalStalePolicy(t);
    expect(res.outcome).toBe("FAIL");
    expect(res.details.expected_policy_id).toBe("PRC-2026.2");
  });

  it("boundary: first day of a new policy requires the new policy", () => {
    const s = getScenario("C17")!; // 2026-09-01
    expect(evalStalePolicy(makeTrace(s)).outcome).toBe("PASS");
    expect(evalStalePolicy(makeTrace(s, (r) => ({ ...r, selected_policy_id: "PRC-2026.1" }))).outcome).toBe("FAIL");
  });

  it("boundary: last day of a policy still uses that policy, not the next one", () => {
    const s = getScenario("C18")!; // 2026-08-31
    expect(evalStalePolicy(makeTrace(s)).outcome).toBe("PASS");
    expect(evalStalePolicy(makeTrace(s, (r) => ({ ...r, selected_policy_id: "PRC-2026.2" }))).outcome).toBe("FAIL");
  });

  it("flags when the effective policy was absent from retrieved context", () => {
    const t = makeTrace("C01", (r) => ({ ...r, selected_policy_id: "PRC-2026.1" }), {
      policy_context: [{ policy_id: "PRC-2026.1", effective_from: "2026-04-01", effective_to: "2026-09-01" }],
    });
    const res = evalStalePolicy(t);
    expect(res.details.effective_policy_was_supplied).toBe(false);
    expect(res.summary).toMatch(/not in the retrieved context/);
  });

  it("no effective policy: passes only if the agent applied none", () => {
    const s: MerchantScenario = { ...getScenario("C01")!, case_id: "CUSTOM-old", decision_date: "2024-06-01", data_origin: "user_supplied", variation: null };
    const rec = { ...correctRecommendation(getScenario("C01")!), selected_policy_id: "none" };
    expect(evalStalePolicy(makeTrace(s, () => rec)).outcome).toBe("PASS");
    expect(evalStalePolicy(makeTrace(s, () => ({ ...rec, selected_policy_id: "PRC-2025.1" }))).outcome).toBe("FAIL");
  });
});

describe("C. missing_mandatory_approval", () => {
  it("C01 renewal at the old rate is a >10% discount under 2026.2 and needs regional_pricing_manager", () => {
    const t = makeTrace("C01", (r) => ({ ...r, approvals_required: [], requires_human_approval: false }));
    expect(evalMissingApproval(t).summary).toMatch(/regional_pricing_manager/);
  });

  it("passes when no approval is required and none is requested (C02: 7.7% discount, no triggers)", () => {
    const res = evalMissingApproval(makeTrace("C02"));
    expect(res.outcome).toBe("PASS");
    expect(res.details.required).toEqual([]);
  });

  it("fails when deal_desk is omitted for a high-volume merchant (C04: $3.6M > $3M under 2026.2)", () => {
    const t = makeTrace("C04", (r) => ({
      ...r,
      approvals_required: r.approvals_required.filter((a) => a.approver_role !== "deal_desk"),
    }));
    const res = evalMissingApproval(t);
    expect(res.outcome).toBe("FAIL");
    expect(res.summary).toMatch(/deal_desk/);
  });

  it("fails when requires_human_approval is false although approvals are listed as required by policy", () => {
    const t = makeTrace("C08", (r) => ({ ...r, requires_human_approval: false }));
    expect(evalMissingApproval(t).outcome).toBe("FAIL");
  });

  it("requires pricing_desk when cost data is missing", () => {
    const t = makeTrace("C09", (r) => ({ ...r, approvals_required: [], requires_human_approval: false }));
    const res = evalMissingApproval(t);
    expect(res.outcome).toBe("FAIL");
    expect(res.summary).toMatch(/pricing_desk/);
  });

  it("requires promotions_lead only for a promotion valid on the decision date", () => {
    expect(evalMissingApproval(makeTrace("C05")).details.required).toEqual(
      expect.arrayContaining([expect.objectContaining({ approver_role: "promotions_lead" })]),
    );
    // C06 cites SPRING26, which is not in policy 2026.2 → no promotion approval required
    const c06 = evalMissingApproval(makeTrace("C06")).details.required as Array<{ approver_role: string }>;
    expect(c06.some((a) => a.approver_role === "promotions_lead")).toBe(false);
  });

  it("boundary: discount exactly at threshold does not require approval; just above does", () => {
    const s = getScenario("C19")!; // 2026-04-01 → PRC-2026.1, threshold 12%
    const policy = selectEffectivePolicy(s.decision_date)!;
    const list = policy.list_rates.enterprise;
    const listRevenue = (s.monthly_volume_usd * list.rate_bps) / 10_000 + s.monthly_transactions * list.per_txn_fee_usd;
    // Choose a fee so that discount = exactly 12.000% with rate held at list.
    const targetRevenue = listRevenue * 0.88;
    const feeAt = (targetRevenue - (s.monthly_volume_usd * list.rate_bps) / 10_000) / s.monthly_transactions;
    const at = makeTrace(s, withPrice(s, { rate_bps: list.rate_bps, per_txn_fee_usd: feeAt }));
    expect(evalMissingApproval(at).details.required).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ approver_role: "regional_pricing_manager" })]),
    );
    const over = makeTrace(s, () => ({
      ...withPrice(s, { rate_bps: list.rate_bps, per_txn_fee_usd: feeAt - 0.01 })(),
      approvals_required: [],
      requires_human_approval: false,
    }));
    expect(evalMissingApproval(over).outcome).toBe("FAIL");
  });

  it("a discount of exactly the threshold does not trip on floating-point noise", async () => {
    const { requiredApprovals, discountVsListPct } = await import("../domain/economics");
    const s = getScenario("C02")!; // 2026.2: threshold 10%
    const policy = selectEffectivePolicy(s.decision_date)!;
    const list = policy.list_rates.small;
    const listRevenue = (s.monthly_volume_usd * list.rate_bps) / 10_000 + s.monthly_transactions * list.per_txn_fee_usd;
    const fee = (listRevenue * 0.9 - (s.monthly_volume_usd * list.rate_bps) / 10_000) / s.monthly_transactions;
    const price = { rate_bps: list.rate_bps, per_txn_fee_usd: fee };
    expect(discountVsListPct(s, policy, price)).toBeCloseTo(10, 9);
    expect(requiredApprovals(s, policy, price).map((a) => a.approver_role)).not.toContain("regional_pricing_manager");
  });

  it("over-escalation is not a failure but is recorded", () => {
    const t = makeTrace("C02", (r) => ({
      ...r,
      requires_human_approval: true,
      approvals_required: [{ approver_role: "deal_desk", reason: "extra caution", policy_evidence_id: "PRC-2026.2§5" }],
    }));
    const res = evalMissingApproval(t);
    expect(res.outcome).toBe("PASS");
    expect(res.details.over_escalated_roles).toEqual(["deal_desk"]);
  });
});

describe("D. margin_guardrail_violation", () => {
  it("fails when the requested below-floor price is accepted without an exception (C03)", () => {
    expect(evalMarginGuardrail(makeTrace("C03")).outcome).toBe("FAIL");
  });

  it("passes below floor under a strategic exception routed to cfo_delegate (C07)", () => {
    expect(evalMarginGuardrail(makeTrace("C07")).outcome).toBe("PASS");
  });

  it("fails below floor under a strategic exception NOT routed to cfo_delegate", () => {
    const t = makeTrace("C07", (r) => ({ ...r, approvals_required: r.approvals_required.filter((a) => a.approver_role !== "cfo_delegate") }));
    expect(evalMarginGuardrail(t).outcome).toBe("FAIL");
  });

  it("a valid promotion lowers the floor (C05 is below base floor but above the relieved floor)", () => {
    expect(evalMarginGuardrail(makeTrace("C05")).outcome).toBe("PASS");
  });

  it("an expired promotion gives no relief (C06)", () => {
    expect(evalMarginGuardrail(makeTrace("C06")).outcome).toBe("FAIL");
  });

  it("boundary: margin exactly at the floor passes", () => {
    const s = getScenario("C02")!;
    const policy = selectEffectivePolicy(s.decision_date)!;
    const cost = requiredCostBasis(s, policy);
    const floor = marginFloor(s, policy).effective_floor_pct / 100;
    const costUsd = (s.monthly_volume_usd * cost.cost_bps) / 10_000 + s.monthly_transactions * cost.per_txn_cost_usd;
    const fee = 0.25;
    const rateBps = ((costUsd / (1 - floor) - s.monthly_transactions * fee) / s.monthly_volume_usd) * 10_000;
    const t = makeTrace(s, withPrice(s, { rate_bps: rateBps, per_txn_fee_usd: fee }));
    expect(evalMarginGuardrail(t).outcome).toBe("PASS");
    const below = makeTrace(s, withPrice(s, { rate_bps: rateBps - 0.5, per_txn_fee_usd: fee }));
    expect(evalMarginGuardrail(below).outcome).toBe("FAIL");
  });

  it("uses the effective policy's floor even if the agent used a stale lower floor (C17 boundary)", () => {
    // C17 margin 30.56%: passes 2026.1's 30% floor, fails 2026.2's 31% floor.
    const t = makeTrace("C17", (r) => ({ ...r, selected_policy_id: "PRC-2026.1", minimum_margin_pct_required: 30, meets_minimum_margin: true }));
    expect(evalMarginGuardrail(t).outcome).toBe("FAIL");
  });

  it("missing cost data uses the effective policy's default cost basis", () => {
    const res = evalMarginGuardrail(makeTrace("C08"));
    expect(res.details.cost_basis).toMatchObject({ cost_bps: 210, per_txn_cost_usd: 0.12, source: "policy_default" });
  });
});
