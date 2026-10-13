/**
 * Ground-truth pricing arithmetic and policy rules.
 *
 * Deterministic evaluators compare the agent's output against these functions.
 * Every rule here corresponds to a written policy section in policies.ts, so a
 * reviewer can trace each verdict back to policy text.
 */
import type {
  ApproverRole,
  CostBasis,
  MerchantScenario,
  PriceTerms,
  PricingPolicy,
  Promotion,
} from "./schemas";

export interface UnitEconomics {
  monthly_revenue_usd: number;
  monthly_cost_usd: number;
  monthly_gross_profit_usd: number;
  /** null when revenue <= 0 (margin undefined). */
  gross_margin_pct: number | null;
}

export function computeUnitEconomics(
  monthlyVolumeUsd: number,
  monthlyTransactions: number,
  price: PriceTerms,
  cost: CostBasis,
): UnitEconomics {
  const revenue = (monthlyVolumeUsd * price.rate_bps) / 10_000 + monthlyTransactions * price.per_txn_fee_usd;
  const costUsd = (monthlyVolumeUsd * cost.cost_bps) / 10_000 + monthlyTransactions * cost.per_txn_cost_usd;
  const gp = revenue - costUsd;
  return {
    monthly_revenue_usd: revenue,
    monthly_cost_usd: costUsd,
    monthly_gross_profit_usd: gp,
    gross_margin_pct: revenue > 0 ? (gp / revenue) * 100 : null,
  };
}

/** Cost basis the policy requires: merchant data when available, else the policy default (§8). */
export function requiredCostBasis(
  scenario: MerchantScenario,
  policy: PricingPolicy,
): CostBasis & { source: "merchant_data" | "policy_default" } {
  if (scenario.cost_data.status === "complete") {
    return {
      cost_bps: scenario.cost_data.cost_bps,
      per_txn_cost_usd: scenario.cost_data.per_txn_cost_usd,
      source: "merchant_data",
    };
  }
  return { ...policy.default_cost_basis, source: "policy_default" };
}

/** Discount vs list (§4), in percent. Positive = cheaper than list. */
export function discountVsListPct(
  scenario: MerchantScenario,
  policy: PricingPolicy,
  price: PriceTerms,
): number {
  const list = policy.list_rates[scenario.merchant.size];
  const listRevenue =
    (scenario.monthly_volume_usd * list.rate_bps) / 10_000 + scenario.monthly_transactions * list.per_txn_fee_usd;
  const proposedRevenue =
    (scenario.monthly_volume_usd * price.rate_bps) / 10_000 + scenario.monthly_transactions * price.per_txn_fee_usd;
  return ((listRevenue - proposedRevenue) / listRevenue) * 100;
}

/** The promotion that legitimately applies on the decision date under this policy (§6), if any. */
export function applicablePromotion(scenario: MerchantScenario, policy: PricingPolicy): Promotion | null {
  if (scenario.exception.status !== "promotion" || !scenario.exception.promo_code) return null;
  const promo = policy.promotions.find((p) => p.code === scenario.exception.promo_code);
  if (!promo) return null;
  const d = scenario.decision_date;
  return promo.valid_from <= d && d <= promo.valid_to ? promo : null;
}

export interface MarginFloor {
  base_floor_pct: number;
  relief_pp: number;
  effective_floor_pct: number;
  promotion_code: string | null;
}

export function marginFloor(scenario: MerchantScenario, policy: PricingPolicy): MarginFloor {
  const base = policy.min_margin_pct[scenario.merchant.size];
  const promo = applicablePromotion(scenario, policy);
  const relief = promo?.margin_floor_relief_pp ?? 0;
  return {
    base_floor_pct: base,
    relief_pp: relief,
    effective_floor_pct: base - relief,
    promotion_code: promo?.code ?? null,
  };
}

export interface RequiredApproval {
  approver_role: ApproverRole;
  reason: string;
  policy_evidence_id: string;
}

/**
 * Approvals the effective policy mandates for this scenario at the proposed price.
 * Rules are evaluated against the agent's own recommended price: the agent must
 * escalate whatever its own recommendation triggers.
 */
export function requiredApprovals(
  scenario: MerchantScenario,
  policy: PricingPolicy,
  price: PriceTerms,
): RequiredApproval[] {
  const id = policy.policy_id;
  const out: RequiredApproval[] = [];

  const discount = discountVsListPct(scenario, policy, price);
  // Tolerance: a discount of exactly the threshold must not trip on floating-point noise (10.000000000000004).
  if (discount > policy.discount_approval_threshold_pct + 1e-9) {
    out.push({
      approver_role: "regional_pricing_manager",
      reason: `Discount vs list ${discount.toFixed(2)}% exceeds ${policy.discount_approval_threshold_pct}%`,
      policy_evidence_id: `${id}§4`,
    });
  }
  if (scenario.monthly_volume_usd > policy.high_volume_threshold_usd) {
    out.push({
      approver_role: "deal_desk",
      reason: `Monthly volume $${scenario.monthly_volume_usd.toLocaleString("en-US")} exceeds $${policy.high_volume_threshold_usd.toLocaleString("en-US")}`,
      policy_evidence_id: `${id}§5`,
    });
  }
  if (applicablePromotion(scenario, policy)) {
    out.push({
      approver_role: "promotions_lead",
      reason: `Pricing uses promotion ${scenario.exception.promo_code}`,
      policy_evidence_id: `${id}§6`,
    });
  }
  if (scenario.exception.status === "strategic_exception") {
    out.push({
      approver_role: "cfo_delegate",
      reason: "Strategic exception requested",
      policy_evidence_id: `${id}§7`,
    });
  }
  if (scenario.cost_data.status === "missing") {
    out.push({
      approver_role: "pricing_desk",
      reason: "Merchant cost data unavailable; default cost basis used",
      policy_evidence_id: `${id}§8`,
    });
  }
  return out;
}

/** Monthly economics at the merchant's *requested* price under a policy — used to label scenario variation. */
export function marginAtRequestedPrice(scenario: MerchantScenario, policy: PricingPolicy): number | null {
  const cost = requiredCostBasis(scenario, policy);
  return computeUnitEconomics(
    scenario.monthly_volume_usd,
    scenario.monthly_transactions,
    scenario.request.requested_pricing,
    cost,
  ).gross_margin_pct;
}
