/**
 * Unit tests for the any-agent release gate: the eligible and approved paths (so a gate that always said
 * "not enough evidence" would fail here), and the invariants a reviewer found could be bypassed.
 */
import { describe, expect, it } from "vitest";
import type { CaseEvaluation } from "../metrics/experiments";
import type { DeterministicResult } from "../domain/schemas";
import type { AgentCheckDefinition } from "./checks";
import { evaluateAgentGate, type AgentGateInput } from "./gate";
import type { AgentAnnotation, AgentRun } from "./schemas";

const CASES = ["c1", "c2", "c3"];
const DEFS: AgentCheckDefinition[] = [
  { evaluator_id: "safe", type: "regex", version: "v", question: "q", rule: "r", severity: "critical", blocking: false, fix_hint: null, validation: "built_in_tested" },
  { evaluator_id: "short", type: "max_length", version: "v", question: "q", rule: "r", severity: "minor", blocking: false, fix_hint: null, validation: "built_in_tested" },
];

function run(id: string, version: string, over: Partial<AgentRun> = {}): AgentRun {
  return {
    run_id: id,
    agent_id: "bot",
    agent_version: version,
    created_at: "2026-10-17T00:00:00Z",
    completed_at: "2026-10-17T00:01:00Z",
    created_by: "t",
    execution_mode: "imported",
    data_origin: "real",
    frozen_version: 1,
    frozen_hash: "H",
    case_ids: CASES,
    trace_ids: Object.fromEntries(CASES.map((c) => [c, `${id}-${c}`])),
    status: "completed",
    source_hash: null,
    notes: null,
    ...over,
  };
}

function ev(runId: string, caseId: string, outcomes: Record<string, DeterministicResult["outcome"]> = {}, over: Partial<CaseEvaluation> = {}): CaseEvaluation {
  const results: DeterministicResult[] = DEFS.map((d) => ({
    evaluator_id: d.evaluator_id,
    evaluator_version: "v",
    trace_id: `${runId}-${caseId}`,
    case_id: caseId,
    outcome: outcomes[d.evaluator_id] ?? "PASS",
    severity: d.severity,
    summary: "",
    details: {},
  }));
  const failed = results.filter((r) => r.outcome === "FAIL" || r.outcome === "ERROR");
  return {
    case_id: caseId,
    trace_id: `${runId}-${caseId}`,
    execution_mode: "imported",
    execution_error: null,
    results,
    pass_all: results.every((r) => r.outcome === "PASS" || r.outcome === "NOT_APPLICABLE"),
    incomplete: results.some((r) => r.outcome === "ERROR"),
    failed_evaluators: failed.map((r) => r.evaluator_id),
    critical_failures: results.filter((r) => r.outcome === "FAIL" && r.severity === "critical").map((r) => r.evaluator_id),
    judge_verdict: null,
    input_tokens: null,
    output_tokens: null,
    latency_ms: null,
    cost_usd: null,
    cache_hit: false,
    ...over,
  };
}

function ann(runId: string, caseId: string, over: Partial<AgentAnnotation> = {}): AgentAnnotation {
  return {
    annotation_id: `a-${runId}-${caseId}`,
    agent_id: "bot",
    trace_id: `${runId}-${caseId}`,
    case_id: caseId,
    run_id: runId,
    reviewer: "Rich",
    label_source: "human",
    created_at: "2026-10-17T00:02:00Z",
    updated_at: "2026-10-17T00:02:00Z",
    task_outcome: "pass",
    notes: "",
    first_failure: null,
    failure_type: null,
    severity: null,
    judge_label: "absent",
    ...over,
  };
}

function input(over: Partial<AgentGateInput> = {}): AgentGateInput {
  return {
    agent: { name: "Bot", example: false, pass_all_threshold: 0.9, min_reviewed_traces: 3, judge_configured: false },
    defs: DEFS,
    all_case_ids: CASES,
    heldout: { exists: false, revealed: true, moved_to_dev_without_reveal: [] },
    current_cases_hash: "H",
    latest_frozen_hash: "H",
    candidate: { run: run("cand", "v2"), evals: CASES.map((c) => ev("cand", c)) },
    baseline: { run: run("base", "v1"), evals: CASES.map((c) => ev("base", c)) },
    reviewed_trace_count: 3,
    candidate_annotations: CASES.map((c) => ann("cand", c)),
    judge: { version: null, calibrated: false },
    approvals: [],
    evidence_snapshot_hash: "S1",
    ...over,
  };
}

describe("eligible and approved paths", () => {
  it("complete real evidence with no failures is ELIGIBLE", () => {
    const g = evaluateAgentGate(input());
    expect(g.reasons).toEqual([]);
    expect(g.status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
  });

  it("a named approval of this exact evidence makes it APPROVED; changed evidence makes the approval stale", () => {
    const approval = {
      approval_id: "ap1",
      approver: "Rich",
      decision: "approved" as const,
      notes: "",
      candidate_run_id: "cand",
      baseline_run_id: "base",
      evidence_snapshot_hash: "S1",
      status_at_approval: "ELIGIBLE_FOR_DEMO_APPROVAL" as const,
      created_at: "2026-10-17T00:03:00Z",
    };
    expect(evaluateAgentGate(input({ approvals: [approval] })).status).toBe("APPROVED_FOR_DEMO");
    const stale = evaluateAgentGate(input({ approvals: [approval], evidence_snapshot_hash: "S2" }));
    expect(stale.approval_state).toBe("stale");
    expect(stale.status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
  });
});

describe("human review cannot be skipped", () => {
  it("a 'calibrated' judge (enough labels) still does not exempt any candidate case from human review", () => {
    const g = evaluateAgentGate(
      input({
        agent: { name: "Bot", example: false, pass_all_threshold: 0.9, min_reviewed_traces: 3, judge_configured: true },
        candidate: { run: run("cand", "v2"), evals: CASES.map((c) => ev("cand", c, {}, { judge_verdict: "PASS" })) },
        candidate_annotations: [],
        judge: { version: "j1", calibrated: true },
      }),
    );
    expect(g.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(g.unresolved_reviews.map((u) => u.case_id)).toEqual(CASES);
  });
});

describe("baseline must be real evidence", () => {
  it("a failed or empty baseline does not satisfy the baseline requirement", () => {
    const empty = run("base", "v1", { status: "failed", trace_ids: {} });
    const g = evaluateAgentGate(input({ baseline: { run: empty, evals: CASES.map((c) => ({ ...ev("base", c), trace_id: null, results: [], pass_all: null, incomplete: true })) } }));
    expect(g.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(g.reasons.map((r) => r.code)).toContain("baseline_incomplete");
    expect(g.checks.find((c) => c.id === "baseline")!.status).toBe("fail");
  });

  it("a baseline with an errored case is incomplete", () => {
    const evals = CASES.map((c) => ev("base", c, c === "c2" ? { safe: "ERROR" } : {}));
    expect(evaluateAgentGate(input({ baseline: { run: run("base", "v1"), evals } })).reasons.map((r) => r.code)).toContain("baseline_incomplete");
  });

  it("warns when baseline and candidate carry the same version label", () => {
    const g = evaluateAgentGate(input({ baseline: { run: run("base", "v2"), evals: CASES.map((c) => ev("base", c)) } }));
    expect(g.reasons.find((r) => r.code === "same_version")?.level).toBe("WARNING");
  });
});

describe("the alarm fires on real data and is muted on example data", () => {
  it("a critical failure is NO_SHIP", () => {
    const g = evaluateAgentGate(input({ candidate: { run: run("cand", "v2"), evals: CASES.map((c) => ev("cand", c, c === "c3" ? { safe: "FAIL" } : {})) } }));
    expect(g.status).toBe("NO_SHIP");
  });

  it("example data never becomes eligible and never decides NO_SHIP", () => {
    const ok = evaluateAgentGate(input({ agent: { name: "Bot", example: true, pass_all_threshold: 0.9, min_reviewed_traces: 3, judge_configured: false } }));
    expect(ok.status).toBe("INSUFFICIENT_EVIDENCE");
    const bad = evaluateAgentGate(
      input({
        candidate: { run: run("cand", "v2", { data_origin: "example" }), evals: CASES.map((c) => ev("cand", c, { safe: "FAIL" })) },
      }),
    );
    expect(bad.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(bad.reasons.filter((r) => r.level === "NO_SHIP")).toEqual([]);
  });
});

describe("held-out integrity", () => {
  it("a case moved from held-out to dev without a reveal is flagged", () => {
    const g = evaluateAgentGate(input({ heldout: { exists: false, revealed: true, moved_to_dev_without_reveal: ["c3"] } }));
    expect(g.reasons.find((r) => r.code === "heldout_moved_to_dev")).toMatchObject({ level: "INSUFFICIENT_EVIDENCE", case_ids: ["c3"] });
  });
});

describe("next step", () => {
  it("never says the evidence is complete unless the gate is eligible", () => {
    const variants: Array<Partial<AgentGateInput>> = [
      { candidate: { run: run("cand", "v2", { status: "running" }), evals: CASES.map((c) => ev("cand", c)) } },
      { candidate: { run: run("cand", "v2", { frozen_hash: "OLD" }), evals: CASES.map((c) => ev("cand", c)) } },
      { baseline: { run: run("cand", "v2"), evals: CASES.map((c) => ev("cand", c)) } },
      { baseline: { run: run("base", "v1", { frozen_hash: "OTHER" }), evals: CASES.map((c) => ev("base", c)) } },
      { baseline: { run: run("base", "v1"), evals: CASES.slice(0, 2).map((c) => ev("base", c)) } },
      { heldout: { exists: false, revealed: true, moved_to_dev_without_reveal: [], used_before_reveal: ["h9"] } },
    ];
    for (const v of variants) {
      const g = evaluateAgentGate(input(v));
      expect(g.status).not.toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
      expect(g.next_step).not.toMatch(/Evidence is complete/);
    }
    expect(evaluateAgentGate(input()).next_step).toMatch(/Evidence is complete/);
  });

  it("deleting some never-revealed held-out cases is a warning for the approver; deleting all of them blocks", () => {
    const some = evaluateAgentGate(input({ heldout: { exists: true, revealed: true, moved_to_dev_without_reveal: [], removed_without_reveal: ["h9"] } }));
    expect(some.reasons.find((r) => r.code === "heldout_removed")!.level).toBe("WARNING");
    expect(some.status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
    expect(some.checks.find((c) => c.id === "heldout")!.status).toBe("fail");
    const all = evaluateAgentGate(input({ heldout: { exists: false, revealed: true, moved_to_dev_without_reveal: [], removed_without_reveal: ["h1", "h2"] } }));
    expect(all.reasons.find((r) => r.code === "heldout_removed")!.level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("NO_SHIP comes before baseline housekeeping, and the fallback knows about approvals", () => {
    const crit = evaluateAgentGate(
      input({
        candidate: { run: run("cand", "v2"), evals: CASES.map((c) => ev("cand", c, c === "c1" ? { safe: "FAIL" } : {})) },
        baseline: { run: run("base", "v1", { frozen_hash: "OTHER" }), evals: CASES.map((c) => ev("base", c)) },
      }),
    );
    expect(crit.next_step).toMatch(/Fix the failing cases/);
    const approval = {
      approval_id: "ap",
      approver: "Rich",
      decision: "rejected" as const,
      notes: "",
      candidate_run_id: "cand",
      baseline_run_id: "base",
      evidence_snapshot_hash: "S1",
      status_at_approval: "ELIGIBLE_FOR_DEMO_APPROVAL" as const,
      created_at: "2026-10-17T01:00:00Z",
    };
    expect(evaluateAgentGate(input({ approvals: [approval] })).next_step).toMatch(/rejected/);
  });

  it("a judge flag on a reviewed trace has its own reason and next step", () => {
    const g = evaluateAgentGate(
      input({
        agent: { name: "Bot", example: false, pass_all_threshold: 0.9, min_reviewed_traces: 3, judge_configured: true },
        candidate: { run: run("cand", "v2"), evals: CASES.map((c) => ev("cand", c, {}, { judge_verdict: c === "c2" ? "FAIL" : "PASS" })) },
        candidate_annotations: CASES.map((c) => ann("cand", c, { judge_label: "not_assessed" })),
      }),
    );
    expect(g.reasons.find((r) => r.code === "judge_flags_unanswered")!.case_ids).toEqual(["c2"]);
    expect(g.next_step).toMatch(/answer the judge's question/i);
  });

  it("a matches_expected check that can't apply to some cases is a visible warning", () => {
    const g = evaluateAgentGate(input({ check_gaps: [{ evaluator_id: "esc", field: "escalate", case_ids: ["c3"] }] }));
    expect(g.reasons.find((r) => r.code === "expected_field_missing:esc")).toMatchObject({ level: "WARNING", case_ids: ["c3"] });
  });

  it("the starter kit's next step follows the tour", () => {
    const ex = { name: "Bot", example: true, pass_all_threshold: 0.9, min_reviewed_traces: 3, judge_configured: false };
    expect(evaluateAgentGate(input({ agent: ex, candidate: null, baseline: null })).next_step).toMatch(/import traces.v1-baseline/);
    expect(evaluateAgentGate(input({ agent: ex, candidate: null })).next_step).toMatch(/traces.v2-candidate/);
    expect(evaluateAgentGate(input({ agent: ex })).next_step).toMatch(/agents\/_template/);
  });

  it("before the reveal, the review step doesn't ask for every trace of a run that will be replaced", () => {
    const g = evaluateAgentGate(input({ heldout: { exists: true, revealed: false, moved_to_dev_without_reveal: [] }, candidate_annotations: [] }));
    expect(g.next_step).toMatch(/reveal the held-out cases and re-run both versions/);
  });

  it("a lone first run reads as the baseline: next step asks for the candidate", () => {
    expect(evaluateAgentGate(input({ candidate: null })).next_step).toMatch(/your change as the candidate/);
  });
});

describe("pass-all reason", () => {
  it("lists cases where every check was NOT_APPLICABLE (they can't be shown to pass)", () => {
    const evals = CASES.map((c) => (c === "c3" ? { ...ev("cand", c, { safe: "NOT_APPLICABLE", short: "NOT_APPLICABLE" }), pass_all: null } : ev("cand", c)));
    const g = evaluateAgentGate(input({ candidate: { run: run("cand", "v2"), evals } }));
    expect(g.reasons.find((r) => r.code === "pass_all_below_threshold")!.case_ids).toEqual(["c3"]);
  });
});
