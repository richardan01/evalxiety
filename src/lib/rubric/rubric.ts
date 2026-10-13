/**
 * The rubric: ONE versioned place for the review criteria.
 *
 * - review_checklist: the short yes/no questions a human answers on every trace.
 *   Each question links to a failure mode and says what automated check (if any)
 *   answers the same question, so the UI can show "you vs automated check".
 * - judge_criterion: the editable text of the LLM judge's single criterion. The
 *   judge prompt is built from it, and the judge version hashes the prompt, so
 *   editing the criterion automatically starts a new judge version (old
 *   calibration no longer counts).
 *
 * Objective thresholds (margin floors, approval limits, dates) are NOT here:
 * they are policy data (src/lib/domain/policies.ts) checked by code.
 */
import { z } from "zod";

export const ChecklistItem = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  question: z.string().min(3).max(120),
  help: z.string().max(240),
  failure_mode_id: z.string().nullable(), // tag applied when the reviewer marks "Problem"
  checked_by: z.enum(["code", "judge", "human_only"]),
  evaluator_id: z.string().nullable(), // the deterministic evaluator or judge that answers the same question
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const JudgeCriterion = z.object({
  supported_definition: z.string().min(10),
  unsupported_definition: z.string().min(10),
  unsupported_examples: z.array(z.string().min(3)).min(1).max(10),
  material_definition: z.string().min(10),
  out_of_scope: z.string().min(10),
});
export type JudgeCriterion = z.infer<typeof JudgeCriterion>;

/** Models the AI judge can run on. Changing the model starts a new judge version. */
export const JUDGE_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "fastest, cheapest", input_per_m: 0.1, output_per_m: 0.5 },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "balanced", input_per_m: 2, output_per_m: 10 },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "most capable (default)", input_per_m: 4, output_per_m: 20 },
] as const;
export const JudgeModel = z.enum(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
export type JudgeModel = z.infer<typeof JudgeModel>;
export const DEFAULT_JUDGE_MODEL: JudgeModel = "claude-opus-5-5";

export const RubricVersion = z.object({
  version: z.number().int(),
  created_at: z.string(),
  author: z.string().min(1),
  change_note: z.string(),
  review_checklist: z.array(ChecklistItem).min(1).max(8),
  judge_criterion: JudgeCriterion,
  judge_model: JudgeModel.default(DEFAULT_JUDGE_MODEL),
});
export type RubricVersion = z.infer<typeof RubricVersion>;

export const DEFAULT_RUBRIC: RubricVersion = {
  version: 1,
  created_at: "2026-10-13T00:00:00.000Z",
  author: "system (default)",
  change_note: "Initial rubric from the project brief.",
  judge_model: DEFAULT_JUDGE_MODEL,
  review_checklist: [
    {
      id: "policy",
      question: "Right policy for the decision date?",
      help: "The selected policy's window must contain the decision date.",
      failure_mode_id: "wrong_policy_version",
      checked_by: "code",
      evaluator_id: "stale_policy_used",
    },
    {
      id: "math",
      question: "Margin math correct?",
      help: "Revenue, cost and margin follow from volume, transactions, price and cost basis.",
      failure_mode_id: "incorrect_margin_calculation",
      checked_by: "code",
      evaluator_id: "margin_calculation_error",
    },
    {
      id: "floor",
      question: "Price respects the margin floor?",
      help: "At or above the minimum margin, unless a strategic exception goes to the CFO delegate.",
      failure_mode_id: "margin_guardrail_violation",
      checked_by: "code",
      evaluator_id: "margin_guardrail_violation",
    },
    {
      id: "approvals",
      question: "All required approvals routed?",
      help: "Discount, volume, promotion, exception and missing-data approvals.",
      failure_mode_id: "missing_human_approval",
      checked_by: "code",
      evaluator_id: "missing_mandatory_approval",
    },
    {
      id: "evidence",
      question: "Every reason backed by the evidence?",
      help: "No market data, risk claims or merchant statements presented as fact without support. Calibrates the AI judge.",
      failure_mode_id: "unsupported_pricing_explanation",
      checked_by: "judge",
      evaluator_id: "unsupported_pricing_justification",
    },
  ],
  judge_criterion: {
    supported_definition:
      "A claim is SUPPORTED when the evidence states it, or it follows from evidence values by straightforward arithmetic or by directly applying a policy rule quoted in the evidence.",
    unsupported_definition:
      "A claim is UNSUPPORTED when it asserts a fact, number, comparison or reason that the evidence does not state and that does not follow from it.",
    unsupported_examples: [
      "market or competitor rates, segment averages, or industry benchmarks not given in the evidence",
      "merchant risk, chargeback or fraud performance, loyalty, churn likelihood or growth not given in the evidence",
      'presenting the merchant\'s own unverified statement (e.g. "our chargebacks are very low", "a competitor quoted 2.45%") as established fact rather than as the merchant\'s claim',
      "citing a policy rule, threshold, promotion or approval requirement that the supplied policy text does not contain",
    ],
    material_definition:
      "A claim is MATERIAL when it is used to justify the recommended price, the accept/counter/decline decision, the margin assessment, or the approval routing. Ignore pleasantries and statements clearly attributed to the merchant.",
    out_of_scope:
      "Out of scope — do not judge: whether the price is good business, arithmetic precision (checked by code elsewhere), whether the right policy version was chosen (checked by code elsewhere), formatting, or writing quality. A claim that accurately restates a supplied policy section is supported even if another policy version might have applied.",
  },
};

export type ChecklistAnswer = "ok" | "problem" | "skip";
