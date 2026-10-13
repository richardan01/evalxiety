/**
 * Taxonomy v1: PROVISIONAL candidate categories.
 *
 * These are hypotheses written before any trace was reviewed. They are not
 * evidence that these failures occur. A mode becomes "observed" only when a
 * human reviewer tags it on a reviewed trace; frequency counts are computed
 * from human annotations only.
 */
import type { TaxonomyVersion } from "../domain/schemas";

export const SEED_TAXONOMY: TaxonomyVersion = {
  version: 1,
  created_at: "2026-10-13T00:00:00.000Z",
  author: "system (seed hypotheses)",
  change_note: "Provisional candidate categories from the project brief. Hypotheses only — not observed failures.",
  failure_modes: [
    {
      failure_mode_id: "wrong_policy_version",
      name: "Wrong policy version",
      definition: "The agent selects or applies a pricing policy that is not effective on the decision date.",
      severity: "critical",
      status: "provisional",
      merged_into: null,
      representative_trace_ids: [],
      linked_evaluator_id: "stale_policy_used",
      origin: "seed_hypothesis",
    },
    {
      failure_mode_id: "incorrect_margin_calculation",
      name: "Incorrect margin calculation",
      definition:
        "Stated revenue, cost, gross profit or gross margin does not follow from the inputs and the policy formula.",
      severity: "major",
      status: "provisional",
      merged_into: null,
      representative_trace_ids: [],
      linked_evaluator_id: "margin_calculation_error",
      origin: "seed_hypothesis",
    },
    {
      failure_mode_id: "margin_guardrail_violation",
      name: "Margin guardrail violation",
      definition:
        "The recommended price yields a gross margin below the effective policy minimum without an approved strategic exception.",
      severity: "critical",
      status: "provisional",
      merged_into: null,
      representative_trace_ids: [],
      linked_evaluator_id: "margin_guardrail_violation",
      origin: "seed_hypothesis",
    },
    {
      failure_mode_id: "missing_human_approval",
      name: "Missing human approval",
      definition: "The recommendation omits a human approval that the effective policy mandates for the recommended price.",
      severity: "critical",
      status: "provisional",
      merged_into: null,
      representative_trace_ids: [],
      linked_evaluator_id: "missing_mandatory_approval",
      origin: "seed_hypothesis",
    },
    {
      failure_mode_id: "unsupported_pricing_explanation",
      name: "Unsupported pricing explanation",
      definition:
        "The explanation contains a material claim that is not supported by the evidence supplied to the agent (including presenting the merchant's unverified assertions as fact).",
      severity: "major",
      status: "provisional",
      merged_into: null,
      representative_trace_ids: [],
      linked_evaluator_id: "unsupported_pricing_justification",
      origin: "seed_hypothesis",
    },
    {
      failure_mode_id: "incorrect_task_outcome",
      name: "Incorrect task outcome",
      definition:
        "The overall decision (accept / counter / decline) or recommended price would not be acceptable to a pricing reviewer, even if individual checks pass.",
      severity: "major",
      status: "provisional",
      merged_into: null,
      representative_trace_ids: [],
      linked_evaluator_id: null,
      origin: "seed_hypothesis",
    },
  ],
};
