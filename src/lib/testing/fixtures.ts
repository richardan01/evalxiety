/**
 * Test fixtures: build traces with a *correct* recommendation computed from
 * ground truth, which individual tests then perturb.
 */
import {
  computeUnitEconomics,
  discountVsListPct,
  marginFloor,
  requiredApprovals,
  requiredCostBasis,
} from "../domain/economics";
import { selectEffectivePolicy } from "../domain/policies";
import { getScenario } from "../domain/scenarios";
import type { MerchantScenario, PriceTerms, PricingRecommendation, Trace } from "../domain/schemas";

export function correctRecommendation(s: MerchantScenario, price?: PriceTerms): PricingRecommendation {
  const policy = selectEffectivePolicy(s.decision_date)!;
  const p = price ?? s.request.requested_pricing;
  const cost = requiredCostBasis(s, policy);
  const ue = computeUnitEconomics(s.monthly_volume_usd, s.monthly_transactions, p, cost);
  const floor = marginFloor(s, policy);
  const approvals = requiredApprovals(s, policy, p);
  return {
    selected_policy_id: policy.policy_id,
    policy_effective_from: policy.effective_from,
    recommended_pricing: p,
    cost_basis_used: cost,
    unit_economics: {
      monthly_volume_usd: s.monthly_volume_usd,
      monthly_transactions: s.monthly_transactions,
      monthly_revenue_usd: ue.monthly_revenue_usd,
      monthly_cost_usd: ue.monthly_cost_usd,
      monthly_gross_profit_usd: ue.monthly_gross_profit_usd,
      gross_margin_pct: ue.gross_margin_pct!,
    },
    minimum_margin_pct_required: floor.effective_floor_pct,
    meets_minimum_margin: ue.gross_margin_pct! >= floor.effective_floor_pct,
    discount_vs_list_pct: discountVsListPct(s, policy, p),
    requires_human_approval: approvals.length > 0,
    approvals_required: approvals,
    decision: "accept_request",
    explanation: "Test explanation.",
    claims: [{ claim: "Policy applies.", evidence_ids: [`${policy.policy_id}§1`] }],
    data_gaps: [],
  };
}

let counter = 0;

export function makeTrace(
  caseIdOrScenario: string | MerchantScenario,
  mutate?: (r: PricingRecommendation) => PricingRecommendation | null,
  extra: Partial<Trace> = {},
): Trace {
  const s = typeof caseIdOrScenario === "string" ? getScenario(caseIdOrScenario)! : caseIdOrScenario;
  const policy = selectEffectivePolicy(s.decision_date);
  // With no effective policy there is no "correct" recommendation; callers must supply one via mutate.
  const base = policy ? correctRecommendation(s) : null;
  const rec = mutate ? mutate(structuredClone(base) as PricingRecommendation) : base;
  counter += 1;
  return {
    trace_id: `trace_test${counter}`,
    case_id: s.case_id,
    timestamp: new Date(Date.UTC(2026, 9, 13, 0, 0, counter)).toISOString(),
    input: s,
    agent_version: "pricing-agent@corrected-v2",
    model_id: "test",
    served_model_id: null,
    prompt_version: "pricing-prompt-v2",
    retrieval_strategy: "effective_date_filtered",
    policy_context: policy
      ? [{ policy_id: policy.policy_id, effective_from: policy.effective_from, effective_to: policy.effective_to }]
      : [],
    evidence_pack: [],
    retrieved_or_supplied_source_ids: [],
    selected_policy_id: rec?.selected_policy_id ?? null,
    system_prompt: "",
    user_prompt: "",
    final_response: rec ? JSON.stringify(rec) : null,
    parsed_structured_output: rec,
    tool_calls_if_any: [],
    latency_ms: 1000,
    token_usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    estimated_cost_usd: 0.014,
    stop_reason: "end_turn",
    execution_error: rec ? null : "boom",
    execution_mode: "live",
    cache_hit: false,
    experiment_run_id: null,
    data_origin: s.data_origin,
    ...extra,
  };
}

/** Recompute derived economics after changing the price, keeping everything else correct. */
export function withPrice(s: MerchantScenario, price: PriceTerms) {
  return (): PricingRecommendation => correctRecommendation(s, price);
}
