/**
 * Read models that combine storage with the pure evaluation logic. API routes
 * call these; UI never computes evaluation results itself.
 */
import type {
  Annotation,
  ExperimentRun,
  GoldExample,
  JudgeResult,
  Trace,
} from "../domain/schemas";
import { SCENARIOS, SPLIT_ASSIGNMENT, getScenario, splitOf } from "../domain/scenarios";
import { selectEffectivePolicy } from "../domain/policies";
import { applicablePromotion, marginAtRequestedPrice, marginFloor, requiredApprovals, requiredCostBasis } from "../domain/economics";
import { DETERMINISTIC_EVALUATORS, evaluateTrace } from "../evaluators/deterministic";
import { judgeVersion } from "../judge/judge";
import { DEFAULT_RUBRIC, type JudgeCriterion } from "../rubric/rubric";
import { calibrationReport, type CalibrationPair } from "../metrics/calibration";
import { compareRuns, evaluateCase, summarizeRun, type CaseEvaluation } from "../metrics/experiments";
import { evaluateReleaseGate, MIN_REVIEWED_TRACES } from "../release/gate";
import { AGENT_CONFIGS, getAgentConfig } from "../agent/configs";
import { getFrozenSet, runMatchesFrozenContent, verifyFrozenSet } from "../experiments/frozen";
import { REVIEW_TARGET } from "../domain/review";
import { recoverOrphanedRuns } from "../experiments/runner";
import { observedFrequencies, resolveModeId, withObservedStatus } from "../taxonomy/ops";
import {
  audit,
  getHeldoutState,
  getTrace,
  latestTaxonomy,
  listAnnotations,
  listApprovals,
  listExperimentRuns,
  listGold,
  listJudgeResults,
  listTraces,
  upsertGold,
  latestRubric,
} from "../storage/repos";
import { sha256 } from "../storage/store";

// ---------------------------------------------------------------------------
// Judge result selection
// ---------------------------------------------------------------------------

export function currentJudgeVersionFor(
  trace: Pick<Trace, "execution_mode">,
  criterion: JudgeCriterion = DEFAULT_RUBRIC.judge_criterion,
): string {
  return judgeVersion(trace.execution_mode === "mock" ? "mock" : "live", criterion);
}

/**
 * Latest judge result for each trace under the CURRENT judge version (older versions don't count).
 * The version depends on the rubric's judge criterion, so editing the rubric retires old results.
 */
export function latestJudgeByTrace(
  results: JudgeResult[],
  traces: Trace[],
  criterion: JudgeCriterion = DEFAULT_RUBRIC.judge_criterion,
): Map<string, JudgeResult> {
  const map = new Map<string, JudgeResult>();
  const byId = new Map(traces.map((t) => [t.trace_id, t]));
  const versions = { live: judgeVersion("live", criterion), mock: judgeVersion("mock", criterion) };
  for (const r of [...results].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const t = byId.get(r.trace_id);
    if (t && r.judge_version === versions[t.execution_mode]) map.set(r.trace_id, r);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Trace review queue
// ---------------------------------------------------------------------------

export interface QueueItem {
  trace: Trace;
  split: "dev" | "heldout" | null;
  annotations: Annotation[];
  reviewed: boolean;
}

export async function reviewQueue(): Promise<{ items: QueueItem[]; reviewed_count: number; total: number }> {
  const [traces, annotations] = await Promise.all([listTraces(), listAnnotations()]);
  const items = traces.map((t) => {
    const anns = annotations.filter((a) => a.trace_id === t.trace_id);
    return { trace: t, split: splitOf(t.case_id), annotations: anns, reviewed: anns.length > 0 };
  });
  return { items, reviewed_count: items.filter((i) => i.reviewed).length, total: items.length };
}

/** Deterministic results + judge results for one trace (shown only after a human has reviewed it in the UI). */
export async function traceEvaluations(traceId: string) {
  const trace = await getTrace(traceId);
  if (!trace) return null;
  const [all, rubric] = await Promise.all([listJudgeResults(), latestRubric()]);
  const judge = all.filter((j) => j.trace_id === traceId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    deterministic: evaluateTrace(trace),
    judge_results: judge,
    current_judge_version: currentJudgeVersionFor(trace, rubric.judge_criterion),
    rubric_version: rubric.version,
  };
}

// ---------------------------------------------------------------------------
// Taxonomy with observed frequencies
// ---------------------------------------------------------------------------

export async function taxonomyView() {
  const [tax, annotations] = await Promise.all([latestTaxonomy(), listAnnotations()]);
  const freqs = observedFrequencies(tax.failure_modes, annotations);
  return {
    version: tax.version,
    author: tax.author,
    change_note: tax.change_note,
    created_at: tax.created_at,
    failure_modes: withObservedStatus(tax.failure_modes, freqs),
    frequencies: freqs,
    reviewed_trace_count: new Set(annotations.map((a) => a.trace_id)).size,
  };
}

// ---------------------------------------------------------------------------
// Gold dataset
// ---------------------------------------------------------------------------

export function expectedBehaviorFor(caseId: string): { text: string; reference_policy_ids: string[] } {
  const s = getScenario(caseId);
  if (!s) throw new Error(`Unknown case ${caseId}`);
  const p = selectEffectivePolicy(s.decision_date);
  if (!p) return { text: "No policy is effective on the decision date; the agent should report the gap and not apply any policy.", reference_policy_ids: [] };
  const floor = marginFloor(s, p);
  const cost = requiredCostBasis(s, p);
  const m = marginAtRequestedPrice(s, p);
  const approvals = requiredApprovals(s, p, s.request.requested_pricing);
  const promo = applicablePromotion(s, p);
  const lines = [
    `Select ${p.policy_id} (effective ${p.effective_from} → ${p.effective_to ?? "open"}) for decision date ${s.decision_date}.`,
    `Cost basis: ${cost.source === "merchant_data" ? "merchant data" : "policy default"} (${cost.cost_bps} bps + $${cost.per_txn_cost_usd.toFixed(2)}/txn).`,
    `Minimum margin for ${s.merchant.size}: ${floor.base_floor_pct}%${promo ? ` − ${floor.relief_pp}pp ${promo.code} relief = ${floor.effective_floor_pct}%` : ""}${
      s.exception.status === "promotion" && !promo ? ` (promotion ${s.exception.promo_code} is not valid under this policy on this date: no relief)` : ""
    }.`,
    `Margin at the requested price: ${m === null ? "undefined" : `${m.toFixed(2)}%`} → ${
      m !== null && m >= floor.effective_floor_pct
        ? "requested price is compliant"
        : s.exception.status === "strategic_exception"
          ? "below floor; permissible only as a strategic exception routed to cfo_delegate"
          : "below floor; counter-offer or decline"
    }.`,
    `Approvals required at the requested price: ${approvals.length ? approvals.map((a) => a.approver_role).join(", ") : "none"} (re-derive for any counter-offer price).`,
    "Explanation must cite only supplied evidence; merchant statements are unverified.",
  ];
  return { text: lines.join("\n"), reference_policy_ids: [p.policy_id] };
}

export async function promoteToGold(input: { annotation_id: string; promoted_by: string; expected_behavior?: string }): Promise<GoldExample> {
  const annotation = (await listAnnotations()).find((a) => a.annotation_id === input.annotation_id);
  if (!annotation) throw new Error("Annotation not found");
  if (annotation.label_source !== "human" || !annotation.reviewer.trim()) throw new Error("Only human-reviewed annotations can become gold");
  if (!input.promoted_by.trim()) throw new Error("promoted_by is required");
  const trace = await getTrace(annotation.trace_id);
  if (!trace) throw new Error("Trace not found");
  const split = SPLIT_ASSIGNMENT[trace.case_id];
  if (!split || trace.data_origin !== "synthetic") {
    throw new Error("Only frozen synthetic cases (with a dev/held-out split) can be promoted to gold");
  }
  const tax = await latestTaxonomy();
  const modes = [annotation.first_failure?.failure_mode_id, ...annotation.additional_failure_mode_ids]
    .filter((x): x is string => Boolean(x))
    .map((id) => resolveModeId(tax.failure_modes, id));
  const existing = (await listGold()).find((g) => g.trace_id === trace.trace_id);
  const expected = expectedBehaviorFor(trace.case_id);
  const gold: GoldExample = {
    gold_id: existing?.gold_id ?? `gold_${trace.case_id}_${trace.trace_id}`,
    case_id: trace.case_id,
    trace_id: trace.trace_id,
    annotation_id: annotation.annotation_id,
    input_scenario: trace.input,
    reference_policy_ids: expected.reference_policy_ids,
    expected_behavior: input.expected_behavior?.trim() || expected.text,
    applicable_objective_rules: DETERMINISTIC_EVALUATORS.map((d) => d.evaluator_id),
    human_label: annotation.task_outcome,
    failure_mode_ids: [...new Set(modes)],
    unsupported_justification_label: annotation.unsupported_justification_label,
    supporting_evidence: [annotation.first_failure?.description, annotation.open_coding_notes].filter(Boolean).join("\n\n"),
    reviewer: annotation.reviewer,
    review_timestamp: annotation.updated_at,
    label_version: (existing?.label_version ?? 0) + 1,
    dataset_split: split,
    label_source: "human",
    trace_execution_mode: trace.execution_mode,
    promoted_at: new Date().toISOString(),
    promoted_by: input.promoted_by.trim(),
  };
  await upsertGold(gold);
  await audit(input.promoted_by, "gold.promoted", {
    gold_id: gold.gold_id,
    annotation_id: annotation.annotation_id,
    split,
    label_version: gold.label_version,
    replaced_annotation_id: existing && existing.annotation_id !== annotation.annotation_id ? existing.annotation_id : null,
  });
  return gold;
}

// ---------------------------------------------------------------------------
// Judge calibration
// ---------------------------------------------------------------------------

export async function calibrationView(opts: { split: "dev" | "heldout"; mode: "live" | "mock" }) {
  const heldout = await getHeldoutState();
  if (opts.split === "heldout" && !heldout.revealed) {
    return { locked: true as const, heldout };
  }
  const [gold, judgeResults, traces, annotations, rubric] = await Promise.all([
    listGold(),
    listJudgeResults(),
    listTraces(),
    listAnnotations(),
    latestRubric(),
  ]);
  const latest = latestJudgeByTrace(judgeResults, traces, rubric.judge_criterion);
  const inScope = gold.filter((g) => g.dataset_split === opts.split && g.trace_execution_mode === opts.mode);
  const labelled = inScope.filter((g) => g.unsupported_justification_label !== "not_assessed");
  const pairs: Array<CalibrationPair & { gold_id: string }> = [];
  const notJudged: string[] = [];
  for (const g of labelled) {
    const j = latest.get(g.trace_id);
    if (!j) {
      notJudged.push(g.trace_id);
      continue;
    }
    pairs.push({ gold_id: g.gold_id, trace_id: g.trace_id, case_id: g.case_id, human_failure: g.unsupported_justification_label === "present", judge_verdict: j.verdict });
  }
  const report = calibrationReport(pairs);
  const goldTraceIds = new Set(gold.map((g) => g.trace_id));
  const reviewedNotPromoted = annotations.filter(
    (a) => a.unsupported_justification_label !== "not_assessed" && !goldTraceIds.has(a.trace_id),
  ).length;
  const inScopeTraceIds = new Set(labelled.map((g) => g.trace_id));
  const versions = [...new Set([...latest.values()].filter((j) => inScopeTraceIds.has(j.trace_id)).map((j) => j.judge_version))];
  return {
    locked: false as const,
    heldout,
    split: opts.split,
    mode: opts.mode,
    judge_version: judgeVersion(opts.mode, rubric.judge_criterion),
    rubric_version: rubric.version,
    judge_versions_present: versions,
    gold_in_scope: inScope.length,
    labelled_examples: labelled.length,
    labelled_positives: labelled.filter((g) => g.unsupported_justification_label === "present").length,
    labelled_negatives: labelled.filter((g) => g.unsupported_justification_label === "absent").length,
    not_assessed: inScope.length - labelled.length,
    not_judged_trace_ids: notJudged,
    reviewed_not_promoted: reviewedNotPromoted,
    report,
    disagreements: report.disagreements.map((d) => ({
      ...d,
      judge: latest.get(d.trace_id) ?? null,
      gold: labelled.find((g) => g.trace_id === d.trace_id) ?? null,
    })),
    requires_review: pairs
      .filter((p) => p.judge_verdict === "REQUIRES_REVIEW" || p.judge_verdict === "ERROR")
      .map((p) => ({ ...p, judge: latest.get(p.trace_id) ?? null })),
  };
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export async function caseEvaluationsForRun(run: ExperimentRun, judgeResults?: JudgeResult[]): Promise<CaseEvaluation[]> {
  const traces = (await Promise.all(Object.values(run.trace_ids).map((id) => getTrace(id)))).filter((t): t is Trace => t !== null);
  const rubric = await latestRubric();
  const latest = latestJudgeByTrace(judgeResults ?? (await listJudgeResults()), traces, rubric.judge_criterion);
  return run.case_ids.map((caseId) => {
    const t = traces.find((x) => x.case_id === caseId) ?? null;
    return evaluateCase(caseId, t, t ? (latest.get(t.trace_id)?.verdict ?? null) : null);
  });
}

export async function runDetail(run: ExperimentRun) {
  const evals = await caseEvaluationsForRun(run);
  return {
    run,
    config: getAgentConfig(run.agent_config_id),
    evals,
    summary: summarizeRun(evals),
    // false = recorded on case/policy content that has since changed; results are shown but not comparable.
    matches_current_content: runMatchesFrozenContent(run),
  };
}

export async function compareRunIds(baselineRunId: string, candidateRunId: string) {
  const runs = await listExperimentRuns();
  const b = runs.find((r) => r.run_id === baselineRunId);
  const c = runs.find((r) => r.run_id === candidateRunId);
  if (!b || !c) throw new Error("Run not found");
  if (b.frozen_set_id !== c.frozen_set_id || b.frozen_set_hash !== c.frozen_set_hash) {
    throw new Error("Runs used different frozen sets; paired comparison is not valid");
  }
  if (!runMatchesFrozenContent(b) || !runMatchesFrozenContent(c)) {
    throw new Error(
      "These runs were recorded on different case/policy content than the current frozen set (cases or policies changed since). Re-run both configurations on the current set before comparing.",
    );
  }
  const judgeResults = await listJudgeResults();
  const [be, ce] = await Promise.all([caseEvaluationsForRun(b, judgeResults), caseEvaluationsForRun(c, judgeResults)]);
  return {
    baseline: { run: b, config: getAgentConfig(b.agent_config_id) },
    candidate: { run: c, config: getAgentConfig(c.agent_config_id) },
    mode_mismatch: b.execution_mode !== c.execution_mode,
    comparison: compareRuns(be, ce),
  };
}

// ---------------------------------------------------------------------------
// Release gate
// ---------------------------------------------------------------------------

/** Default run for a role: newest completed run on the set, preferring LIVE over mock (mock is never evidence). */
function latestCompleted(runs: ExperimentRun[], role: "baseline" | "corrected", frozenSetId: string): ExperimentRun | null {
  const matching = runs.filter(
    (r) => r.status === "completed" && r.frozen_set_id === frozenSetId && getAgentConfig(r.agent_config_id).role === role,
  );
  return matching.find((r) => r.execution_mode === "live") ?? matching[0] ?? null;
}

export async function releaseView(opts: { candidate_run_id?: string; baseline_run_id?: string } = {}) {
  await recoverOrphanedRuns();
  const required = getFrozenSet("FROZEN-FULL-v1")!;
  const [runs, annotations, approvals, judgeResults] = await Promise.all([
    listExperimentRuns(),
    listAnnotations(),
    listApprovals(),
    listJudgeResults(),
  ]);
  const candidateRun = opts.candidate_run_id
    ? (runs.find((r) => r.run_id === opts.candidate_run_id) ?? null)
    : latestCompleted(runs, "corrected", required.frozen_set_id);
  const baselineRun = opts.baseline_run_id
    ? (runs.find((r) => r.run_id === opts.baseline_run_id) ?? null)
    : latestCompleted(runs, "baseline", required.frozen_set_id);
  const candidateEvals = candidateRun ? await caseEvaluationsForRun(candidateRun, judgeResults) : [];
  const baselineEvals = baselineRun ? await caseEvaluationsForRun(baselineRun, judgeResults) : [];
  const candidateTraceIds = new Set(Object.values(candidateRun?.trace_ids ?? {}));
  const candidateAnnotations = annotations
    .filter((a) => candidateTraceIds.has(a.trace_id))
    .map((a) => ({
      trace_id: a.trace_id,
      case_id: a.case_id,
      task_outcome: a.task_outcome,
      severity: a.severity,
      reviewer: a.reviewer,
      unsupported_justification_label: a.unsupported_justification_label,
      annotation_id: a.annotation_id,
      updated_at: a.updated_at,
    }));
  const mode = candidateRun?.execution_mode ?? "live";
  const rubric = await latestRubric();
  const devCal = await calibrationView({ split: "dev", mode });
  const judgeInsufficient = devCal.locked ? true : devCal.report.insufficient;
  const reviewedCount = new Set(annotations.map((a) => a.trace_id)).size;

  const snapshot = {
    candidate_run_id: candidateRun?.run_id ?? null,
    baseline_run_id: baselineRun?.run_id ?? null,
    frozen_set_hash: required.content_hash,
    evaluator_versions: DETERMINISTIC_EVALUATORS.map((d) => `${d.evaluator_id}@${d.version}`),
    judge_version: judgeVersion(mode, rubric.judge_criterion),
    candidate: candidateEvals.map((e) => ({ c: e.case_id, t: e.trace_id, r: e.results.map((r) => r.outcome), j: e.judge_verdict })),
    baseline: baselineEvals.map((e) => ({ c: e.case_id, t: e.trace_id, r: e.results.map((r) => r.outcome) })),
    candidate_annotations: candidateAnnotations.map((a) => [a.annotation_id, a.updated_at, a.task_outcome, a.severity, a.unsupported_justification_label]),
    // Only the gate-relevant fact, so reviewing an unrelated trace does not make an approval stale.
    review_coverage_met: reviewedCount >= MIN_REVIEWED_TRACES,
    judge_insufficient: judgeInsufficient,
  };
  const evidence_snapshot_hash = sha256(snapshot);
  const gate = evaluateReleaseGate({
    required_set: required,
    required_set_valid: verifyFrozenSet(required),
    candidate: candidateRun ? { run: candidateRun, evals: candidateEvals } : null,
    baseline: baselineRun ? { run: baselineRun, evals: baselineEvals } : null,
    reviewed_trace_count: reviewedCount,
    candidate_annotations: candidateAnnotations,
    judge: { version: judgeVersion(mode, rubric.judge_criterion), insufficient_validation: judgeInsufficient },
    approvals,
    evidence_snapshot_hash,
  });
  let comparison = null;
  if (candidateRun && baselineRun && candidateRun.frozen_set_hash === baselineRun.frozen_set_hash) {
    comparison = compareRuns(baselineEvals, candidateEvals);
  }
  return {
    gate,
    evidence_snapshot_hash,
    required_set: required,
    candidate_run: candidateRun,
    baseline_run: baselineRun,
    candidate_summary: candidateRun ? summarizeRun(candidateEvals) : null,
    candidate_evals: candidateEvals,
    comparison,
    approvals: approvals.filter((a) => a.candidate_run_id === candidateRun?.run_id),
    runs: runs.map((r) => ({ run_id: r.run_id, agent_config_id: r.agent_config_id, frozen_set_id: r.frozen_set_id, status: r.status, execution_mode: r.execution_mode, created_at: r.created_at })),
  };
}

// ---------------------------------------------------------------------------
// Trend: quality by agent version (dashboard line chart)
// ---------------------------------------------------------------------------

export interface TrendPoint {
  config_id: string;
  label: string;
  role: "baseline" | "corrected";
  run_id: string;
  created_at: string;
  execution_mode: "live" | "mock";
  n_cases: number;
  pass_all_count: number;
  pass_all_rate: number | null;
  checks: Array<{ evaluator_id: string; pass: number; total: number; rate: number | null }>;
  critical_failures: number;
  judge_flags: number;
}

/**
 * One point per agent version (in config order): its latest completed run on the
 * current content of a frozen set. Prefers the full 20-case set when every version
 * has run on it, else the 12-case dev set. Live runs win over mock.
 */
export async function trendView() {
  const [runs, judgeResults] = await Promise.all([listExperimentRuns(), listJudgeResults()]);
  const usable = runs.filter((r) => r.status === "completed" && runMatchesFrozenContent(r));
  const live = usable.filter((r) => r.execution_mode === "live");
  const pool = live.length > 0 ? live : usable;
  const latestFor = (configId: string, setId: string) =>
    pool.find((r) => r.agent_config_id === configId && r.frozen_set_id === setId) ?? null;
  const setId = AGENT_CONFIGS.every((c) => latestFor(c.config_id, "FROZEN-FULL-v1"))
    ? "FROZEN-FULL-v1"
    : "FROZEN-DEV-v1";
  const points: TrendPoint[] = [];
  const evalsByRun = new Map<string, CaseEvaluation[]>();
  for (const c of AGENT_CONFIGS) {
    const run = latestFor(c.config_id, setId);
    if (!run) continue;
    const evals = await caseEvaluationsForRun(run, judgeResults);
    evalsByRun.set(run.run_id, evals);
    const sum = summarizeRun(evals);
    points.push({
      config_id: c.config_id,
      label: c.label,
      role: c.role,
      run_id: run.run_id,
      created_at: run.created_at,
      execution_mode: run.execution_mode,
      n_cases: sum.n_cases,
      pass_all_count: sum.pass_all_count,
      pass_all_rate: sum.pass_all_rate,
      checks: DETERMINISTIC_EVALUATORS.map((d) => {
        const t = sum.per_evaluator[d.evaluator_id];
        const total = t.pass + t.fail + t.error;
        return { evaluator_id: d.evaluator_id, pass: t.pass, total, rate: total ? t.pass / total : null };
      }),
      critical_failures: sum.cases_with_critical_failure.length,
      judge_flags: sum.judge.FAIL,
    });
  }
  const b = points.find((p) => p.role === "baseline");
  const c = points.find((p) => p.role === "corrected");
  const comparison =
    b && c && b.execution_mode === c.execution_mode ? compareRuns(evalsByRun.get(b.run_id)!, evalsByRun.get(c.run_id)!) : null;
  return {
    frozen_set_id: points.length ? setId : null,
    points,
    fixed: comparison?.fixed ?? [],
    regressed: comparison?.regressed ?? [],
    new_critical_regressions: comparison?.new_critical_regressions ?? [],
    still_failing: comparison?.still_failing ?? [],
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function overviewView() {
  const [traces, annotations, gold, release, tax, trend] = await Promise.all([
    listTraces(),
    listAnnotations(),
    listGold(),
    releaseView(),
    taxonomyView(),
    trendView(),
  ]);
  const reviewed = new Set(annotations.map((a) => a.trace_id));
  return {
    executions: {
      total: traces.length,
      live: traces.filter((t) => t.execution_mode === "live").length,
      mock: traces.filter((t) => t.execution_mode === "mock").length,
      errors: traces.filter((t) => t.execution_error).length,
      live_cost_usd: traces.reduce((n, t) => n + (t.estimated_cost_usd ?? 0), 0),
    },
    review: {
      reviewed_traces: reviewed.size,
      reviewed_live: traces.filter((t) => t.execution_mode === "live" && reviewed.has(t.trace_id)).length,
      target_min: REVIEW_TARGET.min,
      target_max: REVIEW_TARGET.max,
      unreviewed: traces.length - reviewed.size,
      gold_examples: gold.length,
      gold_dev: gold.filter((g) => g.dataset_split === "dev").length,
      gold_heldout: gold.filter((g) => g.dataset_split === "heldout").length,
    },
    pass_all_rate: release.gate.pass_all_rate,
    candidate_summary: release.candidate_summary,
    candidate_run: release.candidate_run,
    critical_failures: release.candidate_summary?.critical_failure_count ?? null,
    release_status: release.gate.status,
    release_reasons: release.gate.reasons,
    observed_failure_modes: tax.frequencies.filter((f) => f.any_count > 0).length,
    taxonomy_version: tax.version,
    scenario_count: SCENARIOS.length,
    trend,
  };
}
