/** Response shapes of /api/experiments/* (type-only imports — safe in client components). */
import type { AgentConfig } from "@/lib/agent/configs";
import type { ExperimentRun, FrozenSet } from "@/lib/domain/schemas";
import type { BatchEstimate } from "@/lib/experiments/runner";
import type { ModeInfo } from "@/lib/llm/client";
import type { CaseEvaluation, RunComparison, RunSummary } from "@/lib/metrics/experiments";
import type { HeldoutState } from "@/lib/storage/repos";

export type { BatchEstimate, CaseEvaluation, ExperimentRun, RunComparison, RunSummary };

export interface RunRow {
  run: ExperimentRun;
  config_label: string;
  config_role: "baseline" | "corrected" | null;
  progress: { traces_done: number; cases: number };
  summary: RunSummary;
}

export type FrozenSetRow = FrozenSet & { includesHeldout: boolean };
export type AgentConfigRow = AgentConfig & { system_prompt: string };

export interface EvaluatorInfo {
  evaluator_id: string;
  version: string;
  severity: "critical" | "major" | "minor";
  failure_mode_id: string;
  question: string;
  validation_status: "validated_unit_tests" | "experimental";
  blocking: boolean;
}

export interface ExperimentsData {
  runs: RunRow[];
  frozen_sets: FrozenSetRow[];
  agent_configs: AgentConfigRow[];
  evaluators: EvaluatorInfo[];
  heldout: HeldoutState;
  estimate_per_case: { agent: number; judge: number };
  mode: ModeInfo;
  model_id: string;
}

export interface RunDetailData {
  run: ExperimentRun;
  config: AgentConfig;
  evals: CaseEvaluation[];
  summary: RunSummary;
}

export interface CompareData {
  baseline: { run: ExperimentRun; config: AgentConfig };
  candidate: { run: ExperimentRun; config: AgentConfig };
  mode_mismatch: boolean;
  comparison: RunComparison;
  case_meta: Record<string, { title: string; split: "dev" | "heldout" | null }>;
}

export interface JudgeMissingResult {
  run_id: string;
  judged: number;
  skipped: number;
  /** traces that already had a result for the current judge version */
  already_current?: number;
  /** live traces the mock-mode server refused to judge (a mock verdict would never count) */
  skipped_live_in_mock_mode?: number;
}
