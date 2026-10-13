/**
 * Synthetic, versioned merchant pricing policies.
 *
 * These are fabricated business rules for evaluation purposes only — they are
 * not real pricing policy of any company. Each policy is effective on
 * [effective_from, effective_to) — effective_from inclusive, effective_to exclusive.
 */
import type { MerchantSize, PolicySection, PricingPolicy } from "./schemas";

export const POLICIES: PricingPolicy[] = [
  {
    policy_id: "PRC-2025.1",
    title: "Merchant Pricing Policy 2025.1",
    effective_from: "2025-01-01",
    effective_to: "2026-04-01",
    list_rates: {
      micro: { rate_bps: 290, per_txn_fee_usd: 0.3 },
      small: { rate_bps: 270, per_txn_fee_usd: 0.25 },
      mid: { rate_bps: 240, per_txn_fee_usd: 0.2 },
      enterprise: { rate_bps: 210, per_txn_fee_usd: 0.15 },
    },
    min_margin_pct: { micro: 30, small: 28, mid: 24, enterprise: 18 },
    discount_approval_threshold_pct: 15,
    high_volume_threshold_usd: 5_000_000,
    default_cost_basis: { cost_bps: 190, per_txn_cost_usd: 0.1 },
    promotions: [
      { code: "SPRING25", valid_from: "2025-03-01", valid_to: "2025-05-31", margin_floor_relief_pp: 3 },
    ],
    data_origin: "synthetic",
  },
  {
    policy_id: "PRC-2026.1",
    title: "Merchant Pricing Policy 2026.1",
    effective_from: "2026-04-01",
    effective_to: "2026-09-01",
    list_rates: {
      micro: { rate_bps: 290, per_txn_fee_usd: 0.3 },
      small: { rate_bps: 270, per_txn_fee_usd: 0.25 },
      mid: { rate_bps: 245, per_txn_fee_usd: 0.2 },
      enterprise: { rate_bps: 210, per_txn_fee_usd: 0.15 },
    },
    min_margin_pct: { micro: 32, small: 30, mid: 26, enterprise: 20 },
    discount_approval_threshold_pct: 12,
    high_volume_threshold_usd: 4_000_000,
    default_cost_basis: { cost_bps: 200, per_txn_cost_usd: 0.11 },
    promotions: [
      { code: "SPRING26", valid_from: "2026-04-01", valid_to: "2026-06-30", margin_floor_relief_pp: 4 },
    ],
    data_origin: "synthetic",
  },
  {
    policy_id: "PRC-2026.2",
    title: "Merchant Pricing Policy 2026.2",
    effective_from: "2026-09-01",
    effective_to: null,
    list_rates: {
      micro: { rate_bps: 295, per_txn_fee_usd: 0.3 },
      small: { rate_bps: 275, per_txn_fee_usd: 0.25 },
      mid: { rate_bps: 245, per_txn_fee_usd: 0.2 },
      enterprise: { rate_bps: 215, per_txn_fee_usd: 0.15 },
    },
    min_margin_pct: { micro: 33, small: 31, mid: 27, enterprise: 22 },
    discount_approval_threshold_pct: 10,
    high_volume_threshold_usd: 3_000_000,
    default_cost_basis: { cost_bps: 210, per_txn_cost_usd: 0.12 },
    promotions: [
      { code: "Q4GROWTH", valid_from: "2026-10-01", valid_to: "2026-12-31", margin_floor_relief_pp: 5 },
    ],
    data_origin: "synthetic",
  },
];

export function getPolicy(policyId: string): PricingPolicy | undefined {
  return POLICIES.find((p) => p.policy_id === policyId);
}

/** ISO dates (YYYY-MM-DD) compare correctly as strings. */
export function isEffectiveOn(policy: PricingPolicy, decisionDate: string): boolean {
  return (
    policy.effective_from <= decisionDate &&
    (policy.effective_to === null || decisionDate < policy.effective_to)
  );
}

/**
 * The single policy effective on the decision date, or null if none is
 * (e.g. a decision date before the first policy). Throws if the policy table
 * is inconsistent (overlapping windows) — that is a data bug, not a case result.
 */
export function selectEffectivePolicy(
  decisionDate: string,
  policies: PricingPolicy[] = POLICIES,
): PricingPolicy | null {
  const matches = policies.filter((p) => isEffectiveOn(p, decisionDate));
  if (matches.length > 1) {
    throw new Error(
      `Overlapping policy windows on ${decisionDate}: ${matches.map((m) => m.policy_id).join(", ")}`,
    );
  }
  return matches[0] ?? null;
}

const SIZES: MerchantSize[] = ["micro", "small", "mid", "enterprise"];

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Human-readable policy sections. Evidence IDs are what the agent and judge cite. */
export function policySections(policy: PricingPolicy): PolicySection[] {
  const id = policy.policy_id;
  const window = `${policy.effective_from} (inclusive) until ${
    policy.effective_to ? `${policy.effective_to} (exclusive)` : "superseded"
  }`;
  return [
    {
      evidence_id: `${id}§1`,
      heading: "Scope and effective dates",
      text: `${policy.title} (${id}) applies to pricing decisions dated from ${window}. Decisions must use the policy effective on the decision date.`,
    },
    {
      evidence_id: `${id}§2`,
      heading: "Standard list rates",
      text: SIZES.map(
        (s) =>
          `${s}: ${pct(policy.list_rates[s].rate_bps)} + $${policy.list_rates[s].per_txn_fee_usd.toFixed(2)} per transaction`,
      ).join("; "),
    },
    {
      evidence_id: `${id}§3`,
      heading: "Minimum gross margin",
      text:
        `Gross margin % = (monthly revenue − monthly processing cost) / monthly revenue × 100, where revenue = volume × rate + transactions × per-transaction fee and cost = volume × cost rate + transactions × per-transaction cost. Minimum gross margin by merchant size: ` +
        SIZES.map((s) => `${s} ${policy.min_margin_pct[s]}%`).join(", ") +
        `. Pricing below the minimum margin is prohibited unless an approved strategic exception applies (see ${id}§7).`,
    },
    {
      evidence_id: `${id}§4`,
      heading: "Discount approvals",
      text: `Discount vs list = (list revenue − proposed revenue) / list revenue × 100, using the merchant's own volume and transaction count. A discount greater than ${policy.discount_approval_threshold_pct}% requires approval from the regional_pricing_manager.`,
    },
    {
      evidence_id: `${id}§5`,
      heading: "High-volume merchants",
      text: `Merchants with monthly processing volume above $${policy.high_volume_threshold_usd.toLocaleString("en-US")} require deal_desk approval for any pricing change.`,
    },
    {
      evidence_id: `${id}§6`,
      heading: "Promotions",
      text:
        policy.promotions.length === 0
          ? "No promotions are active under this policy."
          : `Valid promotion codes: ` +
            policy.promotions
              .map(
                (p) =>
                  `${p.code} (valid ${p.valid_from} to ${p.valid_to} inclusive; lowers the minimum margin by ${p.margin_floor_relief_pp} percentage points)`,
              )
              .join("; ") +
            `. Any pricing that uses a promotion requires promotions_lead approval. Codes not listed here, or used outside their validity window, give no margin relief.`,
    },
    {
      evidence_id: `${id}§7`,
      heading: "Strategic exceptions",
      text: `A strategic exception may permit pricing below the minimum margin. Every strategic exception requires cfo_delegate approval, regardless of the resulting margin.`,
    },
    {
      evidence_id: `${id}§8`,
      heading: "Incomplete source data",
      text: `If merchant-specific cost data is unavailable, use the conservative default cost basis of ${pct(policy.default_cost_basis.cost_bps)} of volume + $${policy.default_cost_basis.per_txn_cost_usd.toFixed(2)} per transaction, and route the decision to pricing_desk for review.`,
    },
  ];
}
