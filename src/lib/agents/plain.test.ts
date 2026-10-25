/**
 * The plain-language verdict only rewords the gate: every reason stays visible, NO SHIP stays a blocker, and
 * starter-kit data never reads as shippable.
 */
import { describe, expect, it } from "vitest";
import type { GateReason } from "./gate";
import { agentJourney, plainReason, plainVerdict, type PlainInput } from "./plain";

const CHECKS = [
  { evaluator_id: "escalates", question: "Does the bot hand off when it must?" },
  { evaluator_id: "short", question: "Is the answer short?" },
];

const reason = (code: string, level: GateReason["level"], case_ids: string[] = [], message = `gate says ${code}`): GateReason => ({ code, level, message, case_ids });

function input(over: Partial<PlainInput> & { reasons?: GateReason[]; status?: PlainInput["gate"]["status"] } = {}): PlainInput {
  const { reasons = [], status = "INSUFFICIENT_EVIDENCE", ...rest } = over;
  return {
    example: false,
    gate: { status, reasons, comparison: null, approval_state: "none", latest_approval: null },
    checks: CHECKS,
    reviewed_trace_count: 3,
    min_reviewed_traces: 10,
    ...rest,
  };
}

describe("plainVerdict", () => {
  it("keeps every gate reason, sorted into must-fix, still-needed and worth-knowing", () => {
    const reasons = [
      reason("critical_check_failed", "NO_SHIP", ["c2"]),
      reason("insufficient_human_review", "INSUFFICIENT_EVIDENCE"),
      reason("no_baseline", "INSUFFICIENT_EVIDENCE"),
      reason("same_version", "WARNING"),
      reason("some_future_code", "INSUFFICIENT_EVIDENCE", [], "A reason this module has never heard of."),
    ];
    const v = plainVerdict(input({ status: "NO_SHIP", reasons }));
    expect(v.tone).toBe("red");
    expect(v.headline).toBe("Not ready to ship");
    expect(v.blockers.map((b) => b.code)).toEqual(["critical_check_failed"]);
    expect(v.blockers[0].case_ids).toEqual(["c2"]);
    // Ordered like the gate's next step: get both versions tested before reviewing.
    expect(v.todo.map((t) => t.code)).toEqual(["no_baseline", "insufficient_human_review", "some_future_code"]);
    expect(v.notes.map((n) => n.code)).toEqual(["same_version"]);
    // An unknown reason is shown with the gate's own words, never dropped.
    expect(v.todo[2].text).toBe("A reason this module has never heard of.");
    // The first thing to do is the blocker.
    expect(v.next?.code).toBe("critical_check_failed");
    expect(v.summary).toMatch(/1 problem must be fixed first. 3 more things are needed/);
  });

  it("counts the reviews still missing", () => {
    const v = plainVerdict(input({ reasons: [reason("insufficient_human_review", "INSUFFICIENT_EVIDENCE")] }));
    expect(v.todo[0].text).toMatch(/^Review 7 more answers \(at least 10 in total\)/);
    expect(v.todo[0].where).toBe("review");
  });

  it("starter-kit data is a practice run, and its NO SHIP reasons say they would block a real release", () => {
    const v = plainVerdict(
      input({
        example: true,
        reasons: [
          reason("example_data", "INSUFFICIENT_EVIDENCE"),
          reason("critical_check_failed", "WARNING", ["c09"], "(example data — not evidence) A critical code check failed in 1 case(s)."),
        ],
      }),
    );
    expect(v.headline).toMatch(/Practice run/);
    expect(v.blockers).toEqual([]);
    expect(v.notes[0].text).toBe("Would block a real release: A critical rule failed on 1 case.");
    // example_data itself is the headline, not a to-do.
    expect(v.todo).toEqual([]);
  });

  it("says so when a real agent's answers are starter-kit data, instead of dropping the reason", () => {
    const v = plainVerdict(input({ reasons: [reason("example_data", "INSUFFICIENT_EVIDENCE"), reason("no_baseline", "INSUFFICIENT_EVIDENCE")] }));
    expect(v.headline).toBe("Practice data: these answers can never be approved");
    expect(v.summary).toMatch(/toy bot, not a real agent/);
    expect(v.todo.map((t) => t.code)).toEqual(["no_baseline"]);
  });

  it("names the rule and case behind a regression", () => {
    const comparison = {
      pairs: [
        { case_id: "c09", change: "regressed", evaluator_changes: [{ evaluator_id: "escalates", kind: "regressed" }, { evaluator_id: "short", kind: "unchanged" }] },
        { case_id: "c01", change: "fixed", evaluator_changes: [] },
      ],
      fixed: ["c01"],
      regressed: ["c09"],
      still_failing: [],
      still_passing: ["c02", "c03"],
      incomplete: [],
      new_regressions: [{ case_id: "c09", evaluator_id: "escalates", severity: "critical" }],
      new_critical_regressions: [{ case_id: "c09", evaluator_id: "escalates" }],
    } as unknown as PlainInput["gate"]["comparison"];
    const i = input({ status: "NO_SHIP", reasons: [reason("new_critical_regression", "NO_SHIP", ["c09"])] });
    i.gate.comparison = comparison;
    const v = plainVerdict(i);
    expect(v.blockers[0].text).toBe("Something that worked in the current version is broken in the new one: c09 (“Does the bot hand off when it must?”).");
    expect(v.changes).toEqual({ fixed: ["c01"], got_worse: [{ case_id: "c09", rules: ["Does the bot hand off when it must?"] }], still_failing: [], still_passing: 2, incomplete: [] });
  });

  it("eligible, approved, rejected and stale read differently, and only eligible points at the decision", () => {
    const eligible = plainVerdict(input({ status: "ELIGIBLE_FOR_DEMO_APPROVAL" }));
    expect(eligible.headline).toBe("Ready for your decision");
    expect(eligible.next?.where).toBe("approve");

    const approval = { approver: "Dana", decision: "approved", created_at: "2026-10-20T10:00:00Z", notes: "" } as unknown as PlainInput["gate"]["latest_approval"];
    const approved = plainVerdict(input({ status: "APPROVED_FOR_DEMO", gate: { status: "APPROVED_FOR_DEMO", reasons: [], comparison: null, approval_state: "approved", latest_approval: approval } }));
    expect(approved.tone).toBe("green");
    expect(approved.summary).toMatch(/^Approved by Dana on Oct 20, 2026/);

    const rejected = plainVerdict(input({ gate: { status: "ELIGIBLE_FOR_DEMO_APPROVAL", reasons: [], comparison: null, approval_state: "rejected", latest_approval: approval } }));
    expect(rejected.headline).toBe("Rejected");

    const stale = plainVerdict(input({ gate: { status: "ELIGIBLE_FOR_DEMO_APPROVAL", reasons: [], comparison: null, approval_state: "stale", latest_approval: approval } }));
    expect(stale.summary).toMatch(/evidence changed since the last decision/);
  });

  it("asks for reviews before unlocking the final exam (unlocking ends tuning)", () => {
    const v = plainVerdict(input({ reasons: [reason("heldout_not_revealed", "INSUFFICIENT_EVIDENCE"), reason("insufficient_human_review", "INSUFFICIENT_EVIDENCE")] }));
    expect(v.todo.map((t) => t.code)).toEqual(["insufficient_human_review", "heldout_not_revealed"]);
    expect(v.next?.code).toBe("insufficient_human_review");
  });

  it("insufficient evidence never reads as ready", () => {
    const v = plainVerdict(input({ reasons: [reason("heldout_not_revealed", "INSUFFICIENT_EVIDENCE")] }));
    expect(v.tone).toBe("amber");
    expect(v.headline).toBe("Not enough evidence to decide yet");
    expect(v.next?.where).toBe("cases");
  });
});

describe("plainReason", () => {
  it("rewords the pass-all bar without changing its numbers", () => {
    const r = reason("pass_all_below_threshold", "NO_SHIP", ["c1"], "88.9% of cases pass every code check; the bar is 90%.");
    expect(plainReason(r, input()).text).toBe("88.9% of cases pass every rule; the bar is 90%.");
  });
});

describe("agentJourney", () => {
  const base = { has_completed_run: false, has_comparison: false, heldout_exists: true, heldout_revealed: false, cases: 12 };
  it("marks the first unfinished step as current", () => {
    const steps = agentJourney({ ...input(), ...base });
    expect(steps.map((s) => s.state)).toEqual(["done", "active", "todo", "todo", "todo"]);
  });
  it("is done only after a named decision on complete evidence", () => {
    const approval = { approver: "Dana", decision: "approved", created_at: "2026-10-20T10:00:00Z", notes: "" } as unknown as PlainInput["gate"]["latest_approval"];
    const done = agentJourney({
      ...input({ reviewed_trace_count: 12, gate: { status: "APPROVED_FOR_DEMO", reasons: [], comparison: null, approval_state: "approved", latest_approval: approval } }),
      ...base,
      has_completed_run: true,
      has_comparison: true,
      heldout_revealed: true,
    });
    expect(done.every((s) => s.state === "done")).toBe(true);
  });
});
