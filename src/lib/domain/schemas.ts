/**
 * AgentTrust domain contract.
 *
 * Every persisted object is validated with these Zod schemas. Provenance fields
 * (data_origin, execution_mode, label_source, reviewer) are mandatory so that
 * synthetic data, mock executions and AI output can never be mistaken for
 * production evidence or human labels.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const MerchantSize = z.enum(["micro", "small", "mid", "enterprise"]);
export type MerchantSize = z.infer<typeof MerchantSize>;

export const ApproverRole = z.enum([
  "regional_pricing_manager",
  "deal_desk",
  "promotions_lead",
  "cfo_delegate",
  "pricing_desk",
]);
export type ApproverRole = z.infer<typeof ApproverRole>;

export const ExecutionMode = z.enum(["live", "mock"]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const DatasetSplit = z.enum(["dev", "heldout"]);
export type DatasetSplit = z.infer<typeof DatasetSplit>;

export const Severity = z.enum(["critical", "major", "minor"]);
export type Severity = z.infer<typeof Severity>;

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// ---------------------------------------------------------------------------
// Pricing policy (synthetic, versioned, effective-dated)
// ---------------------------------------------------------------------------

export const PriceTerms = z.object({
  rate_bps: z.number(), // percentage-of-volume rate in basis points (290 = 2.90%)
  per_txn_fee_usd: z.number(),
});
export type PriceTerms = z.infer<typeof PriceTerms>;

export const CostBasis = z.object({
  cost_bps: z.number(),
  per_txn_cost_usd: z.number(),
});
export type CostBasis = z.infer<typeof CostBasis>;

export const Promotion = z.object({
  code: z.string(),
  valid_from: IsoDate,
  valid_to: IsoDate, // inclusive
  margin_floor_relief_pp: z.number(),
});
export type Promotion = z.infer<typeof Promotion>;

export const PolicySection = z.object({
  evidence_id: z.string(),
  heading: z.string(),
  text: z.string(),
});
export type PolicySection = z.infer<typeof PolicySection>;

export const PricingPolicy = z.object({
  policy_id: z.string(),
  title: z.string(),
  effective_from: IsoDate, // inclusive
  effective_to: IsoDate.nullable(), // exclusive; null = open-ended
  list_rates: z.record(MerchantSize, PriceTerms),
  min_margin_pct: z.record(MerchantSize, z.number()),
  discount_approval_threshold_pct: z.number(),
  high_volume_threshold_usd: z.number(),
  default_cost_basis: CostBasis,
  promotions: z.array(Promotion),
  data_origin: z.literal("synthetic"),
});
export type PricingPolicy = z.infer<typeof PricingPolicy>;

// ---------------------------------------------------------------------------
// Merchant scenario (synthetic input case)
// ---------------------------------------------------------------------------

export const ExceptionStatus = z.enum(["none", "promotion", "strategic_exception"]);
export type ExceptionStatus = z.infer<typeof ExceptionStatus>;

export const VariationDimensions = z.object({
  merchant_size: MerchantSize,
  volume_band: z.enum(["low", "medium", "high", "very_high"]),
  margin_proximity: z.enum(["comfortable", "near_above", "near_below", "far_below"]),
  policy_period: z.enum(["v1", "v2", "v3", "boundary"]),
  exception_status: z.enum(["none", "promotion_valid", "promotion_expired", "strategic_exception"]),
  source_completeness: z.enum(["complete", "missing_cost_data"]),
});
export type VariationDimensions = z.infer<typeof VariationDimensions>;

export const MerchantScenario = z.object({
  case_id: z.string(),
  title: z.string(),
  merchant: z.object({
    merchant_id: z.string(),
    name: z.string(),
    size: MerchantSize,
    segment: z.string(),
    months_as_customer: z.number().int(),
  }),
  monthly_volume_usd: z.number(),
  monthly_transactions: z.number().int(),
  cost_data: z.discriminatedUnion("status", [
    z.object({ status: z.literal("complete"), cost_bps: z.number(), per_txn_cost_usd: z.number() }),
    z.object({ status: z.literal("missing"), note: z.string() }),
  ]),
  current_pricing: PriceTerms.nullable(),
  request: z.object({
    message: z.string(),
    requested_pricing: PriceTerms,
  }),
  decision_date: IsoDate,
  exception: z.object({
    status: ExceptionStatus,
    promo_code: z.string().nullable(),
    justification: z.string().nullable(),
  }),
  variation: VariationDimensions.nullable(), // null for user-supplied custom scenarios
  data_origin: z.enum(["synthetic", "user_supplied"]),
});
export type MerchantScenario = z.infer<typeof MerchantScenario>;

// ---------------------------------------------------------------------------
// Agent structured output
// ---------------------------------------------------------------------------

export const PricingRecommendation = z.object({
  selected_policy_id: z.string(),
  policy_effective_from: z.string(),
  recommended_pricing: PriceTerms,
  cost_basis_used: z.object({
    cost_bps: z.number(),
    per_txn_cost_usd: z.number(),
    source: z.enum(["merchant_data", "policy_default"]),
  }),
  unit_economics: z.object({
    monthly_volume_usd: z.number(),
    monthly_transactions: z.number(),
    monthly_revenue_usd: z.number(),
    monthly_cost_usd: z.number(),
    monthly_gross_profit_usd: z.number(),
    gross_margin_pct: z.number(),
  }),
  minimum_margin_pct_required: z.number(),
  meets_minimum_margin: z.boolean(),
  discount_vs_list_pct: z.number(),
  requires_human_approval: z.boolean(),
  approvals_required: z.array(
    z.object({
      approver_role: ApproverRole,
      reason: z.string(),
      policy_evidence_id: z.string(),
    }),
  ),
  decision: z.enum(["accept_request", "counter_offer", "decline_request"]),
  explanation: z.string(),
  claims: z.array(
    z.object({
      claim: z.string(),
      evidence_ids: z.array(z.string()),
    }),
  ),
  data_gaps: z.array(z.string()),
});
export type PricingRecommendation = z.infer<typeof PricingRecommendation>;

// ---------------------------------------------------------------------------
// Evidence pack (what the agent and the judge are allowed to rely on)
// ---------------------------------------------------------------------------

export const EvidenceItem = z.object({
  evidence_id: z.string(),
  kind: z.enum(["merchant_fact", "policy_section"]),
  source_id: z.string(), // case_id or policy_id
  text: z.string(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

// ---------------------------------------------------------------------------
// Trace (one agent execution)
// ---------------------------------------------------------------------------

export const TokenUsage = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_input_tokens: z.number().default(0),
  cache_creation_input_tokens: z.number().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export const Trace = z.object({
  trace_id: z.string(),
  case_id: z.string(),
  timestamp: z.string(),
  input: MerchantScenario,
  agent_version: z.string(), // agent config id, e.g. pricing-agent@baseline-v1
  model_id: z.string(), // model requested
  served_model_id: z.string().nullable(), // model that actually answered (may differ on server-side fallback)
  prompt_version: z.string(),
  retrieval_strategy: z.string(),
  policy_context: z.array(
    z.object({ policy_id: z.string(), effective_from: z.string(), effective_to: z.string().nullable() }),
  ),
  evidence_pack: z.array(EvidenceItem),
  retrieved_or_supplied_source_ids: z.array(z.string()),
  selected_policy_id: z.string().nullable(),
  system_prompt: z.string(),
  user_prompt: z.string(),
  final_response: z.string().nullable(), // raw text returned by the model (observable output only)
  parsed_structured_output: PricingRecommendation.nullable(),
  tool_calls_if_any: z.array(z.object({ name: z.string(), input: z.unknown(), output: z.unknown() })),
  latency_ms: z.number(),
  token_usage: TokenUsage.nullable(),
  estimated_cost_usd: z.number().nullable(),
  stop_reason: z.string().nullable(),
  execution_error: z.string().nullable(),
  execution_mode: ExecutionMode,
  cache_hit: z.boolean(),
  experiment_run_id: z.string().nullable(),
  data_origin: z.enum(["synthetic", "user_supplied"]),
});
export type Trace = z.infer<typeof Trace>;

// ---------------------------------------------------------------------------
// Human review (open coding)
// ---------------------------------------------------------------------------

export const CriterionLabel = z.enum(["present", "absent", "not_assessed"]);
export type CriterionLabel = z.infer<typeof CriterionLabel>;

export const Annotation = z.object({
  annotation_id: z.string(),
  trace_id: z.string(),
  case_id: z.string(),
  reviewer: z.string().min(1),
  label_source: z.literal("human"), // AI output is never stored as an annotation
  created_at: z.string(),
  updated_at: z.string(),
  open_coding_notes: z.string(),
  task_outcome: z.enum(["pass", "fail"]),
  first_failure: z
    .object({
      description: z.string().min(1),
      failure_mode_id: z.string().nullable(), // null until axial coding assigns a category
    })
    .nullable(),
  additional_failure_mode_ids: z.array(z.string()),
  severity: Severity.nullable(),
  // Explicit binary label for the judge's single criterion. "not_assessed" is excluded from calibration.
  unsupported_justification_label: CriterionLabel,
  taxonomy_version: z.number().int().nullable(),
  // Rubric checklist answers (item id -> ok/problem/skip) and the rubric version they were given under.
  checklist: z.record(z.string(), z.enum(["ok", "problem", "skip"])).default({}),
  rubric_version: z.number().int().nullable().default(null),
});
export type Annotation = z.infer<typeof Annotation>;

// ---------------------------------------------------------------------------
// Failure taxonomy (axial coding, versioned)
// ---------------------------------------------------------------------------

export const FailureMode = z.object({
  failure_mode_id: z.string(),
  name: z.string(),
  definition: z.string(),
  severity: Severity,
  status: z.enum(["provisional", "observed", "merged", "retired"]),
  merged_into: z.string().nullable(),
  representative_trace_ids: z.array(z.string()),
  linked_evaluator_id: z.string().nullable(),
  origin: z.enum(["seed_hypothesis", "reviewer_added"]),
});
export type FailureMode = z.infer<typeof FailureMode>;

export const TaxonomyVersion = z.object({
  version: z.number().int(),
  created_at: z.string(),
  author: z.string(),
  change_note: z.string(),
  failure_modes: z.array(FailureMode),
});
export type TaxonomyVersion = z.infer<typeof TaxonomyVersion>;

// ---------------------------------------------------------------------------
// Gold dataset
// ---------------------------------------------------------------------------

export const GoldExample = z.object({
  gold_id: z.string(),
  case_id: z.string(),
  trace_id: z.string(),
  annotation_id: z.string(),
  input_scenario: MerchantScenario,
  reference_policy_ids: z.array(z.string()),
  expected_behavior: z.string(),
  applicable_objective_rules: z.array(z.string()),
  human_label: z.enum(["pass", "fail"]),
  failure_mode_ids: z.array(z.string()),
  unsupported_justification_label: CriterionLabel,
  supporting_evidence: z.string(),
  reviewer: z.string().min(1),
  review_timestamp: z.string(),
  label_version: z.number().int(),
  dataset_split: DatasetSplit,
  label_source: z.literal("human"),
  trace_execution_mode: ExecutionMode,
  promoted_at: z.string(),
  promoted_by: z.string().min(1),
});
export type GoldExample = z.infer<typeof GoldExample>;

// ---------------------------------------------------------------------------
// Evaluator results
// ---------------------------------------------------------------------------

export const EvalOutcome = z.enum(["PASS", "FAIL", "NOT_APPLICABLE", "ERROR"]);
export type EvalOutcome = z.infer<typeof EvalOutcome>;

export const DeterministicResult = z.object({
  evaluator_id: z.string(),
  evaluator_version: z.string(),
  trace_id: z.string(),
  case_id: z.string(),
  outcome: EvalOutcome,
  severity: Severity,
  summary: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type DeterministicResult = z.infer<typeof DeterministicResult>;

export const JudgeVerdict = z.enum(["FAIL", "PASS", "REQUIRES_REVIEW", "ERROR"]);
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

export const JudgeOutput = z.object({
  failure_detected: z.boolean(),
  evidence_ids: z.array(z.string()),
  relevant_claims: z.array(z.string()),
  explanation: z.string(),
  uncertainty_reason: z.string().nullable(),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

export const JudgeResult = z.object({
  judge_result_id: z.string(),
  judge_id: z.literal("unsupported_pricing_justification"),
  judge_version: z.string(),
  model_id: z.string(),
  served_model_id: z.string().nullable(),
  trace_id: z.string(),
  case_id: z.string(),
  verdict: JudgeVerdict,
  output: JudgeOutput.nullable(),
  raw_response: z.string().nullable(),
  error: z.string().nullable(),
  execution_mode: ExecutionMode,
  label_source: z.literal("llm_judge"), // never "human"
  token_usage: TokenUsage.nullable(),
  latency_ms: z.number(),
  created_at: z.string(),
});
export type JudgeResult = z.infer<typeof JudgeResult>;

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export const FrozenSet = z.object({
  frozen_set_id: z.string(),
  description: z.string(),
  case_ids: z.array(z.string()),
  content_hash: z.string(), // hash of the scenario JSON for every case: proves the cases did not change
  split: z.enum(["dev", "heldout", "full"]),
});
export type FrozenSet = z.infer<typeof FrozenSet>;

export const ExperimentRun = z.object({
  run_id: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  agent_config_id: z.string(),
  frozen_set_id: z.string(),
  frozen_set_hash: z.string(),
  case_ids: z.array(z.string()),
  execution_mode: ExecutionMode,
  status: z.enum(["running", "completed", "failed"]),
  trace_ids: z.record(z.string(), z.string()), // case_id -> trace_id
  notes: z.string().nullable(),
});
export type ExperimentRun = z.infer<typeof ExperimentRun>;

// ---------------------------------------------------------------------------
// Release gate & approval
// ---------------------------------------------------------------------------

export const ReleaseStatus = z.enum([
  "NO_SHIP",
  "INSUFFICIENT_EVIDENCE",
  "ELIGIBLE_FOR_DEMO_APPROVAL",
  "APPROVED_FOR_DEMO",
]);
export type ReleaseStatus = z.infer<typeof ReleaseStatus>;

export const ReleaseApproval = z.object({
  approval_id: z.string(),
  approver: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string(),
  candidate_run_id: z.string(),
  baseline_run_id: z.string().nullable(),
  evidence_snapshot_hash: z.string(),
  status_at_approval: ReleaseStatus,
  created_at: z.string(),
});
export type ReleaseApproval = z.infer<typeof ReleaseApproval>;

export const AuditEvent = z.object({
  event_id: z.string(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
