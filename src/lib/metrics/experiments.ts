/**
 * Run summaries and paired baseline-vs-candidate comparison.
 *
 * Pass-all = every applicable *validated* deterministic check passes.
 * There is deliberately no weighted average quality score. The experimental
 * LLM judge is reported separately and never contributes to pass-all.
 */
import type { DeterministicResult, EvalOutcome, JudgeVerdict, Trace } from "../domain/schemas";
import { DETERMINISTIC_EVALUATORS, evaluateTrace } from "../evaluators/deterministic";

export interface CaseEvaluation {
  case_id: string;
  trace_id: string | null;
  execution_mode: "live" | "mock" | null;
  execution_error: string | null;
  results: DeterministicResult[];
  /** null = cannot be determined (no trace). Errors count as not passing. */
  pass_all: boolean | null;
  incomplete: boolean;
  failed_evaluators: string[];
  critical_failures: string[];
  judge_verdict: JudgeVerdict | null; // experimental — reported separately
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  cache_hit: boolean;
}

export function passAll(results: DeterministicResult[]): boolean | null {
  if (results.length === 0) return null;
  const applicable = results.filter((r) => r.outcome !== "NOT_APPLICABLE");
  if (applicable.length === 0) return null;
  return applicable.every((r) => r.outcome === "PASS");
}

export function evaluateCase(caseId: string, trace: Trace | null, judgeVerdict: JudgeVerdict | null = null): CaseEvaluation {
  if (!trace) {
    return {
      case_id: caseId,
      trace_id: null,
      execution_mode: null,
      execution_error: "No trace for this case",
      results: [],
      pass_all: null,
      incomplete: true,
      failed_evaluators: [],
      critical_failures: [],
      judge_verdict: judgeVerdict,
      input_tokens: null,
      output_tokens: null,
      latency_ms: null,
      cost_usd: null,
      cache_hit: false,
    };
  }
  const results = evaluateTrace(trace);
  const failed = results.filter((r) => r.outcome === "FAIL" || r.outcome === "ERROR");
  return {
    case_id: caseId,
    trace_id: trace.trace_id,
    execution_mode: trace.execution_mode,
    execution_error: trace.execution_error,
    results,
    pass_all: passAll(results),
    incomplete: Boolean(trace.execution_error) || results.some((r) => r.outcome === "ERROR"),
    failed_evaluators: failed.map((r) => r.evaluator_id),
    critical_failures: results.filter((r) => r.outcome === "FAIL" && r.severity === "critical").map((r) => r.evaluator_id),
    judge_verdict: judgeVerdict,
    input_tokens: trace.token_usage?.input_tokens ?? null,
    output_tokens: trace.token_usage?.output_tokens ?? null,
    latency_ms: trace.latency_ms,
    cost_usd: trace.estimated_cost_usd,
    cache_hit: trace.cache_hit,
  };
}

export interface EvaluatorTally {
  pass: number;
  fail: number;
  not_applicable: number;
  error: number;
  /** pass / (pass + fail + error); null when no applicable results */
  pass_rate: number | null;
}

export interface RunSummary {
  n_cases: number;
  n_with_trace: number;
  n_incomplete: number;
  pass_all_count: number;
  /** pass-all count / n_cases (cases without a trace count as not passing); null when n_cases = 0 */
  pass_all_rate: number | null;
  per_evaluator: Record<string, EvaluatorTally>;
  critical_failure_count: number;
  cases_with_critical_failure: string[];
  judge: Record<JudgeVerdict | "not_run", number>;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  mean_latency_ms: number | null;
  p50_latency_ms: number | null;
  max_latency_ms: number | null;
  execution_modes: Array<"live" | "mock">;
  cache_hits: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarizeRun(evals: CaseEvaluation[]): RunSummary {
  const per: Record<string, EvaluatorTally> = {};
  for (const d of DETERMINISTIC_EVALUATORS) per[d.evaluator_id] = { pass: 0, fail: 0, not_applicable: 0, error: 0, pass_rate: null };
  for (const e of evals) {
    for (const r of e.results) {
      const t = per[r.evaluator_id];
      if (!t) continue;
      if (r.outcome === "PASS") t.pass++;
      else if (r.outcome === "FAIL") t.fail++;
      else if (r.outcome === "NOT_APPLICABLE") t.not_applicable++;
      else t.error++;
    }
  }
  for (const t of Object.values(per)) {
    const den = t.pass + t.fail + t.error;
    t.pass_rate = den === 0 ? null : t.pass / den;
  }
  const judge: RunSummary["judge"] = { FAIL: 0, PASS: 0, REQUIRES_REVIEW: 0, ERROR: 0, not_run: 0 };
  for (const e of evals) judge[e.judge_verdict ?? "not_run"]++;
  const latencies = evals.map((e) => e.latency_ms).filter((x): x is number => x !== null);
  const passCount = evals.filter((e) => e.pass_all === true).length;
  return {
    n_cases: evals.length,
    n_with_trace: evals.filter((e) => e.trace_id !== null).length,
    n_incomplete: evals.filter((e) => e.incomplete).length,
    pass_all_count: passCount,
    pass_all_rate: evals.length === 0 ? null : passCount / evals.length,
    per_evaluator: per,
    critical_failure_count: evals.reduce((n, e) => n + e.critical_failures.length, 0),
    cases_with_critical_failure: evals.filter((e) => e.critical_failures.length > 0).map((e) => e.case_id),
    judge,
    total_input_tokens: evals.reduce((n, e) => n + (e.input_tokens ?? 0), 0),
    total_output_tokens: evals.reduce((n, e) => n + (e.output_tokens ?? 0), 0),
    total_cost_usd: evals.reduce((n, e) => n + (e.cost_usd ?? 0), 0),
    mean_latency_ms: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    p50_latency_ms: median(latencies),
    max_latency_ms: latencies.length ? Math.max(...latencies) : null,
    execution_modes: [...new Set(evals.map((e) => e.execution_mode).filter((m): m is "live" | "mock" => m !== null))],
    cache_hits: evals.filter((e) => e.cache_hit).length,
  };
}

export type CaseChange = "fixed" | "regressed" | "still_failing" | "still_passing" | "incomplete";

export interface EvaluatorChange {
  evaluator_id: string;
  severity: string;
  from: EvalOutcome | null;
  to: EvalOutcome | null;
  kind: "fixed" | "regressed" | "unchanged";
}

export interface PairedCase {
  case_id: string;
  baseline: CaseEvaluation;
  candidate: CaseEvaluation;
  change: CaseChange;
  evaluator_changes: EvaluatorChange[];
  new_critical_regressions: string[];
}

export interface RunComparison {
  pairs: PairedCase[];
  fixed: string[];
  regressed: string[];
  still_failing: string[];
  still_passing: string[];
  incomplete: string[];
  new_regressions: Array<{ case_id: string; evaluator_id: string; severity: string }>;
  new_critical_regressions: Array<{ case_id: string; evaluator_id: string }>;
  per_evaluator: Record<string, { baseline: EvaluatorTally; candidate: EvaluatorTally }>;
  baseline_summary: RunSummary;
  candidate_summary: RunSummary;
}

/** Paired, case-level comparison. Both runs must cover exactly the same cases. */
export function compareRuns(baseline: CaseEvaluation[], candidate: CaseEvaluation[]): RunComparison {
  const bIds = baseline.map((e) => e.case_id).sort();
  const cIds = candidate.map((e) => e.case_id).sort();
  if (bIds.join("|") !== cIds.join("|")) {
    throw new Error("Runs cover different cases — comparisons require the same frozen set");
  }
  const byCase = new Map(candidate.map((e) => [e.case_id, e]));
  const pairs: PairedCase[] = baseline.map((b) => {
    const c = byCase.get(b.case_id)!;
    const evaluator_changes: EvaluatorChange[] = DETERMINISTIC_EVALUATORS.map((d) => {
      const from = b.results.find((r) => r.evaluator_id === d.evaluator_id)?.outcome ?? null;
      const to = c.results.find((r) => r.evaluator_id === d.evaluator_id)?.outcome ?? null;
      const kind: EvaluatorChange["kind"] =
        from === "PASS" && (to === "FAIL" || to === "ERROR")
          ? "regressed"
          : (from === "FAIL" || from === "ERROR") && to === "PASS"
            ? "fixed"
            : "unchanged";
      return { evaluator_id: d.evaluator_id, severity: d.severity, from, to, kind };
    });
    let change: CaseChange;
    if (b.pass_all === null || c.pass_all === null || b.incomplete || c.incomplete) change = "incomplete";
    else if (!b.pass_all && c.pass_all) change = "fixed";
    else if (b.pass_all && !c.pass_all) change = "regressed";
    else if (!b.pass_all && !c.pass_all) change = "still_failing";
    else change = "still_passing";
    return {
      case_id: b.case_id,
      baseline: b,
      candidate: c,
      change,
      evaluator_changes,
      new_critical_regressions: evaluator_changes
        .filter((x) => x.kind === "regressed" && x.severity === "critical")
        .map((x) => x.evaluator_id),
    };
  });
  const bSum = summarizeRun(baseline);
  const cSum = summarizeRun(candidate);
  const per: RunComparison["per_evaluator"] = {};
  for (const d of DETERMINISTIC_EVALUATORS) {
    per[d.evaluator_id] = { baseline: bSum.per_evaluator[d.evaluator_id], candidate: cSum.per_evaluator[d.evaluator_id] };
  }
  const ids = (k: CaseChange) => pairs.filter((p) => p.change === k).map((p) => p.case_id);
  return {
    pairs,
    fixed: ids("fixed"),
    regressed: ids("regressed"),
    still_failing: ids("still_failing"),
    still_passing: ids("still_passing"),
    incomplete: ids("incomplete"),
    new_regressions: pairs.flatMap((p) =>
      p.evaluator_changes.filter((x) => x.kind === "regressed").map((x) => ({ case_id: p.case_id, evaluator_id: x.evaluator_id, severity: x.severity })),
    ),
    new_critical_regressions: pairs.flatMap((p) => p.new_critical_regressions.map((evaluator_id) => ({ case_id: p.case_id, evaluator_id }))),
    per_evaluator: per,
    baseline_summary: bSum,
    candidate_summary: cSum,
  };
}
