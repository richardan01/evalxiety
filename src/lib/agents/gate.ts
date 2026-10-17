/**
 * Release gate for any agent. Same shape and precedence as the pricing demo's gate
 * (NO_SHIP > INSUFFICIENT_EVIDENCE > ELIGIBLE; APPROVED only with a named human approval of this exact evidence),
 * with the pricing-specific rules replaced by the agent's own checks and thresholds.
 *
 * Starter-kit (example) data behaves like mock output in the pricing demo: failures stay visible, but it can never
 * decide NO SHIP and never makes a candidate eligible.
 */
import type { ReleaseApproval, ReleaseStatus } from "../domain/schemas";
import { compareRuns, summarizeRun, type CaseEvaluation, type RunComparison } from "../metrics/experiments";
import type { AgentCheckDefinition } from "./checks";
import type { AgentAnnotation, AgentRun } from "./schemas";

const JUDGE_NEEDS_REVIEW = ["FAIL", "REQUIRES_REVIEW", "ERROR"];

export interface AgentGateInput {
  agent: { name: string; example: boolean; pass_all_threshold: number; min_reviewed_traces: number; judge_configured: boolean };
  defs: AgentCheckDefinition[];
  /** Every case in cases.jsonl (the gate requires a trace for each, held-out included). */
  all_case_ids: string[];
  /** exists/revealed: are there held-out cases still locked; moved_to_dev_without_reveal: cases that were held out in an
   * earlier frozen version and are now dev, without ever being revealed (a way around the lock). */
  heldout: {
    exists: boolean;
    revealed: boolean;
    moved_to_dev_without_reveal: string[];
    /** Never-revealed held-out cases that are gone from cases.jsonl. */
    removed_without_reveal?: string[];
    /** Held-out content some run traced before it was revealed. */
    used_before_reveal?: string[];
  };
  /** matches_expected checks that can't apply to some cases because their `expected` lacks the field (typo?). */
  check_gaps?: Array<{ evaluator_id: string; field: string; case_ids: string[] }>;
  /** Hash of the current cases and of the latest frozen version (null = never frozen). */
  current_cases_hash: string;
  latest_frozen_hash: string | null;
  candidate: { run: AgentRun; evals: CaseEvaluation[] } | null;
  baseline: { run: AgentRun; evals: CaseEvaluation[] } | null;
  reviewed_trace_count: number;
  candidate_annotations: AgentAnnotation[];
  /** calibrated = enough human labels per class to report TPR/TNR. It never exempts a case from human review. */
  judge: { version: string | null; calibrated: boolean };
  approvals: ReleaseApproval[];
  evidence_snapshot_hash: string;
}

export type ReasonLevel = "NO_SHIP" | "INSUFFICIENT_EVIDENCE" | "WARNING";
export interface GateReason { code: string; level: ReasonLevel; message: string; case_ids: string[] }
export interface GateCheck { id: string; label: string; status: "pass" | "fail" | "pending"; detail: string }

export interface AgentGateResult {
  evaluation_status: Exclude<ReleaseStatus, "APPROVED_FOR_DEMO">;
  status: ReleaseStatus;
  reasons: GateReason[];
  checks: GateCheck[];
  pass_all_rate: number | null;
  comparison: RunComparison | null;
  unresolved_reviews: Array<{ trace_id: string; case_id: string; reason: string }>;
  approval_state: "none" | "approved" | "rejected" | "stale";
  latest_approval: ReleaseApproval | null;
  /** The single most useful thing to do next, in plain words. */
  next_step: string;
  limitations: string[];
}

export function evaluateAgentGate(input: AgentGateInput): AgentGateResult {
  const reasons: GateReason[] = [];
  const add = (code: string, level: ReasonLevel, message: string, case_ids: string[] = []) => reasons.push({ code, level, message, case_ids });
  const { candidate, baseline, defs } = input;
  const evals = candidate?.evals ?? [];
  const summary = candidate ? summarizeRun(evals, defs) : null;
  const has = (code: string) => reasons.some((r) => r.code === code);

  // ---- Setup -----------------------------------------------------------------
  if (defs.length === 0) add("no_checks", "INSUFFICIENT_EVIDENCE", "No code checks are configured in agent.json, so nothing objective is checked.");
  if (input.latest_frozen_hash !== null && input.latest_frozen_hash !== input.current_cases_hash) {
    add("cases_changed", "INSUFFICIENT_EVIDENCE", "cases.jsonl changed since the last freeze. Freeze a new version and re-run.");
  }
  if (input.heldout.exists && !input.heldout.revealed) {
    add("heldout_not_revealed", "INSUFFICIENT_EVIDENCE", "Held-out cases are still locked. The final check needs a run on every case, held-out included: reveal them when you are done tuning.");
  }
  if (input.heldout.moved_to_dev_without_reveal.length) {
    add(
      "heldout_moved_to_dev",
      "INSUFFICIENT_EVIDENCE",
      "Case(s) that were held out in an earlier frozen version are now dev (same id or same content) and were never revealed. They are locked: move them back to \"split\": \"heldout\" and freeze a new version.",
      input.heldout.moved_to_dev_without_reveal,
    );
  }
  if (input.heldout.removed_without_reveal?.length) {
    // Deleting some held-out cases shrinks the final check (a warning for the approver); deleting all of them skips it.
    const allGone = !input.heldout.exists;
    add(
      "heldout_removed",
      allGone ? "INSUFFICIENT_EVIDENCE" : "WARNING",
      allGone
        ? "Every held-out case was deleted from cases.jsonl without being revealed, so there is no final check. Restore them, or reveal them before removing any."
        : "Held-out case(s) were deleted from cases.jsonl without ever being revealed, so the final check covers fewer cases. Shown to the approver.",
      input.heldout.removed_without_reveal,
    );
  }
  for (const gap of input.check_gaps ?? []) {
    add(
      `expected_field_missing:${gap.evaluator_id}`,
      "WARNING",
      `Check "${gap.evaluator_id}" can't apply to ${gap.case_ids.length} case(s) whose "expected" has no "${gap.field}" (typo in cases.jsonl?), so it reports NOT_APPLICABLE there.`,
      gap.case_ids,
    );
  }
  if (input.heldout.used_before_reveal?.length) {
    add(
      "heldout_used_before_reveal",
      "INSUFFICIENT_EVIDENCE",
      "These held-out cases were already run before their reveal (for example as dev cases before being held out), so they no longer test anything untouched. Give them fresh input (new questions), then freeze a new version.",
      input.heldout.used_before_reveal,
    );
  }

  // ---- Candidate completeness -------------------------------------------------
  if (!candidate) {
    add("no_candidate_run", "INSUFFICIENT_EVIDENCE", "No candidate run selected.");
  } else {
    if (candidate.run.status !== "completed") add("candidate_run_incomplete", "INSUFFICIENT_EVIDENCE", `Candidate run is ${candidate.run.status}.`);
    if (candidate.run.frozen_hash !== input.current_cases_hash) {
      add("candidate_stale_cases", "INSUFFICIENT_EVIDENCE", `Candidate ran on frozen cases v${candidate.run.frozen_version}, which no longer match cases.jsonl.`);
    }
    const missing = input.all_case_ids.filter((id) => !evals.some((e) => e.case_id === id && e.trace_id));
    const errored = evals.filter((e) => e.incomplete && e.trace_id).map((e) => e.case_id);
    if (missing.length || errored.length) {
      add("required_tests_incomplete", "INSUFFICIENT_EVIDENCE", `Candidate is incomplete: ${missing.length} case(s) without a trace, ${errored.length} with errors.`, [...missing, ...errored]);
    }
    if (input.agent.judge_configured) {
      // Errored or empty traces can't be judged; they are reported as incomplete instead.
      const notJudged = evals.filter((e) => e.trace_id && !e.execution_error && e.judge_verdict === null).map((e) => e.case_id);
      if (notJudged.length) add("judge_not_run", "INSUFFICIENT_EVIDENCE", `The judge has not been run on ${notJudged.length} candidate case(s).`, notJudged);
    }
  }
  const exampleData = input.agent.example || candidate?.run.data_origin === "example" || baseline?.run.data_origin === "example";
  if (exampleData) add("example_data", "INSUFFICIENT_EVIDENCE", "This is starter-kit example data. It shows the workflow; it is not evidence about a real agent.");

  // ---- Baseline -----------------------------------------------------------------
  let comparison: RunComparison | null = null;
  let baselineUsable = false;
  if (!baseline) {
    add("no_baseline", "INSUFFICIENT_EVIDENCE", "No baseline run, so regressions can't be checked. The baseline is the version you ship today.");
  } else if (candidate) {
    if (baseline.run.run_id === candidate.run.run_id) {
      add("baseline_is_candidate", "INSUFFICIENT_EVIDENCE", "Baseline and candidate are the same run.");
    } else if (baseline.run.frozen_hash !== candidate.run.frozen_hash) {
      add("baseline_set_mismatch", "INSUFFICIENT_EVIDENCE", `Baseline (cases v${baseline.run.frozen_version}) and candidate (v${candidate.run.frozen_version}) ran on different cases.`);
    } else {
      const ids = new Set(evals.map((e) => e.case_id));
      const b = baseline.evals.filter((e) => ids.has(e.case_id));
      const bad = b.filter((e) => !e.trace_id || e.incomplete).map((e) => e.case_id);
      if (baseline.run.status !== "completed" || bad.length) {
        // A baseline without evidence can't show regressions: an incomplete pair is never counted as one.
        add(
          "baseline_incomplete",
          "INSUFFICIENT_EVIDENCE",
          `Baseline run is ${baseline.run.status}${bad.length ? ` with ${bad.length} case(s) missing or errored` : ""}, so regressions on those cases can't be checked.`,
          bad,
        );
      }
      if (b.length === evals.length && b.length > 0) {
        comparison = compareRuns(b, evals, defs);
        baselineUsable = baseline.run.status === "completed" && bad.length === 0;
      } else {
        add("baseline_cases_differ", "INSUFFICIENT_EVIDENCE", "Baseline and candidate cover different cases (one includes held-out cases the other doesn't). Re-run the baseline after the reveal.");
      }
      if (baseline.run.agent_version.trim().toLowerCase() === candidate.run.agent_version.trim().toLowerCase()) {
        add("same_version", "WARNING", `Baseline and candidate are both labelled "${candidate.run.agent_version}". Check you are comparing the versions you mean to.`);
      }
    }
  }

  // ---- Human review -------------------------------------------------------------
  if (input.reviewed_trace_count < input.agent.min_reviewed_traces) {
    add("insufficient_human_review", "INSUFFICIENT_EVIDENCE", `${input.reviewed_trace_count} trace(s) have human review; error analysis needs at least ${input.agent.min_reviewed_traces}.`);
  }
  const annotated = new Set(input.candidate_annotations.map((a) => a.trace_id));
  const assessed = new Set(input.candidate_annotations.filter((a) => a.judge_label !== "not_assessed").map((a) => a.trace_id));
  // Every candidate case needs a human look. A judge PASS can miss a failure just as a FAIL can be wrong, and "enough
  // labels" is a sample-size convention, not proof the judge is good — so the judge never exempts a case.
  const unresolved = evals
    .filter((e) => e.trace_id)
    .flatMap((e) => {
      const tid = e.trace_id!;
      const flagged = e.judge_verdict !== null && JUDGE_NEEDS_REVIEW.includes(e.judge_verdict);
      if (!annotated.has(tid)) return [{ trace_id: tid, case_id: e.case_id, reason: "No human review yet" }];
      if (flagged && !assessed.has(tid)) {
        return [{ trace_id: tid, case_id: e.case_id, reason: `Judge said ${e.judge_verdict}; the reviewer hasn't answered the judge's question on this trace` }];
      }
      return [];
    });
  const noReview = unresolved.filter((u) => u.reason === "No human review yet");
  const judgeUnanswered = unresolved.filter((u) => u.reason !== "No human review yet");
  if (noReview.length) {
    add(
      "unresolved_required_reviews",
      "INSUFFICIENT_EVIDENCE",
      `${noReview.length} candidate case(s) still need human review (every candidate case gets a human look).`,
      noReview.map((u) => u.case_id),
    );
  }
  if (judgeUnanswered.length) {
    add(
      "judge_flags_unanswered",
      "INSUFFICIENT_EVIDENCE",
      `The judge flagged ${judgeUnanswered.length} reviewed case(s); open each one and answer the judge's question so the flag is resolved.`,
      judgeUnanswered.map((u) => u.case_id),
    );
  }


  // ---- Blocking failures --------------------------------------------------------
  const critical = evals.filter((e) => e.critical_failures.length > 0);
  if (critical.length) add("critical_check_failed", "NO_SHIP", `A critical code check failed in ${critical.length} case(s).`, critical.map((e) => e.case_id));
  const blockingIds = new Set(defs.filter((d) => d.blocking && d.severity !== "critical").map((d) => d.evaluator_id));
  const blockingFails = evals.filter((e) => e.results.some((r) => r.outcome === "FAIL" && blockingIds.has(r.evaluator_id)));
  if (blockingFails.length) add("blocking_check_failed", "NO_SHIP", `A blocking code check failed in ${blockingFails.length} case(s).`, blockingFails.map((e) => e.case_id));
  if (comparison?.new_critical_regressions.length) {
    add(
      "new_critical_regression",
      "NO_SHIP",
      `New critical regression(s) vs baseline: ${comparison.new_critical_regressions.map((r) => `${r.case_id}:${r.evaluator_id}`).join(", ")}.`,
      [...new Set(comparison.new_critical_regressions.map((r) => r.case_id))],
    );
  }
  const otherRegressions = comparison?.new_regressions.filter((r) => r.severity !== "critical") ?? [];
  if (otherRegressions.length) {
    add("new_regression", "WARNING", `Check(s) that passed on the baseline now fail: ${otherRegressions.map((r) => `${r.case_id}:${r.evaluator_id}`).join(", ")}.`, [...new Set(otherRegressions.map((r) => r.case_id))]);
  }
  const humanCritical = input.candidate_annotations.filter((a) => a.task_outcome === "fail" && a.severity === "critical");
  if (humanCritical.length) add("human_confirmed_critical", "NO_SHIP", `A reviewer marked ${humanCritical.length} candidate trace(s) as a critical failure.`, [...new Set(humanCritical.map((a) => a.case_id))]);
  const humanOther = input.candidate_annotations.filter((a) => a.task_outcome === "fail" && a.severity !== "critical");
  if (humanOther.length) add("human_confirmed_noncritical", "WARNING", `Reviewers marked ${humanOther.length} candidate trace(s) as failed (not critical). Shown to the approver.`, [...new Set(humanOther.map((a) => a.case_id))]);
  const judgeFound = input.candidate_annotations.filter((a) => a.judge_label === "present");
  if (judgeFound.length) add("human_found_judge_failure", "WARNING", `A reviewer found the judge's failure on ${judgeFound.length} candidate trace(s).`, [...new Set(judgeFound.map((a) => a.case_id))]);

  const rate = summary?.pass_all_rate ?? null;
  const complete = candidate && !has("required_tests_incomplete");
  if (complete && rate !== null && defs.length && rate < input.agent.pass_all_threshold) {
    // pass_all === null (every check NOT_APPLICABLE) can't be shown to pass, so it counts against the rate too.
    add("pass_all_below_threshold", "NO_SHIP", `${(rate * 100).toFixed(1)}% of cases pass every code check; the bar is ${input.agent.pass_all_threshold * 100}%.`, evals.filter((e) => e.pass_all !== true).map((e) => e.case_id));
  }

  if (exampleData) {
    for (const r of reasons) {
      if (r.level === "NO_SHIP") {
        r.level = "WARNING";
        r.message = `(example data — not evidence) ${r.message}`;
      }
    }
  }

  // ---- Status -------------------------------------------------------------------
  const evaluation_status: AgentGateResult["evaluation_status"] = reasons.some((r) => r.level === "NO_SHIP")
    ? "NO_SHIP"
    : reasons.some((r) => r.level === "INSUFFICIENT_EVIDENCE")
      ? "INSUFFICIENT_EVIDENCE"
      : "ELIGIBLE_FOR_DEMO_APPROVAL";
  const forRun = candidate ? input.approvals.filter((a) => a.candidate_run_id === candidate.run.run_id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [];
  const latest = forRun[forRun.length - 1] ?? null;
  let approval_state: AgentGateResult["approval_state"] = "none";
  if (latest) approval_state = latest.evidence_snapshot_hash !== input.evidence_snapshot_hash ? "stale" : latest.decision === "approved" ? "approved" : "rejected";
  const status: ReleaseStatus = evaluation_status === "ELIGIBLE_FOR_DEMO_APPROVAL" && approval_state === "approved" ? "APPROVED_FOR_DEMO" : evaluation_status;

  // ---- Checklist ------------------------------------------------------------------
  const checks: GateCheck[] = [];
  const chk = (id: string, label: string, ok: boolean | null, detail: string) => checks.push({ id, label, status: ok === null ? "pending" : ok ? "pass" : "fail", detail });
  chk("candidate_complete", "Candidate has a trace for every case", candidate ? !has("required_tests_incomplete") && !has("candidate_run_incomplete") : null, candidate ? `${summary!.n_with_trace}/${input.all_case_ids.length} cases traced` : "no candidate run");
  chk("cases_frozen", "Cases unchanged since the run (hash verified)", candidate ? !has("candidate_stale_cases") && !has("cases_changed") : null, input.current_cases_hash.slice(0, 12));
  const heldoutBroken = has("heldout_moved_to_dev") || has("heldout_used_before_reveal") || has("heldout_removed");
  chk(
    "heldout",
    "Held-out cases intact and revealed for the final check",
    heldoutBroken ? false : input.heldout.exists ? input.heldout.revealed : true,
    heldoutBroken ? (has("heldout_removed") && !has("heldout_moved_to_dev") && !has("heldout_used_before_reveal") ? "held-out case(s) deleted unrevealed" : "held-out lock bypassed") : input.heldout.exists ? (input.heldout.revealed ? "revealed" : "locked") : "no held-out cases",
  );
  chk("real_data", "Real agent output (not example data)", !exampleData, exampleData ? "example data" : candidate ? candidate.run.execution_mode : "—");
  chk("baseline", "Complete baseline on the same cases", baseline && candidate ? baselineUsable : null, baseline ? baseline.run.agent_version : "no baseline run");
  chk("no_critical", "No critical failures (checks or reviewers)", candidate ? !has("critical_check_failed") && !has("human_confirmed_critical") : null, `${critical.length + humanCritical.length} found`);
  chk("pass_all", `≥ ${input.agent.pass_all_threshold * 100}% of cases pass every code check`, rate === null ? null : rate >= input.agent.pass_all_threshold, rate === null ? "undefined" : `${(rate * 100).toFixed(1)}%`);
  chk("no_regression", "No new critical regressions vs baseline", comparison ? comparison.new_critical_regressions.length === 0 : null, comparison ? `${comparison.fixed.length} fixed, ${comparison.regressed.length} regressed` : "comparison unavailable");
  chk("review_coverage", `≥ ${input.agent.min_reviewed_traces} traces reviewed by a human`, input.reviewed_trace_count >= input.agent.min_reviewed_traces, `${input.reviewed_trace_count} reviewed`);
  if (input.agent.judge_configured) chk("judge_run", "Judge run on every candidate case", candidate ? !has("judge_not_run") : null, candidate ? `${summary!.judge.not_run} not run` : "—");
  chk("reviews_resolved", "Every candidate case reviewed by a human", candidate ? unresolved.length === 0 : null, `${unresolved.length} open`);

  const next_step = nextStep(reasons, input, approval_state);
  const limitations = [
    `${input.all_case_ids.length} case(s) — results describe this test set, not all production traffic. Small sets have wide uncertainty.`,
    input.agent.judge_configured
      ? `The LLM judge (${input.judge.version ?? "not run"}) is experimental${input.judge.calibrated ? "" : " and has fewer than 30 human labels per class"}; it never counts toward pass-all or replaces a human review.`
      : "No LLM judge is configured; subjective failures rely on human review alone.",
    "Custom checks are the agent owner's code; force each one to FAIL once to prove it can.",
    "This is a release decision for this evidence, not a certification.",
  ];

  return { evaluation_status, status, reasons, checks, pass_all_rate: rate, comparison, unresolved_reviews: unresolved, approval_state, latest_approval: latest, next_step, limitations };
}

function nextStep(reasons: GateReason[], input: AgentGateInput, approval: AgentGateResult["approval_state"]): string {
  const has = (c: string) => reasons.some((r) => r.code === c);
  const reviewOpen = has("insufficient_human_review") || has("unresolved_required_reviews");
  if (has("example_data")) {
    if (!input.candidate && !input.baseline) return "Starter kit: import traces.v1-baseline.jsonl as v1 (Add a run → Import a file).";
    if (!input.candidate) return "Now import traces.v2-candidate.jsonl as v2.";
    return "This is the starter kit: compare the runs and try reviewing a trace. To evaluate your own agent, copy the blank template: cp -r agents/_template agents/<your-agent>.";
  }
  if (has("no_checks") && !reasons.some((r) => r.level === "NO_SHIP")) return "Add at least one code check to agent.json.";
  if (has("heldout_moved_to_dev")) return "A never-revealed held-out case is now a dev case: move it back to \"split\": \"heldout\" and freeze a new version.";
  if (has("heldout_used_before_reveal")) return "Some held-out cases were already run before their reveal: give them fresh input, then freeze a new version.";
  if (has("cases_changed")) return "Your cases changed: freeze a new version, then re-run both versions.";
  if (!input.candidate && !input.baseline) return "Import (or run) the version you ship today; it becomes the baseline.";
  if (has("no_candidate_run")) return "Import (or run) your change as the candidate.";
  if (has("candidate_run_incomplete")) return "The candidate run is still running or failed: wait for it, or run it again.";
  if (has("candidate_stale_cases")) return "The candidate ran on an older version of the cases: run or import it again.";
  if (reasons.some((r) => r.level === "NO_SHIP")) return "Fix the failing cases (see Why), then run the new version as a candidate again.";
  if (has("no_baseline")) return "Pick a baseline run, or import (or run) the version you ship today.";
  if (has("baseline_is_candidate")) return "Pick a different run as the baseline.";
  if (has("baseline_set_mismatch")) return "The baseline ran on a different version of the cases: re-run it on the current cases.";
  if (has("baseline_cases_differ")) return "The baseline doesn't cover the same cases (held-out ones, after the reveal): re-run it on every case.";
  if (has("required_tests_incomplete")) {
    return input.heldout.exists && input.heldout.revealed
      ? "Some candidate cases have no trace or errored. After a reveal, re-run both versions on every case."
      : "Some candidate cases have no trace or errored: re-run or re-import them.";
  }
  if (has("baseline_incomplete")) return "Your baseline has missing or errored cases: re-run or re-import it.";
  if (reviewOpen && has("heldout_not_revealed")) {
    return "Review enough traces to see what fails and whether your change helped (Start reviewing). When you're done tuning, reveal the held-out cases and re-run both versions: the gate needs every trace of that final run reviewed.";
  }
  if (reviewOpen) return "Review traces: click Start reviewing and label each candidate trace pass or fail.";
  if (has("judge_flags_unanswered")) return "Answer the judge's question on the traces it flagged (listed under Still to review).";
  if (has("judge_not_run")) return "Run the judge on the candidate (real traces need MOCK_MODE=false and ANTHROPIC_API_KEY in .env.local).";
  if (has("heldout_not_revealed")) return "When you're done tuning, reveal the held-out cases and re-run both versions on every case.";
  if (reasons.some((r) => r.level === "INSUFFICIENT_EVIDENCE")) return "Resolve the reasons listed under Why.";
  if (approval === "approved") return "Approved by a named human for this exact evidence.";
  if (approval === "rejected") return "A named human rejected this release. Change the agent and run a new candidate.";
  return "Evidence is complete. A named human can approve or reject this release.";
}
