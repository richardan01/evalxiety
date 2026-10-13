/**
 * Pure helpers for the results matrix: filtering and outcome tallies.
 * Tallies are raw counts with an explicit denominator (the rows shown) — no percentages.
 */
import type { EvaluatorResultRow } from "./types";

export const ALL = "__all__";
export const NO_RUN = "__none__";

export interface MatrixFilters {
  mode: "all" | "live" | "mock";
  /** agent_version or ALL */
  config: string;
  /** experiment_run_id, NO_RUN (single ad-hoc runs) or ALL */
  runId: string;
  split: "all" | "dev" | "heldout" | "custom";
}

export const DEFAULT_FILTERS: MatrixFilters = { mode: "all", config: ALL, runId: ALL, split: "all" };

export function filterRows(rows: EvaluatorResultRow[], f: MatrixFilters): EvaluatorResultRow[] {
  return rows.filter(
    (r) =>
      (f.mode === "all" || r.execution_mode === f.mode) &&
      (f.config === ALL || r.agent_version === f.config) &&
      (f.runId === ALL || (f.runId === NO_RUN ? r.experiment_run_id === null : r.experiment_run_id === f.runId)) &&
      (f.split === "all" || (f.split === "custom" ? r.split === null : r.split === f.split)),
  );
}

export interface OutcomeTally {
  pass: number;
  fail: number;
  not_applicable: number;
  error: number;
  /** rows with no result for this evaluator (should not happen; shown if it does) */
  missing: number;
  total: number;
}

export function tallyEvaluator(rows: EvaluatorResultRow[], evaluatorId: string): OutcomeTally {
  const t: OutcomeTally = { pass: 0, fail: 0, not_applicable: 0, error: 0, missing: 0, total: rows.length };
  for (const r of rows) {
    const cell = r.deterministic.find((d) => d.evaluator_id === evaluatorId);
    if (!cell) t.missing++;
    else if (cell.outcome === "PASS") t.pass++;
    else if (cell.outcome === "FAIL") t.fail++;
    else if (cell.outcome === "NOT_APPLICABLE") t.not_applicable++;
    else t.error++;
  }
  return t;
}

export interface JudgeTally {
  pass: number;
  fail: number;
  requires_review: number;
  error: number;
  not_judged: number;
  total: number;
}

export function tallyJudge(rows: EvaluatorResultRow[]): JudgeTally {
  const t: JudgeTally = { pass: 0, fail: 0, requires_review: 0, error: 0, not_judged: 0, total: rows.length };
  for (const r of rows) {
    const v = r.judge?.verdict;
    if (!v) t.not_judged++;
    else if (v === "PASS") t.pass++;
    else if (v === "FAIL") t.fail++;
    else if (v === "REQUIRES_REVIEW") t.requires_review++;
    else t.error++;
  }
  return t;
}

export function modeMix(rows: EvaluatorResultRow[]): { live: number; mock: number } {
  return {
    live: rows.filter((r) => r.execution_mode === "live").length,
    mock: rows.filter((r) => r.execution_mode === "mock").length,
  };
}

/** "margin_calculation_error" -> "margin calculation error" (fallback when no plain name is defined). */
export const humanizeId = (id: string) => id.replace(/_/g, " ");

/** Plain-English names shown on screen; the technical id stays one click away. */
export const CHECK_NAMES: Record<string, string> = {
  stale_policy_used: "Right policy for the date",
  margin_calculation_error: "Margin math",
  margin_guardrail_violation: "Margin floor",
  missing_mandatory_approval: "Required approvals",
  unsupported_pricing_justification: "Reasons backed by evidence",
};

export const plainName = (id: string) => CHECK_NAMES[id] ?? humanizeId(id);

const ORDER = Object.keys(CHECK_NAMES);

/** Stable display order (policy → math → floor → approvals); unknown ids keep their order at the end. */
export function orderChecks<T extends { evaluator_id: string }>(defs: T[]): T[] {
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return [...defs].sort((a, b) => rank(a.evaluator_id) - rank(b.evaluator_id));
}
