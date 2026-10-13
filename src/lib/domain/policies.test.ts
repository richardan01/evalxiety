import { describe, expect, it } from "vitest";
import { POLICIES, isEffectiveOn, policySections, selectEffectivePolicy } from "./policies";

describe("effective policy selection", () => {
  it("selects the policy whose window contains the decision date", () => {
    expect(selectEffectivePolicy("2025-06-15")?.policy_id).toBe("PRC-2025.1");
    expect(selectEffectivePolicy("2026-06-15")?.policy_id).toBe("PRC-2026.1");
    expect(selectEffectivePolicy("2026-10-13")?.policy_id).toBe("PRC-2026.2");
  });

  it("treats effective_from as inclusive and effective_to as exclusive (boundaries)", () => {
    expect(selectEffectivePolicy("2026-03-31")?.policy_id).toBe("PRC-2025.1");
    expect(selectEffectivePolicy("2026-04-01")?.policy_id).toBe("PRC-2026.1");
    expect(selectEffectivePolicy("2026-08-31")?.policy_id).toBe("PRC-2026.1");
    expect(selectEffectivePolicy("2026-09-01")?.policy_id).toBe("PRC-2026.2");
  });

  it("returns null before the first policy", () => {
    expect(selectEffectivePolicy("2024-12-31")).toBeNull();
  });

  it("open-ended policy stays effective far in the future", () => {
    expect(selectEffectivePolicy("2030-01-01")?.policy_id).toBe("PRC-2026.2");
  });

  it("throws on overlapping windows (data bug, not a case result)", () => {
    const overlap = [POLICIES[0], { ...POLICIES[1], effective_from: "2026-03-01" }];
    expect(() => selectEffectivePolicy("2026-03-15", overlap)).toThrow(/Overlapping/);
  });

  it("policy windows tile the timeline with no gaps", () => {
    const sorted = [...POLICIES].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i].effective_to).toBe(sorted[i + 1].effective_from);
    }
    expect(sorted.at(-1)?.effective_to).toBeNull();
  });

  it("isEffectiveOn agrees with selectEffectivePolicy", () => {
    for (const d of ["2025-01-01", "2026-03-31", "2026-04-01", "2026-09-01"]) {
      const sel = selectEffectivePolicy(d);
      for (const p of POLICIES) expect(isEffectiveOn(p, d)).toBe(p.policy_id === sel?.policy_id);
    }
  });

  it("every policy renders 8 citable sections with unique evidence ids", () => {
    const ids = POLICIES.flatMap((p) => policySections(p).map((s) => s.evidence_id));
    expect(ids.length).toBe(POLICIES.length * 8);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
