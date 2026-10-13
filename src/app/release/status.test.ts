import { describe, expect, it } from "vitest";
import type { GateReason } from "@/lib/release/gate";
import { approveBlockedReason, checkLabel, groupReasons, shortMessage, topReason, verdictFor, type VerdictInput } from "./status";

const r = (level: GateReason["level"], message: string, code = message, case_ids: string[] = []): GateReason => ({ code, level, message, case_ids });

const input = (reasons: GateReason[], over: Partial<VerdictInput> = {}): VerdictInput => ({
  reasons,
  approval_state: "none",
  approver: null,
  case_count: 20,
  trace_by_case: new Map(),
  ...over,
});

describe("release verdict", () => {
  it("NO_SHIP: counts blocking failures, cites the first, and links its failing case", () => {
    const v = verdictFor(
      input(
        [
          r("INSUFFICIENT_EVIDENCE", "Candidate results come from the MOCK agent", "mock_results"),
          r("NO_SHIP", "Confirmed critical policy violation in 2 case(s) (validated deterministic checks).", "critical_policy_violation", ["C13", "C14"]),
          r("NO_SHIP", "Stale policy used in 1 required case(s).", "stale_policy_in_required_case", ["C13"]),
        ],
        { trace_by_case: new Map([["C13", "tr_13"]]) },
      ),
    );
    expect(v.sentence).toBe("2 blocking failures: confirmed critical policy violation in 2 case(s) (+1 more).");
    expect(v.action).toEqual({ label: "Inspect C13", href: "/review/tr_13" });
  });

  it("insufficient evidence never reads as a pass and points at the final run", () => {
    const v = verdictFor(
      input([
        r("INSUFFICIENT_EVIDENCE", "No candidate run selected.", "no_candidate_run"),
        r("INSUFFICIENT_EVIDENCE", "No baseline run on the same frozen set — regressions cannot be checked.", "no_baseline"),
        r("INSUFFICIENT_EVIDENCE", "Only 0 trace(s) have human review; error analysis needs at least 5.", "insufficient_human_review"),
      ]),
    );
    expect(v.sentence).toBe("Not decided yet — run the final check on all 20 cases (+2 more gaps).");
    expect(v.action).toEqual({ label: "Run final check", href: "/experiments" });
  });

  it("unresolved reviews → review N cases", () => {
    const v = verdictFor(
      input([
        r(
          "INSUFFICIENT_EVIDENCE",
          "3 of 20 candidate case(s) still need human review — every candidate case is reviewed while the judge is unvalidated.",
          "unresolved_required_reviews",
          ["C1", "C2", "C3"],
        ),
      ]),
    );
    expect(v.sentence).toBe("Not decided yet — 3 of 20 candidate case(s) still need human review.");
    expect(v.action).toEqual({ label: "Review 3 cases", href: "/review" });
  });

  it("eligible: approval is separate and the action points at sign-off; never 'production certified'", () => {
    const none = verdictFor(input([]));
    expect(none.sentence).toMatch(/^No blockers — a named human can now approve/);
    expect(none.action?.href).toBe("#approval");
    expect(none.sentence.toLowerCase()).not.toContain("production certified");

    const warned = verdictFor(input([r("WARNING", "Human reviewers marked 1 candidate trace(s) as failed (non-critical).")]));
    expect(warned.sentence).toContain("Read 1 warning first.");

    const approved = verdictFor(input([], { approval_state: "approved", approver: "Rich" }));
    expect(approved.sentence).toBe("No blockers — approved for the demo by Rich on this exact evidence.");
    expect(approved.action).toBeNull();

    expect(verdictFor(input([], { approval_state: "stale" })).sentence).toContain("stale");
    expect(verdictFor(input([], { approval_state: "rejected", approver: "Ana" })).sentence).toContain("Ana rejected it");
  });

  it("reasons in the evaluation outrank approval state", () => {
    const v = verdictFor(input([r("NO_SHIP", "Bad.", "x")], { approval_state: "approved", approver: "Rich" }));
    expect(v.sentence).toBe("1 blocking failure: bad.");
  });
});

describe("release status helpers", () => {
  it("shortMessage keeps the first clause and drops trailing qualifiers", () => {
    expect(shortMessage("No baseline run on the same frozen set — regressions cannot be checked.")).toBe("No baseline run on the same frozen set.");
    expect(shortMessage("Confirmed critical policy violation in 2 case(s) (validated deterministic checks).")).toBe(
      "Confirmed critical policy violation in 2 case(s).",
    );
  });

  it("checkLabel shortens known checks and keeps gate thresholds", () => {
    expect(checkLabel({ id: "live_execution", label: "Live model execution (not mock)" })).toBe("Live model, not mock");
    expect(checkLabel({ id: "pass_all", label: "Pass-all ≥ 90% on validated checks" })).toBe("Pass-all ≥ 90%");
    expect(checkLabel({ id: "new_thing", label: "Something new" })).toBe("Something new");
  });

  it("groups by level in severity order and picks the most severe top reason", () => {
    const reasons = [r("WARNING", "w"), r("INSUFFICIENT_EVIDENCE", "i"), r("NO_SHIP", "n")];
    expect(groupReasons(reasons).map((g) => g.level)).toEqual(["NO_SHIP", "INSUFFICIENT_EVIDENCE", "WARNING"]);
    expect(topReason(reasons)?.message).toBe("n");
    expect(topReason([])).toBeNull();
  });

  it("approve is blocked unless the evaluation status is eligible", () => {
    expect(approveBlockedReason({ evaluation_status: "ELIGIBLE_FOR_DEMO_APPROVAL" }, true)).toBeNull();
    expect(approveBlockedReason({ evaluation_status: "ELIGIBLE_FOR_DEMO_APPROVAL" }, false)).toMatch(/no candidate run/);
    expect(approveBlockedReason({ evaluation_status: "NO_SHIP" }, true)).toBe("Approve unlocks at “Ready for approval” — now “No ship”.");
  });
});
