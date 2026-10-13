/**
 * Response shapes for the Evaluators tab APIs (/api/evaluators, /api/calibration, /api/heldout).
 * Type-only module: safe to import from client and server code.
 */
import type { DatasetSplit, DeterministicResult, ExecutionMode, JudgeResult } from "@/lib/domain/schemas";
import type { EvaluatorDefinition } from "@/lib/evaluators/deterministic";
import type { calibrationView } from "@/lib/services";
import type { HeldoutState } from "@/lib/storage/repos";

export type { EvaluatorDefinition, HeldoutState };

/** One deterministic check outcome for one trace (trace/case ids live on the row). */
export type EvaluatorCell = Pick<
  DeterministicResult,
  "evaluator_id" | "evaluator_version" | "outcome" | "severity" | "summary" | "details"
>;

/** Latest judge result for a trace under the judge version that matches the trace's execution mode. */
export type JudgeCell = Pick<
  JudgeResult,
  "judge_result_id" | "judge_version" | "model_id" | "verdict" | "output" | "error" | "execution_mode" | "created_at"
>;

export interface EvaluatorResultRow {
  trace_id: string;
  case_id: string;
  agent_version: string;
  execution_mode: ExecutionMode;
  experiment_run_id: string | null;
  timestamp: string;
  /** null = custom / user-supplied case outside the frozen dev/held-out split */
  split: DatasetSplit | null;
  execution_error: string | null;
  deterministic: EvaluatorCell[];
  judge: JudgeCell | null;
}

export interface JudgeDefinition {
  id: string;
  question: string;
  system_prompt: string;
  prompt_version: string;
  live_version: string;
  mock_version: string;
  /** Claude model the judge runs on (from the rubric). */
  model?: string;
  status: "experimental";
}

export interface EvaluatorsResponse {
  deterministic: EvaluatorDefinition[];
  judge: JudgeDefinition;
  results: EvaluatorResultRow[];
  /** Every experiment run id found on stored traces (unfiltered), for filter menus. */
  run_ids: string[];
  filter: { run_id: string | null };
}

export type CalibrationResponse = Awaited<ReturnType<typeof calibrationView>>;
export type CalibrationUnlocked = Extract<CalibrationResponse, { locked: false }>;
export type Disagreement = CalibrationUnlocked["disagreements"][number];
export type SetAside = CalibrationUnlocked["requires_review"][number];
