/**
 * Contract for evaluating ANY agent ("your agents"), alongside the built-in pricing demo.
 *
 * An agent is a folder under agents/ (or $EVALXIETY_AGENTS_DIR):
 *   agents/<agent_id>/agent.json   — name, optional HTTP connection, code checks, optional judge question
 *   agents/<agent_id>/cases.jsonl  — one test case per line
 *
 * Traces arrive either by import (JSONL the user produced) or from the HTTP adapter (Evalxiety calls the
 * user's endpoint once per case). Provenance stays explicit: `execution_mode` says how a trace was produced and
 * `data_origin: "example"` marks starter-kit data, which — like mock output — is never release evidence.
 */
import { z } from "zod";
import { Severity } from "../domain/schemas";

export const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const AgentId = z.string().regex(AGENT_ID_RE, "use lowercase letters, digits and dashes (max 64 chars)");

export const CaseId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, "use letters, digits, '_', '.', ':' or '-'");

// ---------------------------------------------------------------------------
// Cases (cases.jsonl)
// ---------------------------------------------------------------------------

// Objects a person writes by hand are .strict(): a misspelled key ("expectd", "maxWords") is reported with its file and
// line instead of being silently dropped, which would leave a case or check doing nothing.
export const AgentCase = z.strictObject({
  case_id: CaseId,
  /** Whatever your agent receives. Sent verbatim to an HTTP agent and shown verbatim in review. */
  input: z.unknown().refine((v) => v !== undefined, "input is required"),
  /** dev = iterate on it; heldout = locked until an audited reveal, so you can't tune on it. */
  split: z.enum(["dev", "heldout"]).default("dev"),
  /** Optional reference answer used by `matches_expected` checks. Never shown to the agent. */
  expected: z.unknown().optional(),
  /** Optional note for reviewers (what this case is testing). */
  notes: z.string().optional(),
});
export type AgentCase = z.infer<typeof AgentCase>;

// ---------------------------------------------------------------------------
// Code checks (agent.json → checks[])
// ---------------------------------------------------------------------------

/** Dot path into the output, e.g. "answer" or "citations.0.id". Empty string = the whole output. */
const FieldPath = z.string().regex(/^[A-Za-z0-9_.-]*$/, "use a dot path like answer or result.items.0");

const CheckBase = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]{1,64}$/, "use lowercase letters, digits and underscores"),
  /** The one yes/no question the check answers, in plain words. Shown to reviewers. */
  question: z.string().min(1),
  severity: Severity.default("major"),
  /** A failure blocks release on its own (critical failures always do). */
  blocking: z.boolean().default(false),
  /** What to try when the check fails. Shown in the fix panel. */
  fix_hint: z.string().optional(),
});

export const CheckConfig = z.discriminatedUnion("type", [
  CheckBase.extend({
    type: z.literal("json_output"),
    /** Fields that must exist (and not be null) in the output. */
    required_fields: z.array(FieldPath).default([]),
  }),
  CheckBase.extend({
    type: z.literal("matches_expected"),
    /** Output field to compare; "" = whole output. */
    field: FieldPath.default(""),
    /** Field of the case's `expected` value; "" = the whole expected value. */
    expected_field: FieldPath.default(""),
    mode: z.enum(["exact", "case_insensitive", "contains"]).default("exact"),
  }),
  CheckBase.extend({
    type: z.literal("regex"),
    field: FieldPath.default(""),
    pattern: z.string().min(1),
    flags: z.string().regex(/^[imsu]*$/, "allowed flags: i, m, s, u").default(""),
    /** "match": output must match. "no_match": output must NOT match (e.g. a leaked secret, a banned phrase). */
    must: z.enum(["match", "no_match"]),
  }),
  CheckBase.extend({
    type: z.literal("max_length"),
    field: FieldPath.default(""),
    max_chars: z.number().int().positive().optional(),
    max_words: z.number().int().positive().optional(),
  }),
  CheckBase.extend({
    type: z.literal("cites_evidence"),
    /** Output field holding cited ids: an array of strings, or of objects with an `id`. */
    citations_field: FieldPath,
    /** Fail when the answer cites nothing. */
    require_at_least_one: z.boolean().default(false),
  }),
  CheckBase.extend({
    type: z.literal("non_empty"),
    /** Output field to look in; "" = the whole output. Passes when it contains at least one non-blank text value. */
    field: FieldPath.default(""),
  }),
  CheckBase.extend({ type: z.literal("no_tool_errors") }),
  CheckBase.extend({ type: z.literal("max_latency_ms"), max: z.number().positive() }),
  CheckBase.extend({ type: z.literal("max_cost_usd"), max: z.number().nonnegative() }),
  CheckBase.extend({
    type: z.literal("custom"),
    /** Name of a function registered for this agent in agents/custom-checks.ts. */
    function: z.string().min(1),
  }),
]);
export type CheckConfig = z.infer<typeof CheckConfig>;
export type CheckType = CheckConfig["type"];

// ---------------------------------------------------------------------------
// HTTP connection (agent.json → connection)
// ---------------------------------------------------------------------------

export const HttpConnection = z.strictObject({
  type: z.literal("http"),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "only http:// and https:// URLs are allowed"),
  /**
   * Request headers. Use ${env:NAME} to read a secret from the environment (.env.local) — never put a token
   * in agent.json. Header values are never stored in traces.
   */
  headers: z.record(z.string(), z.string()).default({}),
  timeout_ms: z.number().int().positive().max(300_000).default(60_000),
  /** Your own estimate of what one call costs you. Shown before a batch run; null = unknown. */
  cost_per_call_usd: z.number().nonnegative().nullable().default(null),
  /** Calls in flight at once. Keep it low if your agent is rate limited. */
  concurrency: z.number().int().min(1).max(8).default(2),
});
export type HttpConnection = z.infer<typeof HttpConnection>;

// ---------------------------------------------------------------------------
// LLM judge (agent.json → judge)
// ---------------------------------------------------------------------------

export const AgentJudgeConfig = z.strictObject({
  /** ONE binary question about a failure, e.g. "Does the answer state a fact the evidence does not support?" */
  question: z.string().min(10),
  /** What counts as the failure being present. */
  fail_definition: z.string().min(1),
  /** What counts as it being absent. */
  pass_definition: z.string().min(1),
  model: z.enum(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]).default("claude-sonnet-5-5"),
});
export type AgentJudgeConfig = z.infer<typeof AgentJudgeConfig>;

// ---------------------------------------------------------------------------
// agent.json
// ---------------------------------------------------------------------------

export const AgentConfig = z.strictObject({
  name: z.string().min(1),
  description: z.string().default(""),
  /**
   * true = starter-kit / demo agent. Its traces are labelled EXAMPLE and can never make the gate say
   * "Ready for approval" — they show the workflow, not evidence about a real agent.
   */
  example: z.boolean().default(false),
  connection: HttpConnection.nullable().default(null),
  checks: z.array(CheckConfig).default([]),
  judge: AgentJudgeConfig.nullable().default(null),
  /**
   * Set true if an empty answer can be correct for your agent (an extractor that finds nothing, a redactor). By default
   * an empty answer is an error on every check, so it can never pass by saying nothing.
   */
  allow_empty_output: z.boolean().default(false),
  /** Minimum human-reviewed traces before the gate can be satisfied. */
  min_reviewed_traces: z.number().int().min(1).default(10),
  /** Editor and comment keys are allowed (agent.json is strict otherwise). */
  $schema: z.string().optional(),
  _comment: z.unknown().optional(),
  /** Share of cases that must pass every code check. */
  pass_all_threshold: z.number().min(0).max(1).default(0.9),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export interface LoadedAgent {
  agent_id: string;
  dir: string;
  config: AgentConfig;
  cases: AgentCase[];
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

export const EvidenceRef = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const ToolCall = z.object({
  name: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().nullable().optional(),
});
export type ToolCall = z.infer<typeof ToolCall>;

/** imported = produced by your agent outside Evalxiety; http = Evalxiety called your endpoint. */
export const AgentExecutionMode = z.enum(["imported", "http"]);
export type AgentExecutionMode = z.infer<typeof AgentExecutionMode>;

export const AgentTrace = z.object({
  trace_id: z.string(),
  agent_id: z.string(),
  run_id: z.string(),
  case_id: z.string(),
  timestamp: z.string(),
  agent_version: z.string(),
  input: z.unknown(),
  /** Any JSON value or text. null when the call failed. */
  output: z.unknown(),
  evidence: z.array(EvidenceRef).default([]),
  tool_calls: z.array(ToolCall).default([]),
  model_id: z.string().nullable().default(null),
  latency_ms: z.number().nullable().default(null),
  cost_usd: z.number().nullable().default(null),
  execution_mode: AgentExecutionMode,
  execution_error: z.string().nullable().default(null),
  data_origin: z.enum(["real", "example"]),
  /** Anything else the user's agent returned, kept for reference. */
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AgentTrace = z.infer<typeof AgentTrace>;

/** One line of an import file — the public trace contract. */
// Loose: keys outside the contract are kept under metadata (see runs.ts), never silently dropped.
export const ImportedTraceLine = z
  .looseObject({
    case_id: CaseId,
    // Optional at the key level (zod 4 makes a bare z.unknown() key required); the refine below requires output or error.
    output: z.unknown().optional(),
    evidence: z.array(EvidenceRef).optional(),
    tool_calls: z.array(ToolCall).optional(),
    model_id: z.string().optional(),
    latency_ms: z.number().nonnegative().optional(),
    cost_usd: z.number().nonnegative().optional(),
    // null and "" mean "no error" (many agents always emit the key).
    error: z.string().nullable().optional(),
    timestamp: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((l) => l.output !== undefined || Boolean(l.error), {
    message: "each line needs an `output` (or an `error` if the agent failed on this case)",
    path: ["output"],
  });
export type ImportedTraceLine = z.infer<typeof ImportedTraceLine>;

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const AgentRun = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  /** Your label for the version that produced this run, e.g. "prompt-v3" or a git SHA. */
  agent_version: z.string().min(1),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  created_by: z.string().min(1),
  execution_mode: AgentExecutionMode,
  data_origin: z.enum(["real", "example"]),
  /** Frozen case-set version this run is pinned to. */
  frozen_version: z.number().int(),
  frozen_hash: z.string(),
  case_ids: z.array(z.string()),
  trace_ids: z.record(z.string(), z.string()),
  status: z.enum(["running", "completed", "failed"]),
  /** sha256 of the imported file, so importing the same file twice returns the same run. */
  source_hash: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const FrozenVersion = z.object({
  version: z.number().int().min(1),
  content_hash: z.string(),
  case_ids: z.array(z.string()),
  created_at: z.string(),
  created_by: z.string(),
  note: z.string(),
  /** Held-out cases in this version with a hash of their input, so renaming, moving or deleting one is detectable later. */
  heldout_cases: z.array(z.object({ case_id: z.string(), input_hash: z.string() })).default([]),
});
export type FrozenVersion = z.infer<typeof FrozenVersion>;

// ---------------------------------------------------------------------------
// Human review
// ---------------------------------------------------------------------------

export const AgentAnnotation = z.object({
  annotation_id: z.string(),
  agent_id: z.string(),
  trace_id: z.string(),
  case_id: z.string(),
  run_id: z.string(),
  reviewer: z.string().min(1),
  label_source: z.literal("human"),
  created_at: z.string(),
  updated_at: z.string(),
  task_outcome: z.enum(["pass", "fail"]),
  notes: z.string(),
  /** The first thing that went wrong, in the reviewer's words (open coding). */
  first_failure: z.string().nullable(),
  /** A short failure-type name the reviewer groups failures under (axial coding), e.g. "wrong refund policy". */
  failure_type: z.string().nullable(),
  severity: Severity.nullable(),
  /** The reviewer's answer to the judge's question; the reference for judge calibration. */
  judge_label: z.enum(["present", "absent", "not_assessed"]),
});
export type AgentAnnotation = z.infer<typeof AgentAnnotation>;

// ---------------------------------------------------------------------------
// Judge results
// ---------------------------------------------------------------------------

export const AgentJudgeResult = z.object({
  judge_result_id: z.string(),
  agent_id: z.string(),
  judge_version: z.string(),
  model_id: z.string(),
  trace_id: z.string(),
  case_id: z.string(),
  verdict: z.enum(["FAIL", "PASS", "REQUIRES_REVIEW", "ERROR"]),
  explanation: z.string().nullable(),
  quoted_claims: z.array(z.string()).default([]),
  uncertainty_reason: z.string().nullable(),
  error: z.string().nullable(),
  execution_mode: z.enum(["live", "mock"]),
  label_source: z.literal("llm_judge"),
  cost_usd: z.number().nullable(),
  latency_ms: z.number(),
  created_at: z.string(),
});
export type AgentJudgeResult = z.infer<typeof AgentJudgeResult>;

export const RevealedCase = z.object({
  case_id: z.string(),
  /** Hash of the case's input when it was revealed: new content under a reused id is NOT revealed. */
  input_hash: z.string(),
  revealed_at: z.string(),
  revealed_by: z.string(),
});
export type RevealedCase = z.infer<typeof RevealedCase>;

export const HeldoutState = z.object({
  /** true once any reveal happened; exactly which cases are unlocked is revealed_cases. */
  revealed: z.boolean(),
  revealed_at: z.string().nullable(),
  revealed_by: z.string().nullable(),
  reason: z.string().nullable(),
  revealed_cases: z.array(RevealedCase).default([]),
});
export type HeldoutState = z.infer<typeof HeldoutState>;
