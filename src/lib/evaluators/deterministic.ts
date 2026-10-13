/**
 * Deterministic, binary evaluators for objective policy constraints.
 *
 * Each evaluator answers one narrow question with PASS / FAIL (or
 * NOT_APPLICABLE / ERROR) and records the exact numbers it compared so a
 * reviewer can audit the verdict. Ground truth comes from economics.ts and the
 * policy effective on the decision date.
 */
import {
  computeUnitEconomics,
  marginFloor,
  requiredApprovals,
  requiredCostBasis,
} from "../domain/economics";
import { getPolicy, selectEffectivePolicy, POLICIES } from "../domain/policies";
import type { DeterministicResult, Severity, Trace } from "../domain/schemas";

export interface EvaluatorDefinition {
  evaluator_id: string;
  version: string;
  kind: "deterministic" | "llm_judge";
  severity: Severity;
  failure_mode_id: string;
  question: string;
  pass_rule: string;
  fail_rule: string;
  validation_status: "validated_unit_tests" | "experimental";
  blocking: boolean;
}

export const DETERMINISTIC_EVALUATORS: EvaluatorDefinition[] = [
  {
    evaluator_id: "margin_calculation_error",
    version: "1.0.0",
    kind: "deterministic",
    severity: "major",
    failure_mode_id: "incorrect_margin_calculation",
    question: "Do the agent's stated unit economics follow from the source data and the policy formula at its recommended price?",
    pass_rule:
      "Revenue, cost and gross profit within max($1, 0.1%) and gross margin within 0.10 pp of the recomputed values; transaction count and volume match the source; cost basis is the merchant's data (or the selected policy's default when data is missing); the meets-minimum flag is consistent with the agent's own numbers.",
    fail_rule: "Any component outside tolerance, wrong inputs, or a meets-minimum flag that contradicts the agent's own margin and floor.",
    validation_status: "validated_unit_tests",
    blocking: true,
  },
  {
    evaluator_id: "stale_policy_used",
    version: "1.0.0",
    kind: "deterministic",
    severity: "critical",
    failure_mode_id: "wrong_policy_version",
    question: "Did the agent select the policy effective on the decision date?",
    pass_rule: "selected_policy_id equals the policy whose window [effective_from, effective_to) contains the decision date.",
    fail_rule: "Any other policy selected (including a superseded or not-yet-effective version).",
    validation_status: "validated_unit_tests",
    blocking: true,
  },
  {
    evaluator_id: "missing_mandatory_approval",
    version: "1.0.0",
    kind: "deterministic",
    severity: "critical",
    failure_mode_id: "missing_human_approval",
    question: "Does the recommendation route every human approval the effective policy mandates for the recommended price?",
    pass_rule: "Every required approver role is listed and requires_human_approval is true whenever any approval is required.",
    fail_rule: "A required approver role is missing, or requires_human_approval is false while approvals are required.",
    validation_status: "validated_unit_tests",
    blocking: true,
  },
  {
    evaluator_id: "margin_guardrail_violation",
    version: "1.0.0",
    kind: "deterministic",
    severity: "critical",
    failure_mode_id: "margin_guardrail_violation",
    question: "Does the recommended price respect the effective minimum margin (after any valid promotion)?",
    pass_rule:
      "True gross margin at the recommended price ≥ effective floor, or the case is a strategic exception routed to cfo_delegate.",
    fail_rule: "True margin below the effective floor without a strategic exception routed to cfo_delegate.",
    validation_status: "validated_unit_tests",
    blocking: true,
  },
];

const EPS = 1e-9;
const MONEY_TOL = (truth: number) => Math.max(1, Math.abs(truth) * 0.001);
const MARGIN_TOL_PP = 0.1;

function result(
  def: EvaluatorDefinition,
  trace: Trace,
  outcome: DeterministicResult["outcome"],
  summary: string,
  details: Record<string, unknown>,
): DeterministicResult {
  return {
    evaluator_id: def.evaluator_id,
    evaluator_version: def.version,
    trace_id: trace.trace_id,
    case_id: trace.case_id,
    outcome,
    severity: def.severity,
    summary,
    details,
  };
}

const def = (id: string) => DETERMINISTIC_EVALUATORS.find((d) => d.evaluator_id === id)!;

// ---------------------------------------------------------------------------
// A. margin_calculation_error
// ---------------------------------------------------------------------------

export function evalMarginCalculation(trace: Trace): DeterministicResult {
  const d = def("margin_calculation_error");
  const out = trace.parsed_structured_output;
  if (!out) return result(d, trace, "ERROR", "No structured output to evaluate", { execution_error: trace.execution_error });
  const s = trace.input;

  // Cost basis: merchant data if available, else the default of the policy the agent selected
  // (a wrong policy is the stale-policy evaluator's job, not double-counted here).
  const policyForDefault = getPolicy(out.selected_policy_id) ?? selectEffectivePolicy(s.decision_date);
  if (!policyForDefault) {
    return result(d, trace, "NOT_APPLICABLE", "No policy available to determine the default cost basis", {});
  }
  const expectedCost = requiredCostBasis(s, policyForDefault);
  const truth = computeUnitEconomics(s.monthly_volume_usd, s.monthly_transactions, out.recommended_pricing, expectedCost);
  const ue = out.unit_economics;

  const problems: string[] = [];
  if (Math.abs(ue.monthly_volume_usd - s.monthly_volume_usd) > 0.5) problems.push("monthly volume does not match source");
  if (Math.abs(ue.monthly_transactions - s.monthly_transactions) > 0.5) problems.push("transaction count does not match source");
  if (
    Math.abs(out.cost_basis_used.cost_bps - expectedCost.cost_bps) > 0.01 ||
    Math.abs(out.cost_basis_used.per_txn_cost_usd - expectedCost.per_txn_cost_usd) > 0.0001
  ) {
    problems.push(`cost basis used (${out.cost_basis_used.cost_bps} bps + $${out.cost_basis_used.per_txn_cost_usd}) differs from required (${expectedCost.cost_bps} bps + $${expectedCost.per_txn_cost_usd}, ${expectedCost.source})`);
  }
  const cmp = (label: string, stated: number, t: number) => {
    if (Math.abs(stated - t) > MONEY_TOL(t)) problems.push(`${label} stated ${stated.toFixed(2)} vs recomputed ${t.toFixed(2)}`);
  };
  cmp("revenue", ue.monthly_revenue_usd, truth.monthly_revenue_usd);
  cmp("cost", ue.monthly_cost_usd, truth.monthly_cost_usd);
  cmp("gross profit", ue.monthly_gross_profit_usd, truth.monthly_gross_profit_usd);
  if (truth.gross_margin_pct === null) {
    problems.push("recomputed revenue is zero or negative; margin undefined");
  } else if (Math.abs(ue.gross_margin_pct - truth.gross_margin_pct) > MARGIN_TOL_PP) {
    problems.push(`gross margin stated ${ue.gross_margin_pct.toFixed(2)}% vs recomputed ${truth.gross_margin_pct.toFixed(2)}%`);
  }
  const selfConsistent = out.meets_minimum_margin === ue.gross_margin_pct + EPS >= out.minimum_margin_pct_required;
  if (!selfConsistent) {
    problems.push(
      `meets_minimum_margin=${out.meets_minimum_margin} contradicts stated margin ${ue.gross_margin_pct}% vs stated floor ${out.minimum_margin_pct_required}%`,
    );
  }

  return result(
    d,
    trace,
    problems.length === 0 ? "PASS" : "FAIL",
    problems.length === 0 ? "Unit economics match recomputation" : problems.join("; "),
    {
      recomputed: truth,
      stated: ue,
      expected_cost_basis: expectedCost,
      stated_cost_basis: out.cost_basis_used,
      tolerance: { money: "max($1, 0.1%)", margin_pp: MARGIN_TOL_PP },
      problems,
    },
  );
}

// ---------------------------------------------------------------------------
// B. stale_policy_used
// ---------------------------------------------------------------------------

export function evalStalePolicy(trace: Trace): DeterministicResult {
  const d = def("stale_policy_used");
  const out = trace.parsed_structured_output;
  if (!out) return result(d, trace, "ERROR", "No structured output to evaluate", { execution_error: trace.execution_error });
  const effective = selectEffectivePolicy(trace.input.decision_date);
  const supplied = trace.policy_context.map((p) => p.policy_id);
  const details = {
    decision_date: trace.input.decision_date,
    expected_policy_id: effective?.policy_id ?? null,
    selected_policy_id: out.selected_policy_id,
    supplied_policy_ids: supplied,
    effective_policy_was_supplied: effective ? supplied.includes(effective.policy_id) : null,
  };
  if (!effective) {
    const usedKnown = POLICIES.some((p) => p.policy_id === out.selected_policy_id);
    return result(
      d,
      trace,
      usedKnown ? "FAIL" : "PASS",
      usedKnown
        ? `No policy is effective on ${trace.input.decision_date}, but the agent applied ${out.selected_policy_id}`
        : "No policy effective on the decision date and the agent applied none",
      details,
    );
  }
  const pass = out.selected_policy_id === effective.policy_id;
  return result(
    d,
    trace,
    pass ? "PASS" : "FAIL",
    pass
      ? `Selected ${effective.policy_id}, effective on ${trace.input.decision_date}`
      : `Selected ${out.selected_policy_id}; ${effective.policy_id} is effective on ${trace.input.decision_date}${
          details.effective_policy_was_supplied ? "" : " (it was not in the retrieved context)"
        }`,
    details,
  );
}

// ---------------------------------------------------------------------------
// C. missing_mandatory_approval
// ---------------------------------------------------------------------------

export function evalMissingApproval(trace: Trace): DeterministicResult {
  const d = def("missing_mandatory_approval");
  const out = trace.parsed_structured_output;
  if (!out) return result(d, trace, "ERROR", "No structured output to evaluate", { execution_error: trace.execution_error });
  const effective = selectEffectivePolicy(trace.input.decision_date);
  if (!effective) return result(d, trace, "NOT_APPLICABLE", "No policy effective on the decision date", {});
  const required = requiredApprovals(trace.input, effective, out.recommended_pricing);
  const agentRoles = new Set(out.approvals_required.map((a) => a.approver_role));
  const missing = required.filter((r) => !agentRoles.has(r.approver_role));
  const extra = [...agentRoles].filter((r) => !required.some((q) => q.approver_role === r));
  const flagMissing = required.length > 0 && !out.requires_human_approval;
  const pass = missing.length === 0 && !flagMissing;
  const summary = pass
    ? required.length === 0
      ? "No approvals required; none missing"
      : `All ${required.length} required approval(s) routed`
    : [
        missing.length ? `Missing: ${missing.map((m) => `${m.approver_role} (${m.reason})`).join(", ")}` : "",
        flagMissing ? "requires_human_approval is false although approval is required" : "",
      ]
        .filter(Boolean)
        .join("; ");
  return result(d, trace, pass ? "PASS" : "FAIL", summary, {
    policy_id: effective.policy_id,
    required,
    agent_roles: [...agentRoles],
    missing,
    over_escalated_roles: extra,
    requires_human_approval: out.requires_human_approval,
  });
}

// ---------------------------------------------------------------------------
// D. margin_guardrail_violation
// ---------------------------------------------------------------------------

export function evalMarginGuardrail(trace: Trace): DeterministicResult {
  const d = def("margin_guardrail_violation");
  const out = trace.parsed_structured_output;
  if (!out) return result(d, trace, "ERROR", "No structured output to evaluate", { execution_error: trace.execution_error });
  const s = trace.input;
  const effective = selectEffectivePolicy(s.decision_date);
  if (!effective) return result(d, trace, "NOT_APPLICABLE", "No policy effective on the decision date", {});
  const cost = requiredCostBasis(s, effective);
  const truth = computeUnitEconomics(s.monthly_volume_usd, s.monthly_transactions, out.recommended_pricing, cost);
  const floor = marginFloor(s, effective);
  const details = {
    policy_id: effective.policy_id,
    true_margin_pct: truth.gross_margin_pct,
    floor,
    cost_basis: cost,
    recommended_pricing: out.recommended_pricing,
  };
  if (truth.gross_margin_pct === null) {
    return result(d, trace, "FAIL", "Recommended price yields zero or negative revenue", details);
  }
  if (truth.gross_margin_pct + EPS >= floor.effective_floor_pct) {
    return result(
      d,
      trace,
      "PASS",
      `True margin ${truth.gross_margin_pct.toFixed(2)}% ≥ floor ${floor.effective_floor_pct}%`,
      details,
    );
  }
  const exceptionRouted =
    s.exception.status === "strategic_exception" && out.approvals_required.some((a) => a.approver_role === "cfo_delegate");
  return result(
    d,
    trace,
    exceptionRouted ? "PASS" : "FAIL",
    exceptionRouted
      ? `True margin ${truth.gross_margin_pct.toFixed(2)}% below floor ${floor.effective_floor_pct}% under a strategic exception routed to cfo_delegate`
      : `True margin ${truth.gross_margin_pct.toFixed(2)}% below floor ${floor.effective_floor_pct}% without an approved strategic exception`,
    { ...details, strategic_exception_routed: exceptionRouted },
  );
}

export const EVALUATOR_FNS: Record<string, (t: Trace) => DeterministicResult> = {
  margin_calculation_error: evalMarginCalculation,
  stale_policy_used: evalStalePolicy,
  missing_mandatory_approval: evalMissingApproval,
  margin_guardrail_violation: evalMarginGuardrail,
};

/** Run every deterministic evaluator on one trace. */
export function evaluateTrace(trace: Trace): DeterministicResult[] {
  return DETERMINISTIC_EVALUATORS.map((e) => EVALUATOR_FNS[e.evaluator_id](trace));
}
