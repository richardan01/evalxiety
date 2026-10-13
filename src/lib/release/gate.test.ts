import { describe, expect, it } from "vitest";
import { canApprove, evaluateReleaseGate, MIN_REVIEWED_TRACES, type GateInput } from "./gate";
import { compareRuns, evaluateCase, passAll, summarizeRun, type CaseEvaluation } from "../metrics/experiments";
import { makeTrace, withPrice } from "../testing/fixtures";
import { getScenario } from "../domain/scenarios";
import { getFrozenSet } from "../experiments/frozen";
import type { DeterministicResult, ExperimentRun, JudgeVerdict, ReleaseApproval } from "../domain/schemas";

const FULL = getFrozenSet("FROZEN-FULL-v1")!;

/** Case that passes every objective check: counter at a compliant price with correct approvals. */
function passingEval(caseId: string, mode: "live" | "mock" = "live", judge: JudgeVerdict = "PASS"): CaseEvaluation {
  const s = getScenario(caseId)!;
  // Use the requested price when compliant; otherwise counter at 3.00% + $0.30 (above every floor in these cases).
  let trace = makeTrace(caseId, undefined, { execution_mode: mode });
  if (evaluateCase(caseId, trace).pass_all !== true) {
    trace = makeTrace(caseId, withPrice(s, { rate_bps: 300, per_txn_fee_usd: 0.3 }), { execution_mode: mode });
  }
  const e = evaluateCase(caseId, trace, judge);
  expect(e.pass_all, `fixture for ${caseId} should pass`).toBe(true);
  return e;
}

function staleEval(caseId: string): CaseEvaluation {
  const t = makeTrace(caseId, (r) => ({ ...r, selected_policy_id: "PRC-2026.1" }));
  return evaluateCase(caseId, t, "PASS");
}

function run(id: string, configId: string, evals: CaseEvaluation[], mode: "live" | "mock" = "live"): ExperimentRun {
  return {
    run_id: id,
    created_at: "2026-10-13T00:00:00.000Z",
    completed_at: "2026-10-13T00:10:00.000Z",
    agent_config_id: configId,
    frozen_set_id: FULL.frozen_set_id,
    frozen_set_hash: FULL.content_hash,
    case_ids: FULL.case_ids,
    execution_mode: mode,
    status: "completed",
    trace_ids: Object.fromEntries(evals.map((e) => [e.case_id, e.trace_id!])),
    notes: null,
  };
}

/** Human-review every candidate case as it stands now (call after swapping evals). */
function reviewAll(input: GateInput): GateInput["candidate_annotations"] {
  return input.candidate!.evals.map((e) => ({ trace_id: e.trace_id!, case_id: e.case_id, task_outcome: "pass" as const, severity: null, reviewer: "rich" }));
}

function eligibleInput(overrides: Partial<GateInput> = {}): GateInput {
  const cand = FULL.case_ids.map((id) => passingEval(id));
  const base = FULL.case_ids.map((id) => passingEval(id));
  return {
    required_set: FULL,
    required_set_valid: true,
    candidate: { run: run("run_c", "pricing-agent@corrected-v2", cand), evals: cand },
    baseline: { run: run("run_b", "pricing-agent@baseline-v1", base), evals: base },
    reviewed_trace_count: MIN_REVIEWED_TRACES,
    // every candidate case human-reviewed (required while the judge is unvalidated)
    candidate_annotations: cand.map((e) => ({ trace_id: e.trace_id!, case_id: e.case_id, task_outcome: "pass" as const, severity: null, reviewer: "rich" })),
    judge: { version: "upj-v1", insufficient_validation: true },
    approvals: [],
    evidence_snapshot_hash: "hash-1",
    ...overrides,
  };
}

describe("pass-all", () => {
  const r = (outcome: DeterministicResult["outcome"]): DeterministicResult => ({
    evaluator_id: "x",
    evaluator_version: "1",
    trace_id: "t",
    case_id: "c",
    outcome,
    severity: "major",
    summary: "",
    details: {},
  });
  it("is true only when every applicable check passes", () => {
    expect(passAll([r("PASS"), r("PASS")])).toBe(true);
    expect(passAll([r("PASS"), r("NOT_APPLICABLE")])).toBe(true);
    expect(passAll([r("PASS"), r("FAIL")])).toBe(false);
    expect(passAll([r("PASS"), r("ERROR")])).toBe(false);
  });
  it("is undefined when nothing is applicable", () => {
    expect(passAll([])).toBeNull();
    expect(passAll([r("NOT_APPLICABLE")])).toBeNull();
  });
  it("run pass-all rate counts cases without traces as not passing and is null for zero cases", () => {
    const evals = [passingEval("C02"), evaluateCase("C01", null)];
    expect(summarizeRun(evals).pass_all_rate).toBe(0.5);
    expect(summarizeRun([]).pass_all_rate).toBeNull();
  });
  it("judge verdicts are tallied separately and never affect pass-all", () => {
    const e = passingEval("C02", "live", "FAIL");
    const s = summarizeRun([e]);
    expect(s.pass_all_rate).toBe(1);
    expect(s.judge.FAIL).toBe(1);
  });
});

describe("paired comparison", () => {
  it("an execution error is incomplete evidence, not a regression", () => {
    const base = [passingEval("C02")];
    const errored = evaluateCase("C02", makeTrace("C02", () => null), "PASS");
    const cmp = compareRuns(base, [errored]);
    expect(cmp.new_critical_regressions).toEqual([]);
    expect(cmp.new_regressions).toEqual([]);
    expect(cmp.incomplete).toEqual(["C02"]);
  });

  it("identifies fixed cases, regressions and new critical regressions", () => {
    const base = [staleEval("C01"), passingEval("C02")];
    const cand = [passingEval("C01"), staleEval("C02")];
    const cmp = compareRuns(base, cand);
    expect(cmp.fixed).toEqual(["C01"]);
    expect(cmp.regressed).toEqual(["C02"]);
    expect(cmp.new_critical_regressions).toEqual([{ case_id: "C02", evaluator_id: "stale_policy_used" }]);
  });
  it("refuses to compare runs over different cases", () => {
    expect(() => compareRuns([passingEval("C01")], [passingEval("C02")])).toThrow(/same frozen set/);
  });
});

describe("release gate", () => {
  it("is ELIGIBLE when objective checks pass, pass-all ≥ 90%, no regressions, reviews resolved", () => {
    const g = evaluateReleaseGate(eligibleInput());
    expect(g.reasons.filter((r) => r.level !== "WARNING")).toEqual([]);
    expect(g.evaluation_status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
    expect(g.status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
    expect(canApprove(g)).toBe(true);
  });

  it("NO SHIP on any confirmed stale-policy failure in a required case", () => {
    const input = eligibleInput();
    input.candidate!.evals[0] = staleEval(input.candidate!.evals[0].case_id);
    const g = evaluateReleaseGate(input);
    expect(g.evaluation_status).toBe("NO_SHIP");
    expect(g.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["critical_policy_violation", "stale_policy_in_required_case"]));
    expect(canApprove(g)).toBe(false);
  });

  it("NO SHIP on a new critical regression vs baseline", () => {
    const input = eligibleInput();
    input.candidate!.evals[3] = staleEval(input.candidate!.evals[3].case_id);
    const g = evaluateReleaseGate(input);
    expect(g.reasons.map((r) => r.code)).toContain("new_critical_regression");
  });

  it("NO SHIP when a human confirms a critical failure on a candidate trace", () => {
    const input = eligibleInput();
    const e = input.candidate!.evals[0];
    input.candidate_annotations = [{ trace_id: e.trace_id!, case_id: e.case_id, task_outcome: "fail", severity: "critical", reviewer: "rich" }];
    expect(evaluateReleaseGate(input).evaluation_status).toBe("NO_SHIP");
  });

  it("NO SHIP when pass-all is below 90% even without critical failures", () => {
    const input = eligibleInput();
    for (let i = 0; i < 3; i++) {
      const id = input.candidate!.evals[i].case_id;
      const t = makeTrace(id, (r) => ({ ...r, unit_economics: { ...r.unit_economics, gross_margin_pct: r.unit_economics.gross_margin_pct + 1 } }));
      input.candidate!.evals[i] = evaluateCase(id, t, "PASS");
    }
    const g = evaluateReleaseGate(input);
    expect(g.pass_all_rate).toBeCloseTo(17 / 20);
    expect(g.reasons.map((r) => r.code)).toContain("pass_all_below_threshold");
    expect(g.evaluation_status).toBe("NO_SHIP");
  });

  it("boundary: exactly 90% pass-all with no critical failures is eligible", () => {
    const input = eligibleInput();
    for (let i = 0; i < 2; i++) {
      const id = input.candidate!.evals[i].case_id;
      const t = makeTrace(id, (r) => ({ ...r, unit_economics: { ...r.unit_economics, gross_margin_pct: r.unit_economics.gross_margin_pct + 1 } }));
      input.candidate!.evals[i] = evaluateCase(id, t, "PASS");
      input.baseline!.evals[i] = evaluateCase(id, t, "PASS"); // same failure in baseline: not a new regression
    }
    input.candidate_annotations = reviewAll(input);
    const g = evaluateReleaseGate(input);
    expect(g.pass_all_rate).toBe(0.9);
    expect(g.evaluation_status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
  });

  it("INSUFFICIENT EVIDENCE when results are mock", () => {
    const cand = FULL.case_ids.map((id) => passingEval(id, "mock"));
    const base = FULL.case_ids.map((id) => passingEval(id, "mock"));
    const g = evaluateReleaseGate(
      eligibleInput({
        candidate: { run: run("run_c", "c", cand, "mock"), evals: cand },
        baseline: { run: run("run_b", "b", base, "mock"), evals: base },
      }),
    );
    expect(g.evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
    expect(g.reasons.map((r) => r.code)).toContain("mock_results");
  });

  it("INSUFFICIENT EVIDENCE when required tests are incomplete", () => {
    const input = eligibleInput();
    input.candidate!.evals[5] = evaluateCase(input.candidate!.evals[5].case_id, null);
    const g = evaluateReleaseGate(input);
    expect(g.evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
    expect(g.reasons.map((r) => r.code)).toContain("required_tests_incomplete");
  });

  it("INSUFFICIENT EVIDENCE when human review coverage is below the minimum", () => {
    const g = evaluateReleaseGate(eligibleInput({ reviewed_trace_count: MIN_REVIEWED_TRACES - 1 }));
    expect(g.reasons.map((r) => r.code)).toContain("insufficient_human_review");
    expect(g.evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("INSUFFICIENT EVIDENCE while judge-flagged cases await human review; resolved once annotated", () => {
    const input = eligibleInput();
    const e = passingEval(input.candidate!.evals[0].case_id, "live", "REQUIRES_REVIEW");
    input.candidate!.evals[0] = e;
    const reviewed = reviewAll(input);
    input.candidate_annotations = reviewed.filter((a) => a.trace_id !== e.trace_id);
    const g = evaluateReleaseGate(input);
    expect(g.evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
    expect(g.unresolved_reviews).toHaveLength(1);
    // A label that skips the judge's question does not resolve a judge flag...
    input.candidate_annotations = reviewed;
    expect(evaluateReleaseGate(input).evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
    // ...answering it does.
    input.candidate_annotations = reviewed.map((a) => (a.trace_id === e.trace_id ? { ...a, unsupported_justification_label: "absent" as const } : a));
    expect(evaluateReleaseGate(input).evaluation_status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
  });

  it("mock results never produce NO SHIP — failures in mock output are shown as warnings only", () => {
    const cand = FULL.case_ids.map((id) => passingEval(id, "mock"));
    const base = FULL.case_ids.map((id) => passingEval(id, "mock"));
    cand[0] = evaluateCase(cand[0].case_id, makeTrace(cand[0].case_id, (r) => ({ ...r, selected_policy_id: "PRC-2026.1" }), { execution_mode: "mock" }), "PASS");
    const input = eligibleInput({
      candidate: { run: run("run_c", "c", cand, "mock"), evals: cand },
      baseline: { run: run("run_b", "b", base, "mock"), evals: base },
    });
    const g = evaluateReleaseGate(input);
    expect(g.evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
    const crit = g.reasons.find((r) => r.code === "critical_policy_violation")!;
    expect(crit.level).toBe("WARNING");
    expect(crit.message).toMatch(/mock — not evidence/);
  });

  it("a human-found unsupported claim is surfaced to the approver", () => {
    const input = eligibleInput();
    input.candidate_annotations = reviewAll(input).map((a, i) => (i === 0 ? { ...a, unsupported_justification_label: "present" as const } : a));
    const g = evaluateReleaseGate(input);
    expect(g.reasons.map((r) => r.code)).toContain("human_found_unsupported_claim");
  });

  it("a judge PASS does not exempt a case from human review", () => {
    const input = eligibleInput();
    const e = input.candidate!.evals[0];
    expect(e.judge_verdict).toBe("PASS");
    input.candidate_annotations = input.candidate_annotations.filter((a) => a.trace_id !== e.trace_id);
    const g = evaluateReleaseGate(input);
    expect(g.evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
    expect(g.unresolved_reviews.map((u) => u.case_id)).toEqual([e.case_id]);
    expect(g.unresolved_reviews[0].reason).toMatch(/unvalidated/);
    expect(g.checks.find((c) => c.id === "reviews_resolved")?.status).toBe("fail");
  });

  it("cases the judge never ran on also need human review", () => {
    const input = eligibleInput({ candidate_annotations: [] });
    const g = evaluateReleaseGate(input);
    expect(g.unresolved_reviews).toHaveLength(input.candidate!.evals.length);
    expect(g.evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("INSUFFICIENT EVIDENCE without a baseline (regressions unknowable)", () => {
    expect(evaluateReleaseGate(eligibleInput({ baseline: null })).evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("NO SHIP takes precedence over INSUFFICIENT EVIDENCE", () => {
    const input = eligibleInput({ reviewed_trace_count: 0 });
    input.candidate!.evals[0] = staleEval(input.candidate!.evals[0].case_id);
    expect(evaluateReleaseGate(input).evaluation_status).toBe("NO_SHIP");
  });
});

describe("human approval state", () => {
  const approval = (decision: "approved" | "rejected", hash: string, at = "2026-10-13T01:00:00.000Z"): ReleaseApproval => ({
    approval_id: `a_${at}`,
    approver: "rich",
    decision,
    notes: "",
    candidate_run_id: "run_c",
    baseline_run_id: "run_b",
    evidence_snapshot_hash: hash,
    status_at_approval: "ELIGIBLE_FOR_DEMO_APPROVAL",
    created_at: at,
  });

  it("APPROVED FOR DEMO only when eligible and a human approved this evidence snapshot", () => {
    const g = evaluateReleaseGate(eligibleInput({ approvals: [approval("approved", "hash-1")] }));
    expect(g.status).toBe("APPROVED_FOR_DEMO");
    expect(g.approval_state).toBe("approved");
  });

  it("approval goes stale when the evidence changes", () => {
    const g = evaluateReleaseGate(eligibleInput({ approvals: [approval("approved", "old-hash")], evidence_snapshot_hash: "hash-2" }));
    expect(g.approval_state).toBe("stale");
    expect(g.status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
  });

  it("an approval never upgrades a NO SHIP evaluation", () => {
    const input = eligibleInput({ approvals: [approval("approved", "hash-1")] });
    input.candidate!.evals[0] = staleEval(input.candidate!.evals[0].case_id);
    const g = evaluateReleaseGate(input);
    expect(g.status).toBe("NO_SHIP");
  });

  it("the latest decision wins: a later rejection withdraws approval", () => {
    const g = evaluateReleaseGate(
      eligibleInput({ approvals: [approval("approved", "hash-1", "2026-10-13T01:00:00.000Z"), approval("rejected", "hash-1", "2026-10-13T02:00:00.000Z")] }),
    );
    expect(g.approval_state).toBe("rejected");
    expect(g.status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
  });

  it("approvals for a different candidate run are ignored", () => {
    const a = { ...approval("approved", "hash-1"), candidate_run_id: "other" };
    expect(evaluateReleaseGate(eligibleInput({ approvals: [a] })).approval_state).toBe("none");
  });
});
