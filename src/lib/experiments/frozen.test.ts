import { afterEach, describe, expect, it } from "vitest";
import { POLICIES } from "../domain/policies";
import { SCENARIOS } from "../domain/scenarios";
import { PINNED_HASHES, frozenSets, getFrozenSet, runMatchesFrozenContent, verifyFrozenSet } from "./frozen";

const devSet = () => getFrozenSet("FROZEN-DEV-v1")!;

describe("frozen sets pin cases AND policies", () => {
  const originalFloor = POLICIES[0].discount_approval_threshold_pct;
  const originalVolume = SCENARIOS[0].monthly_volume_usd;
  afterEach(() => {
    POLICIES[0].discount_approval_threshold_pct = originalFloor;
    SCENARIOS[0].monthly_volume_usd = originalVolume;
  });

  it("every set verifies against its pinned hash today", () => {
    for (const s of frozenSets()) {
      expect(s.content_hash).toBe(PINNED_HASHES[s.frozen_set_id]);
      expect(verifyFrozenSet(s)).toBe(true);
    }
  });

  it("editing a policy invalidates every set (what 'pass' means changed)", () => {
    POLICIES[0].discount_approval_threshold_pct = originalFloor + 1;
    for (const s of frozenSets()) expect(verifyFrozenSet(s)).toBe(false);
  });

  it("editing a case invalidates the sets that contain it", () => {
    SCENARIOS[0].monthly_volume_usd = originalVolume + 1;
    const affected = frozenSets().filter((s) => s.case_ids.includes(SCENARIOS[0].case_id));
    expect(affected.length).toBeGreaterThan(0);
    for (const s of affected) expect(verifyFrozenSet(s)).toBe(false);
  });

  it("a run recorded under an older hash is not comparable", () => {
    expect(runMatchesFrozenContent({ frozen_set_id: "FROZEN-DEV-v1", frozen_set_hash: devSet().content_hash })).toBe(true);
    expect(runMatchesFrozenContent({ frozen_set_id: "FROZEN-DEV-v1", frozen_set_hash: "fe3b9b9a46-legacy" })).toBe(false);
    POLICIES[0].discount_approval_threshold_pct = originalFloor + 1;
    expect(runMatchesFrozenContent({ frozen_set_id: "FROZEN-DEV-v1", frozen_set_hash: devSet().content_hash })).toBe(false);
  });
});
