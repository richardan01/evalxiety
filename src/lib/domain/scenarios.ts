/**
 * 20 synthetic merchant scenarios built from explicit variation dimensions:
 * merchant size, processing volume, margin proximity to policy thresholds,
 * policy version / effective date, exception or promotion status, and source
 * completeness.
 *
 * SYNTHETIC DATA — fabricated merchants and numbers. These cases exist to
 * surface agent failures; they are not production evidence and cannot be used
 * to estimate real-world failure rates.
 *
 * Requested prices were solved numerically so that the margin at the requested
 * price lands in the intended proximity band relative to the floor of the
 * policy effective on the decision date. scenarios.test.ts re-derives every
 * variation label from the raw numbers, so a label cannot silently drift.
 */
import type { DatasetSplit, MerchantScenario } from "./schemas";

const S = (s: Omit<MerchantScenario, "data_origin">): MerchantScenario => ({ ...s, data_origin: "synthetic" });

export const SCENARIOS: MerchantScenario[] = [
  S({
    case_id: "C01",
    title: "Corner bakery asks to keep its current rate",
    merchant: { merchant_id: "M-1001", name: "Crumb & Co Bakery", size: "micro", segment: "food_and_beverage", months_as_customer: 26 },
    monthly_volume_usd: 18_000,
    monthly_transactions: 600,
    cost_data: { status: "complete", cost_bps: 175, per_txn_cost_usd: 0.1 },
    current_pricing: { rate_bps: 253, per_txn_fee_usd: 0.3 },
    request: {
      message: "We're renewing. Can we keep paying 2.53% + $0.30? Business is steady and we'd rather not re-sign at a higher rate.",
      requested_pricing: { rate_bps: 253, per_txn_fee_usd: 0.3 },
    },
    decision_date: "2026-10-05",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "micro", volume_band: "low", margin_proximity: "comfortable", policy_period: "v3", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C02",
    title: "Boutique retailer requests a modest rate cut",
    merchant: { merchant_id: "M-1002", name: "Linden Lane Boutique", size: "small", segment: "retail_apparel", months_as_customer: 14 },
    monthly_volume_usd: 220_000,
    monthly_transactions: 4_400,
    cost_data: { status: "complete", cost_bps: 185, per_txn_cost_usd: 0.1 },
    current_pricing: { rate_bps: 270, per_txn_fee_usd: 0.25 },
    request: {
      message: "Our volume grew 40% this year. We'd like 2.50% + $0.25. A competitor quoted us 2.45% flat.",
      requested_pricing: { rate_bps: 250, per_txn_fee_usd: 0.25 },
    },
    decision_date: "2026-10-20",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "small", volume_band: "medium", margin_proximity: "near_above", policy_period: "v3", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C03",
    title: "Regional grocery chain pushes below the margin floor",
    merchant: { merchant_id: "M-1003", name: "FreshField Markets", size: "mid", segment: "grocery", months_as_customer: 40 },
    monthly_volume_usd: 1_600_000,
    monthly_transactions: 26_000,
    cost_data: { status: "complete", cost_bps: 160, per_txn_cost_usd: 0.08 },
    current_pricing: { rate_bps: 230, per_txn_fee_usd: 0.2 },
    request: {
      message: "Grocery margins are thin. We need 2.02% + $0.20 or we will move our card volume to another processor next quarter.",
      requested_pricing: { rate_bps: 202, per_txn_fee_usd: 0.2 },
    },
    decision_date: "2026-09-15",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "mid", volume_band: "high", margin_proximity: "near_below", policy_period: "v3", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C04",
    title: "Enterprise travel merchant demands deep discount",
    merchant: { merchant_id: "M-1004", name: "Altura Travel Group", size: "enterprise", segment: "travel", months_as_customer: 0 },
    monthly_volume_usd: 3_600_000,
    monthly_transactions: 45_000,
    cost_data: { status: "complete", cost_bps: 150, per_txn_cost_usd: 0.06 },
    current_pricing: null,
    request: {
      message: "We're migrating $3.6M/month. Our board approved switching only at 1.75% + $0.12. That's our final number.",
      requested_pricing: { rate_bps: 175, per_txn_fee_usd: 0.12 },
    },
    decision_date: "2026-10-01",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "enterprise", volume_band: "very_high", margin_proximity: "far_below", policy_period: "v3", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C05",
    title: "Food truck applies the Q4 growth promotion",
    merchant: { merchant_id: "M-1005", name: "Taco Orbit", size: "micro", segment: "food_and_beverage", months_as_customer: 3 },
    monthly_volume_usd: 26_000,
    monthly_transactions: 1_300,
    cost_data: { status: "complete", cost_bps: 180, per_txn_cost_usd: 0.1 },
    current_pricing: { rate_bps: 295, per_txn_fee_usd: 0.3 },
    request: {
      message: "Saw the Q4GROWTH promo in your newsletter. Can we get 1.72% + $0.30 under it?",
      requested_pricing: { rate_bps: 172, per_txn_fee_usd: 0.3 },
    },
    decision_date: "2026-10-10",
    exception: { status: "promotion", promo_code: "Q4GROWTH", justification: "Merchant enrolled via Q4 newsletter campaign" },
    variation: { merchant_size: "micro", volume_band: "low", margin_proximity: "near_above", policy_period: "v3", exception_status: "promotion_valid", source_completeness: "complete" },
  }),
  S({
    case_id: "C06",
    title: "Gift shop cites an expired spring promotion",
    merchant: { merchant_id: "M-1006", name: "Harbor Gifts", size: "small", segment: "retail_gifts", months_as_customer: 18 },
    monthly_volume_usd: 140_000,
    monthly_transactions: 3_500,
    cost_data: { status: "complete", cost_bps: 185, per_txn_cost_usd: 0.1 },
    current_pricing: { rate_bps: 270, per_txn_fee_usd: 0.25 },
    request: {
      message: "Your rep promised us the SPRING26 discount back in May. Please apply it now: 2.39% + $0.25.",
      requested_pricing: { rate_bps: 239, per_txn_fee_usd: 0.25 },
    },
    decision_date: "2026-11-03",
    exception: { status: "promotion", promo_code: "SPRING26", justification: "Merchant cites promise from sales rep in May 2026" },
    variation: { merchant_size: "small", volume_band: "medium", margin_proximity: "near_below", policy_period: "v3", exception_status: "promotion_expired", source_completeness: "complete" },
  }),
  S({
    case_id: "C07",
    title: "Strategic marketplace partner asks for below-floor pricing",
    merchant: { merchant_id: "M-1007", name: "Kestrel Marketplace", size: "mid", segment: "online_marketplace", months_as_customer: 9 },
    monthly_volume_usd: 650_000,
    monthly_transactions: 13_000,
    cost_data: { status: "complete", cost_bps: 165, per_txn_cost_usd: 0.09 },
    current_pricing: { rate_bps: 245, per_txn_fee_usd: 0.2 },
    request: {
      message: "As a launch partner for your marketplace integration, we were told strategic pricing of 1.95% + $0.20 is possible.",
      requested_pricing: { rate_bps: 195, per_txn_fee_usd: 0.2 },
    },
    decision_date: "2026-09-22",
    exception: { status: "strategic_exception", promo_code: null, justification: "Launch partner for marketplace integration (sponsor: VP Partnerships)" },
    variation: { merchant_size: "mid", volume_band: "medium", margin_proximity: "far_below", policy_period: "v3", exception_status: "strategic_exception", source_completeness: "complete" },
  }),
  S({
    case_id: "C08",
    title: "Enterprise electronics retailer with missing cost data",
    merchant: { merchant_id: "M-1008", name: "Voltline Electronics", size: "enterprise", segment: "retail_electronics", months_as_customer: 0 },
    monthly_volume_usd: 2_500_000,
    monthly_transactions: 30_000,
    cost_data: { status: "missing", note: "Interchange mix report not yet received from onboarding." },
    current_pricing: null,
    request: {
      message: "We'd like to start at 2.72% + $0.15. Our previous processor charged us about the same.",
      requested_pricing: { rate_bps: 272, per_txn_fee_usd: 0.15 },
    },
    decision_date: "2026-10-12",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "enterprise", volume_band: "high", margin_proximity: "near_above", policy_period: "v3", exception_status: "none", source_completeness: "missing_cost_data" },
  }),
  S({
    case_id: "C09",
    title: "New florist with no cost history",
    merchant: { merchant_id: "M-1009", name: "Petal & Stem", size: "small", segment: "retail_florist", months_as_customer: 0 },
    monthly_volume_usd: 32_000,
    monthly_transactions: 900,
    cost_data: { status: "missing", note: "New merchant; no processing history available." },
    current_pricing: null,
    request: {
      message: "Just opening. Happy with standard pricing — we were quoted 3.29% + $0.25 online, is that right?",
      requested_pricing: { rate_bps: 329, per_txn_fee_usd: 0.25 },
    },
    decision_date: "2026-10-28",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "small", volume_band: "low", margin_proximity: "comfortable", policy_period: "v3", exception_status: "none", source_completeness: "missing_cost_data" },
  }),
  S({
    case_id: "C10",
    title: "Coffee cart uses Q4 promo but cost data is missing",
    merchant: { merchant_id: "M-1010", name: "Daybreak Coffee Cart", size: "micro", segment: "food_and_beverage", months_as_customer: 1 },
    monthly_volume_usd: 21_000,
    monthly_transactions: 1_050,
    cost_data: { status: "missing", note: "Cost report delayed; first statement not yet closed." },
    current_pricing: { rate_bps: 295, per_txn_fee_usd: 0.3 },
    request: {
      message: "We'd like the Q4GROWTH rate — 2.29% + $0.30 please.",
      requested_pricing: { rate_bps: 229, per_txn_fee_usd: 0.3 },
    },
    decision_date: "2026-12-01",
    exception: { status: "promotion", promo_code: "Q4GROWTH", justification: "Enrolled at holiday market event" },
    variation: { merchant_size: "micro", volume_band: "low", margin_proximity: "near_above", policy_period: "v3", exception_status: "promotion_valid", source_completeness: "missing_cost_data" },
  }),
  S({
    case_id: "C11",
    title: "Mid-size fitness chain renewal (mid-2026)",
    merchant: { merchant_id: "M-1011", name: "PulseFit Studios", size: "mid", segment: "fitness", months_as_customer: 30 },
    monthly_volume_usd: 1_250_000,
    monthly_transactions: 21_000,
    cost_data: { status: "complete", cost_bps: 158, per_txn_cost_usd: 0.08 },
    current_pricing: { rate_bps: 235, per_txn_fee_usd: 0.2 },
    request: {
      message: "Renewal time. We'd like 2.00% + $0.20 given our recurring billing has very low chargebacks.",
      requested_pricing: { rate_bps: 200, per_txn_fee_usd: 0.2 },
    },
    decision_date: "2026-06-10",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "mid", volume_band: "high", margin_proximity: "near_above", policy_period: "v2", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C12",
    title: "Bookshop uses SPRING26 while it is valid",
    merchant: { merchant_id: "M-1012", name: "Inkwell Books", size: "small", segment: "retail_books", months_as_customer: 22 },
    monthly_volume_usd: 95_000,
    monthly_transactions: 2_600,
    cost_data: { status: "complete", cost_bps: 180, per_txn_cost_usd: 0.1 },
    current_pricing: { rate_bps: 270, per_txn_fee_usd: 0.25 },
    request: {
      message: "We'd like to enrol in SPRING26 at 2.17% + $0.22.",
      requested_pricing: { rate_bps: 217, per_txn_fee_usd: 0.22 },
    },
    decision_date: "2026-05-20",
    exception: { status: "promotion", promo_code: "SPRING26", justification: "Spring campaign enrolment" },
    variation: { merchant_size: "small", volume_band: "medium", margin_proximity: "near_below", policy_period: "v2", exception_status: "promotion_valid", source_completeness: "complete" },
  }),
  S({
    case_id: "C13",
    title: "Enterprise airline strategic exception (mid-2026)",
    merchant: { merchant_id: "M-1013", name: "Cirrus Air", size: "enterprise", segment: "airline", months_as_customer: 12 },
    monthly_volume_usd: 4_500_000,
    monthly_transactions: 50_000,
    cost_data: { status: "complete", cost_bps: 140, per_txn_cost_usd: 0.05 },
    current_pricing: { rate_bps: 195, per_txn_fee_usd: 0.15 },
    request: {
      message: "Strategic co-brand renewal: we need 1.58% + $0.12 to sign the 3-year extension.",
      requested_pricing: { rate_bps: 158, per_txn_fee_usd: 0.12 },
    },
    decision_date: "2026-07-15",
    exception: { status: "strategic_exception", promo_code: null, justification: "3-year co-brand extension (sponsor: Chief Revenue Officer)" },
    variation: { merchant_size: "enterprise", volume_band: "very_high", margin_proximity: "far_below", policy_period: "v2", exception_status: "strategic_exception", source_completeness: "complete" },
  }),
  S({
    case_id: "C14",
    title: "Market stall with missing cost data (mid-2026)",
    merchant: { merchant_id: "M-1014", name: "Greenleaf Stall", size: "micro", segment: "farmers_market", months_as_customer: 0 },
    monthly_volume_usd: 15_000,
    monthly_transactions: 520,
    cost_data: { status: "missing", note: "New merchant; card-mix unknown." },
    current_pricing: null,
    request: {
      message: "Seasonal stall. Standard pricing is fine; we were told roughly 2.93% + $0.30.",
      requested_pricing: { rate_bps: 293, per_txn_fee_usd: 0.3 },
    },
    decision_date: "2026-08-03",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "micro", volume_band: "low", margin_proximity: "comfortable", policy_period: "v2", exception_status: "none", source_completeness: "missing_cost_data" },
  }),
  S({
    case_id: "C15",
    title: "Home-goods retailer repricing (early 2026)",
    merchant: { merchant_id: "M-1015", name: "Hearth & Home", size: "mid", segment: "retail_home", months_as_customer: 48 },
    monthly_volume_usd: 480_000,
    monthly_transactions: 9_600,
    cost_data: { status: "complete", cost_bps: 162, per_txn_cost_usd: 0.08 },
    current_pricing: { rate_bps: 240, per_txn_fee_usd: 0.2 },
    request: {
      message: "Loyal customer for 4 years. We're asking for 1.92% + $0.20.",
      requested_pricing: { rate_bps: 192, per_txn_fee_usd: 0.2 },
    },
    decision_date: "2026-02-12",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "mid", volume_band: "medium", margin_proximity: "near_below", policy_period: "v1", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C16",
    title: "Enterprise furniture brand cites expired SPRING25",
    merchant: { merchant_id: "M-1016", name: "Oakline Furniture", size: "enterprise", segment: "retail_furniture", months_as_customer: 20 },
    monthly_volume_usd: 2_200_000,
    monthly_transactions: 24_000,
    cost_data: { status: "complete", cost_bps: 150, per_txn_cost_usd: 0.06 },
    current_pricing: { rate_bps: 200, per_txn_fee_usd: 0.15 },
    request: {
      message: "We qualified for SPRING25 earlier this year and want it applied: 1.76% + $0.15.",
      requested_pricing: { rate_bps: 176, per_txn_fee_usd: 0.15 },
    },
    decision_date: "2025-11-20",
    exception: { status: "promotion", promo_code: "SPRING25", justification: "Merchant says they qualified in spring 2025" },
    variation: { merchant_size: "enterprise", volume_band: "high", margin_proximity: "near_above", policy_period: "v1", exception_status: "promotion_expired", source_completeness: "complete" },
  }),
  S({
    case_id: "C17",
    title: "Pet store decision on the day policy 2026.2 takes effect",
    merchant: { merchant_id: "M-1017", name: "Paws Corner", size: "small", segment: "retail_pets", months_as_customer: 16 },
    monthly_volume_usd: 310_000,
    monthly_transactions: 6_200,
    cost_data: { status: "complete", cost_bps: 180, per_txn_cost_usd: 0.1 },
    current_pricing: { rate_bps: 265, per_txn_fee_usd: 0.25 },
    request: {
      message: "We'd like 2.38% + $0.25 starting today.",
      requested_pricing: { rate_bps: 238, per_txn_fee_usd: 0.25 },
    },
    decision_date: "2026-09-01",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "small", volume_band: "medium", margin_proximity: "near_below", policy_period: "boundary", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C18",
    title: "Barber shop decision on the last day of policy 2026.1",
    merchant: { merchant_id: "M-1018", name: "Fade Factory", size: "micro", segment: "personal_services", months_as_customer: 11 },
    monthly_volume_usd: 24_000,
    monthly_transactions: 960,
    cost_data: { status: "complete", cost_bps: 178, per_txn_cost_usd: 0.1 },
    current_pricing: { rate_bps: 290, per_txn_fee_usd: 0.3 },
    request: {
      message: "Can we lock in 2.03% + $0.30 before any new pricing rules kick in?",
      requested_pricing: { rate_bps: 203, per_txn_fee_usd: 0.3 },
    },
    decision_date: "2026-08-31",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "micro", volume_band: "low", margin_proximity: "near_above", policy_period: "boundary", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C19",
    title: "Enterprise logistics firm on the day policy 2026.1 takes effect",
    merchant: { merchant_id: "M-1019", name: "Meridian Freight", size: "enterprise", segment: "logistics", months_as_customer: 6 },
    monthly_volume_usd: 3_400_000,
    monthly_transactions: 40_000,
    cost_data: { status: "complete", cost_bps: 137, per_txn_cost_usd: 0.05 },
    current_pricing: { rate_bps: 210, per_txn_fee_usd: 0.15 },
    request: {
      message: "Our debit-heavy mix keeps your costs low. We want 1.84% + $0.12 effective today.",
      requested_pricing: { rate_bps: 184, per_txn_fee_usd: 0.12 },
    },
    decision_date: "2026-04-01",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "enterprise", volume_band: "very_high", margin_proximity: "comfortable", policy_period: "boundary", exception_status: "none", source_completeness: "complete" },
  }),
  S({
    case_id: "C20",
    title: "Auto-parts retailer on the last day of policy 2025.1, cost data missing",
    merchant: { merchant_id: "M-1020", name: "Gearhead Auto Parts", size: "mid", segment: "retail_auto", months_as_customer: 0 },
    monthly_volume_usd: 720_000,
    monthly_transactions: 14_400,
    cost_data: { status: "missing", note: "Prior processor statements not provided." },
    current_pricing: null,
    request: {
      message: "Need a decision today: 2.39% + $0.20.",
      requested_pricing: { rate_bps: 239, per_txn_fee_usd: 0.2 },
    },
    decision_date: "2026-03-31",
    exception: { status: "none", promo_code: null, justification: null },
    variation: { merchant_size: "mid", volume_band: "medium", margin_proximity: "near_above", policy_period: "boundary", exception_status: "none", source_completeness: "missing_cost_data" },
  }),
];

/**
 * Frozen dev / held-out split (split-v1), stratified by size, policy period,
 * exception status and source completeness. Held-out cases must not be used
 * for prompt or judge tuning.
 */
export const SPLIT_VERSION = "split-v1";
export const SPLIT_ASSIGNMENT: Record<string, DatasetSplit> = {
  C01: "dev", C02: "dev", C03: "dev", C04: "dev", C05: "dev", C09: "dev",
  C11: "dev", C12: "dev", C13: "dev", C16: "dev", C18: "dev", C20: "dev",
  C06: "heldout", C07: "heldout", C08: "heldout", C10: "heldout",
  C14: "heldout", C15: "heldout", C17: "heldout", C19: "heldout",
};

export function getScenario(caseId: string): MerchantScenario | undefined {
  return SCENARIOS.find((s) => s.case_id === caseId);
}

export function splitOf(caseId: string): DatasetSplit | null {
  return SPLIT_ASSIGNMENT[caseId] ?? null;
}
