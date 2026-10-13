import { describe, expect, it } from "vitest";
import type { GateReason } from "@/lib/release/gate";
import { approveBlockedReason, groupReasons, recommendationFromReasons, topReason } from "./status";

const r = (level: GateReason["level"], message: string, code = message): GateReason => ({ code, level, message, case_ids: [] });

describe("release status helpers", () => {
  it("NO_SHIP recommendation says 'Do not ship' and cites the first blocking reasons", () => {
    const rec = recommendationFromReasons([
      r("INSUFFICIENT_EVIDENCE", "Candidate results come from the MOCK agent"),
      r("NO_SHIP", "Confirmed critical policy violation in 2 case(s)."),
      r("NO_SHIP", "Stale policy used in 1 required case(s)."),
      r("NO_SHIP", "Pass-all 50.0% is below the 90% demo threshold."),
    ]);
    expect(rec.tone).toBe("red");
    expect(rec.headline).toMatch(/^Do not ship: Confirmed critical policy violation/);
    expect(rec.headline).toContain("Stale policy used");
    expect(rec.headline).not.toContain("Pass-all");
    expect(rec.headline).toContain("+1 more blocking reason ");
    expect(rec.next_step).toContain("1 evidence gap(s)");
  });

  it("insufficient evidence never reads as a pass", () => {
    const rec = recommendationFromReasons([r("INSUFFICIENT_EVIDENCE", "No candidate run selected.")]);
    expect(rec.tone).toBe("amber");
    expect(rec.headline).toMatch(/^Do not ship yet/);
  });

  it("no reasons → eligible wording, never 'production certified'", () => {
    const rec = recommendationFromReasons([]);
    expect(rec.tone).toBe("blue");
    expect(`${rec.headline} ${rec.next_step}`.toLowerCase()).not.toContain("production certified");
  });

  it("warnings only → approver must read them", () => {
    const rec = recommendationFromReasons([r("WARNING", "Human reviewers marked 1 candidate trace(s) as failed (non-critical).")]);
    expect(rec.headline).toContain("Read 1 warning(s)");
  });

  it("groups by level in severity order and picks the most severe top reason", () => {
    const reasons = [r("WARNING", "w"), r("INSUFFICIENT_EVIDENCE", "i"), r("NO_SHIP", "n")];
    expect(groupReasons(reasons).map((g) => g.level)).toEqual(["NO_SHIP", "INSUFFICIENT_EVIDENCE", "WARNING"]);
    expect(topReason(reasons)?.message).toBe("n");
    expect(topReason([])).toBeNull();
  });

  it("approve is blocked unless the evaluation status is eligible", () => {
    expect(approveBlockedReason({ evaluation_status: "ELIGIBLE_FOR_DEMO_APPROVAL", reasons: [] }, true)).toBeNull();
    expect(approveBlockedReason({ evaluation_status: "ELIGIBLE_FOR_DEMO_APPROVAL", reasons: [] }, false)).toMatch(/no candidate run/);
    expect(approveBlockedReason({ evaluation_status: "NO_SHIP", reasons: [r("NO_SHIP", "Bad.")] }, true)).toContain("currently NO SHIP — Bad.");
  });
});
