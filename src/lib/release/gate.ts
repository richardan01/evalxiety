/**
 * Release gate. Evaluation is separate from approval:
 *
 *   evaluation_status ∈ {NO_SHIP, INSUFFICIENT_EVIDENCE, ELIGIBLE_FOR_DEMO_APPROVAL}
 *   status            = APPROVED_FOR_DEMO only when eligible AND a named human
 *                       approved this exact evidence snapshot.
 *
 * Precedence: NO_SHIP > INSUFFICIENT_EVIDENCE > ELIGIBLE. This is a demo gate
 * for a small synthetic prototype set — never a production certification.
 */
import type { ExperimentRun, FrozenSet, JudgeVerdict, ReleaseApproval, ReleaseStatus, Severity } from "../domain/schemas";
import { compareRuns, summarizeRun, type CaseEvaluation } from "../metrics/experiments";
import { REVIEW_TARGET } from "../domain/review";

export const PASS_ALL_THRESHOLD = 0.9;
export const MIN_REVIEWED_TRACES = REVIEW_TARGET.min;
const JUDGE_NEEDS_REVIEW: JudgeVerdict[] = ["FAIL", "REQUIRES_REVIEW", "ERROR"];

export interface GateAnnotation {
  trace_id: string;
  case_id: string;
  task_outcome: "pass" | "fail";
  severity: Severity | null;
  reviewer: string;
}

export interface GateInput {
  required_set: FrozenSet;
  required_set_valid: boolean;
  candidate: { run: ExperimentRun; evals: CaseEvaluation[] } | null;
  baseline: { run: ExperimentRun; evals: CaseEvaluation[] } | null;
  /** distinct traces with at least one human annotation (error-analysis coverage) */
  reviewed_trace_count: number;
  /** human annotations on the candidate run's traces */
  candidate_annotations: GateAnnotation[];
  judge: { version: string; insufficient_validation: boolean };
  approvals: ReleaseApproval[];
  evidence_snapshot_hash: string;
}

export type ReasonLevel = "NO_SHIP" | "INSUFFICIENT_EVIDENCE" | "WARNING";

export interface GateReason {
  code: string;
  level: ReasonLevel;
  message: string;
  case_ids: string[];
}

export interface GateCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "pending";
  detail: string;
}

export interface GateResult {
  evaluation_status: Exclude<ReleaseStatus, "APPROVED_FOR_DEMO">;
  status: ReleaseStatus;
  reasons: GateReason[];
  checks: GateCheck[];
  pass_all_rate: number | null;
  unresolved_reviews: Array<{ trace_id: string; case_id: string; reason: string }>;
  approval_state: "none" | "approved" | "rejected" | "stale";
  latest_approval: ReleaseApproval | null;
  limitations: string[];
}

export function evaluateReleaseGate(input: GateInput): GateResult {
  const reasons: GateReason[] = [];
  const checks: GateCheck[] = [];
  const add = (code: string, level: ReasonLevel, message: string, case_ids: string[] = []) =>
    reasons.push({ code, level, message, case_ids });

  const { candidate, baseline, required_set } = input;
  const evals = candidate?.evals ?? [];
  const summary = candidate ? summarizeRun(evals) : null;

  // ---- Evidence completeness ------------------------------------------------
  if (!candidate) {
    add("no_candidate_run", "INSUFFICIENT_EVIDENCE", "No candidate run selected.");
  } else {
    if (candidate.run.status !== "completed") {
      add("candidate_run_incomplete", "INSUFFICIENT_EVIDENCE", `Candidate run is ${candidate.run.status}.`);
    }
    if (candidate.run.frozen_set_id !== required_set.frozen_set_id) {
      add(
        "candidate_not_on_required_set",
        "INSUFFICIENT_EVIDENCE",
        `Candidate ran on ${candidate.run.frozen_set_id}; the gate requires ${required_set.frozen_set_id}.`,
      );
    } else if (candidate.run.frozen_set_hash !== required_set.content_hash) {
      add("frozen_set_mismatch", "INSUFFICIENT_EVIDENCE", "Candidate run's frozen-set hash differs from the current frozen cases.");
    }
    const missing = required_set.case_ids.filter((id) => !evals.some((e) => e.case_id === id && e.trace_id));
    const errored = evals.filter((e) => e.incomplete && e.trace_id).map((e) => e.case_id);
    if (missing.length || errored.length) {
      add(
        "required_tests_incomplete",
        "INSUFFICIENT_EVIDENCE",
        `Required tests incomplete: ${missing.length} case(s) without a trace, ${errored.length} with execution errors.`,
        [...missing, ...errored],
      );
    }
    if (evals.some((e) => e.execution_mode === "mock")) {
      add("mock_results", "INSUFFICIENT_EVIDENCE", "Candidate results come from the MOCK agent; mock output is not release evidence.");
    }
    const notJudged = evals.filter((e) => e.trace_id && e.judge_verdict === null).map((e) => e.case_id);
    if (notJudged.length) {
      add(
        "judge_not_run",
        "INSUFFICIENT_EVIDENCE",
        `The unsupported-justification judge has not been run on ${notJudged.length} candidate case(s).`,
        notJudged,
      );
    }
  }
  if (!input.required_set_valid) {
    add("frozen_set_modified", "INSUFFICIENT_EVIDENCE", "Frozen case content no longer matches its recorded hash.");
  }

  let comparison: ReturnType<typeof compareRuns> | null = null;
  if (!baseline) {
    add("no_baseline", "INSUFFICIENT_EVIDENCE", "No baseline run on the same frozen set — regressions cannot be checked.");
  } else if (candidate) {
    if (baseline.run.frozen_set_hash !== candidate.run.frozen_set_hash || baseline.run.frozen_set_id !== candidate.run.frozen_set_id) {
      add("baseline_set_mismatch", "INSUFFICIENT_EVIDENCE", "Baseline and candidate ran on different frozen sets.");
    } else if (baseline.run.execution_mode !== candidate.run.execution_mode) {
      add("mode_mismatch", "INSUFFICIENT_EVIDENCE", "Baseline and candidate used different execution modes (live vs mock).");
    } else {
      comparison = compareRuns(baseline.evals, evals);
    }
  }

  if (input.reviewed_trace_count < MIN_REVIEWED_TRACES) {
    add(
      "insufficient_human_review",
      "INSUFFICIENT_EVIDENCE",
      `Only ${input.reviewed_trace_count} trace(s) have human review; error analysis needs at least ${MIN_REVIEWED_TRACES}.`,
    );
  }

  // The judge is not validated, so none of its verdicts can stand in for a human: a judge
  // PASS can miss a failure just as a FAIL can be wrong. Every candidate case therefore needs
  // a human annotation on that exact trace before the candidate can be eligible.
  const annotatedTraces = new Set(input.candidate_annotations.map((a) => a.trace_id));
  const unresolved = evals
    .filter((e) => e.trace_id && !annotatedTraces.has(e.trace_id))
    .map((e) => ({
      trace_id: e.trace_id!,
      case_id: e.case_id,
      reason:
        e.judge_verdict === null
          ? "No human review yet (judge not run)"
          : JUDGE_NEEDS_REVIEW.includes(e.judge_verdict)
            ? `Experimental judge verdict ${e.judge_verdict} requires human review`
            : `Judge ${e.judge_verdict} is unvalidated and does not exempt the case from human review`,
    }));
  if (unresolved.length) {
    add(
      "unresolved_required_reviews",
      "INSUFFICIENT_EVIDENCE",
      `${unresolved.length} of ${evals.filter((e) => e.trace_id).length} candidate case(s) still need human review — every candidate case is reviewed while the judge is unvalidated.`,
      unresolved.map((u) => u.case_id),
    );
  }

  // ---- Blocking failures --------------------------------------------------
  const critical = evals.filter((e) => e.critical_failures.length > 0);
  if (critical.length) {
    add(
      "critical_policy_violation",
      "NO_SHIP",
      `Confirmed critical policy violation in ${critical.length} case(s) (validated deterministic checks).`,
      critical.map((e) => e.case_id),
    );
  }
  const stale = evals.filter((e) => e.critical_failures.includes("stale_policy_used") && required_set.case_ids.includes(e.case_id));
  if (stale.length) {
    add("stale_policy_in_required_case", "NO_SHIP", `Stale policy used in ${stale.length} required case(s).`, stale.map((e) => e.case_id));
  }
  if (comparison && comparison.new_critical_regressions.length) {
    add(
      "new_critical_regression",
      "NO_SHIP",
      `New critical regression(s) vs baseline: ${comparison.new_critical_regressions.map((r) => `${r.case_id}:${r.evaluator_id}`).join(", ")}.`,
      [...new Set(comparison.new_critical_regressions.map((r) => r.case_id))],
    );
  }
  const humanCritical = input.candidate_annotations.filter((a) => a.task_outcome === "fail" && a.severity === "critical");
  if (humanCritical.length) {
    add(
      "human_confirmed_critical",
      "NO_SHIP",
      `A human reviewer confirmed a critical failure on ${humanCritical.length} candidate trace(s).`,
      [...new Set(humanCritical.map((a) => a.case_id))],
    );
  }
  const humanOther = input.candidate_annotations.filter((a) => a.task_outcome === "fail" && a.severity !== "critical");
  if (humanOther.length) {
    add(
      "human_confirmed_noncritical",
      "WARNING",
      `Human reviewers marked ${humanOther.length} candidate trace(s) as failed (non-critical). Shown to the approver.`,
      [...new Set(humanOther.map((a) => a.case_id))],
    );
  }
  const complete = !reasons.some((r) => r.code === "required_tests_incomplete" || r.code === "no_candidate_run");
  const rate = summary?.pass_all_rate ?? null;
  if (candidate && complete && rate !== null && rate < PASS_ALL_THRESHOLD) {
    add(
      "pass_all_below_threshold",
      "NO_SHIP",
      `Pass-all ${(rate * 100).toFixed(1)}% is below the ${PASS_ALL_THRESHOLD * 100}% demo threshold.`,
      evals.filter((e) => e.pass_all === false).map((e) => e.case_id),
    );
  }

  // ---- Status -------------------------------------------------------------
  const evaluation_status: GateResult["evaluation_status"] = reasons.some((r) => r.level === "NO_SHIP")
    ? "NO_SHIP"
    : reasons.some((r) => r.level === "INSUFFICIENT_EVIDENCE")
      ? "INSUFFICIENT_EVIDENCE"
      : "ELIGIBLE_FOR_DEMO_APPROVAL";

  const forRun = candidate
    ? input.approvals.filter((a) => a.candidate_run_id === candidate.run.run_id).sort((a, b) => a.created_at.localeCompare(b.created_at))
    : [];
  const latest = forRun[forRun.length - 1] ?? null;
  let approval_state: GateResult["approval_state"] = "none";
  if (latest) {
    if (latest.evidence_snapshot_hash !== input.evidence_snapshot_hash) approval_state = "stale";
    else approval_state = latest.decision === "approved" ? "approved" : "rejected";
  }
  const status: ReleaseStatus =
    evaluation_status === "ELIGIBLE_FOR_DEMO_APPROVAL" && approval_state === "approved" ? "APPROVED_FOR_DEMO" : evaluation_status;

  // ---- Checklist for the UI -----------------------------------------------
  const has = (code: string) => reasons.some((r) => r.code === code);
  const chk = (id: string, label: string, ok: boolean | null, detail: string) =>
    checks.push({ id, label, status: ok === null ? "pending" : ok ? "pass" : "fail", detail });
  chk(
    "candidate_complete",
    `Candidate executed on every case of ${required_set.frozen_set_id}`,
    candidate ? !has("candidate_run_incomplete") && !has("candidate_not_on_required_set") && !has("required_tests_incomplete") : null,
    candidate ? `${summary!.n_with_trace}/${required_set.case_ids.length} cases traced, ${summary!.n_incomplete} incomplete` : "no candidate run",
  );
  chk("frozen_integrity", "Frozen cases unchanged (hash verified)", input.required_set_valid && !has("frozen_set_mismatch"), required_set.content_hash.slice(0, 12));
  chk("live_execution", "Live model execution (not mock)", candidate ? !has("mock_results") : null, candidate ? candidate.run.execution_mode : "—");
  chk("baseline_comparison", "Baseline run on the same frozen set", baseline && candidate ? comparison !== null : null, baseline ? baseline.run.run_id : "no baseline run");
  chk(
    "no_critical",
    "Zero confirmed critical policy violations",
    candidate ? !has("critical_policy_violation") && !has("human_confirmed_critical") : null,
    candidate ? `${critical.length} case(s) with critical failures` : "no candidate run",
  );
  chk("pass_all", `Pass-all ≥ ${PASS_ALL_THRESHOLD * 100}% on validated checks`, rate === null ? null : rate >= PASS_ALL_THRESHOLD, rate === null ? "undefined" : `${(rate * 100).toFixed(1)}%`);
  chk("no_regression", "No new critical regressions vs baseline", comparison ? comparison.new_critical_regressions.length === 0 : null, comparison ? `${comparison.new_critical_regressions.length} new critical regression(s)` : "comparison unavailable");
  chk("review_coverage", `Human-reviewed traces ≥ ${MIN_REVIEWED_TRACES}`, input.reviewed_trace_count >= MIN_REVIEWED_TRACES, `${input.reviewed_trace_count} reviewed`);
  chk("judge_run", "Experimental judge run on every candidate case", candidate ? !has("judge_not_run") : null, candidate ? `${summary!.judge.not_run} not run` : "—");
  chk("reviews_resolved", "Every candidate case reviewed by a human", candidate ? unresolved.length === 0 : null, `${unresolved.length} unresolved`);

  const limitations = [
    "Synthetic merchant scenarios (20 cases) — results describe a prototype test set, not production traffic.",
    "Small sample: pass-all and per-check rates have wide uncertainty and cannot establish production reliability.",
    `LLM judge (${input.judge.version}) is experimental${input.judge.insufficient_validation ? " with insufficient validation data" : ""}; its verdicts (including PASS) never replace human review and do not count toward pass-all.`,
    "Deterministic checks are validated by unit tests against synthetic policy rules; they verify policy compliance, not pricing strategy quality.",
    "This is a demo-release decision. It is not a production certification.",
  ];
  if (summary?.cache_hits) limitations.push(`${summary.cache_hits} candidate trace(s) replayed cached model responses.`);

  return {
    evaluation_status,
    status,
    reasons,
    checks,
    pass_all_rate: rate,
    unresolved_reviews: unresolved,
    approval_state,
    latest_approval: latest,
    limitations,
  };
}

/** Approval may only be recorded when evaluation says the candidate is eligible. */
export function canApprove(gate: GateResult): boolean {
  return gate.evaluation_status === "ELIGIBLE_FOR_DEMO_APPROVAL";
}
