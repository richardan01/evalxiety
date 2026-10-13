/**
 * MOCK pricing agent — for UI development without spending credits.
 *
 * Produces deterministic, schema-valid recommendations with deliberately
 * injected error patterns (seeded by case + config) so every screen has
 * something to show. Mock output is NOT evidence about the real agent: every
 * trace it produces carries execution_mode = "mock" and is labelled in the UI.
 */
import crypto from "node:crypto";
import {
  applicablePromotion,
  computeUnitEconomics,
  discountVsListPct,
  marginFloor,
  requiredApprovals,
  requiredCostBasis,
} from "../domain/economics";
import type { MerchantScenario, PricingPolicy, PricingRecommendation } from "../domain/schemas";
import type { AgentConfig } from "./configs";

function seeded(key: string): number {
  const h = crypto.createHash("sha256").update(key).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function mockRecommendation(
  s: MerchantScenario,
  config: AgentConfig,
  policies: PricingPolicy[],
): PricingRecommendation {
  const r = (salt: string) => seeded(`${s.case_id}|${config.config_id}|${salt}`);

  // Policy choice: stale context makes the mock pick the newest policy it can see unless the
  // decision date is clearly earlier than it (mimics partial date reasoning).
  const sorted = [...policies].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const policy =
    sorted.find((p) => p.effective_from <= s.decision_date) ?? sorted[sorted.length - 1] ?? null;
  if (!policy) {
    throw new Error("Mock agent received no policy context");
  }

  const cost = requiredCostBasis(s, policy);
  const floor = marginFloor(s, policy);
  // Injected error: occasionally applies an expired promotion's relief anyway.
  const wronglyAppliesPromo = s.exception.status === "promotion" && !applicablePromotion(s, policy) && r("promo") < 0.6;
  const floorUsed = wronglyAppliesPromo ? floor.base_floor_pct - 4 : floor.effective_floor_pct;

  const requested = s.request.requested_pricing;
  const atRequested = computeUnitEconomics(s.monthly_volume_usd, s.monthly_transactions, requested, cost);
  let price = requested;
  let decision: PricingRecommendation["decision"] = "accept_request";
  const exceptionAllowsBelowFloor = s.exception.status === "strategic_exception";
  if ((atRequested.gross_margin_pct ?? -Infinity) < floorUsed && !exceptionAllowsBelowFloor) {
    // Counter at the lowest whole-bps rate that clears the floor + 0.5pp.
    const target = (floorUsed + 0.5) / 100;
    const costUsd = atRequested.monthly_cost_usd;
    const neededRevenue = costUsd / (1 - target);
    const bps = Math.ceil(((neededRevenue - s.monthly_transactions * requested.per_txn_fee_usd) / s.monthly_volume_usd) * 10_000);
    price = { rate_bps: bps, per_txn_fee_usd: requested.per_txn_fee_usd };
    decision = "counter_offer";
  }

  const truth = computeUnitEconomics(s.monthly_volume_usd, s.monthly_transactions, price, cost);
  // Injected error: occasionally forgets the per-transaction cost component.
  const arithmeticSlip = r("arith") < 0.2;
  const statedCost = arithmeticSlip
    ? (s.monthly_volume_usd * cost.cost_bps) / 10_000
    : truth.monthly_cost_usd;
  const statedGp = truth.monthly_revenue_usd - statedCost;
  const statedMargin = (statedGp / truth.monthly_revenue_usd) * 100;

  const approvals = requiredApprovals(s, policy, price).filter((a) => {
    // Injected error: sometimes omits the pricing-desk review for missing data.
    return !(a.approver_role === "pricing_desk" && r("approval") < 0.5);
  });

  const id = policy.policy_id;
  const claims: PricingRecommendation["claims"] = [
    { claim: `Policy ${id} applies to this decision.`, evidence_ids: [`${id}§1`, "FACT-decision_date"] },
    {
      claim: `Gross margin at the recommended price is ${round2(statedMargin)}% against a minimum of ${floorUsed}%.`,
      evidence_ids: [`${id}§3`, "FACT-volume", "FACT-transactions", "FACT-cost"],
    },
  ];
  // Injected unsupported claim.
  const unsupported = r("unsupported") < 0.3;
  if (unsupported) {
    claims.push({
      claim: "Competitor pricing in this segment averages 2.2%, so the recommendation is market-competitive.",
      evidence_ids: [],
    });
  }

  return {
    selected_policy_id: id,
    policy_effective_from: policy.effective_from,
    recommended_pricing: price,
    cost_basis_used: cost,
    unit_economics: {
      monthly_volume_usd: s.monthly_volume_usd,
      monthly_transactions: s.monthly_transactions,
      monthly_revenue_usd: round2(truth.monthly_revenue_usd),
      monthly_cost_usd: round2(statedCost),
      monthly_gross_profit_usd: round2(statedGp),
      gross_margin_pct: round2(statedMargin),
    },
    minimum_margin_pct_required: floorUsed,
    meets_minimum_margin: statedMargin >= floorUsed,
    discount_vs_list_pct: round2(discountVsListPct(s, policy, price)),
    requires_human_approval: approvals.length > 0,
    approvals_required: approvals,
    decision,
    explanation:
      `[MOCK OUTPUT] Under ${id}, the ${decision === "accept_request" ? "requested" : "counter-offered"} price yields an estimated ` +
      `${round2(statedMargin)}% gross margin.` +
      (unsupported ? " Competitor pricing in this segment averages 2.2%, so this is market-competitive." : "") +
      (approvals.length ? ` Requires approval from: ${approvals.map((a) => a.approver_role).join(", ")}.` : ""),
    claims,
    data_gaps: s.cost_data.status === "missing" ? ["Merchant cost data unavailable; policy default cost basis used."] : [],
  };
}
