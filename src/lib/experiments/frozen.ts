/**
 * Frozen evaluation sets. Each set pins case IDs plus a content hash over the
 * scenario JSON AND every pricing policy version — the policies define what
 * "passing" means (effective policy, margin floors, required approvals), so a
 * policy edit must invalidate the set just like a case edit.
 *
 * The expected hashes are pinned below. Any change to a case or a policy makes
 * verifyFrozenSet() fail, so runs refuse to start and the release gate fails
 * its integrity check. To change cases or policies deliberately, create a new
 * set version (e.g. FROZEN-DEV-v2) with a new pinned hash — never re-pin an
 * existing ID, or old and new runs would compare as if they were equivalent.
 */
import { POLICIES } from "../domain/policies";
import { SCENARIOS, SPLIT_ASSIGNMENT, SPLIT_VERSION } from "../domain/scenarios";
import type { FrozenSet } from "../domain/schemas";
import { sha256 } from "../storage/store";

/** Hash of the content each set was frozen with (cases + policies), pinned 2026-10-13. */
export const PINNED_HASHES: Record<string, string> = {
  "FROZEN-DEV-v1": "c3796f76b0c107743d1522bc581b13ebdc2b51acfbf09948a548205e70736388",
  "FROZEN-HELDOUT-v1": "0d92db99a199463c70002a634109ee0b75307a33d46b6a742e0c5f98c602c5e9",
  "FROZEN-FULL-v1": "a76b7fd1af528558678532ba4ad13c1f22ae059fd39b0ded607d1b1d62339658",
};

export function hashCases(caseIds: string[]): string {
  const cases = [...caseIds].sort().map((id) => SCENARIOS.find((s) => s.case_id === id));
  if (cases.some((c) => !c)) throw new Error("Frozen set references an unknown case");
  const policies = [...POLICIES].sort((a, b) => a.policy_id.localeCompare(b.policy_id));
  return sha256({ split_version: SPLIT_VERSION, cases, policies });
}

function build(id: string, description: string, split: FrozenSet["split"], ids: string[]): FrozenSet {
  const case_ids = [...ids].sort();
  return { frozen_set_id: id, description, case_ids, content_hash: PINNED_HASHES[id], split };
}

export function frozenSets(): FrozenSet[] {
  const dev = SCENARIOS.filter((s) => SPLIT_ASSIGNMENT[s.case_id] === "dev").map((s) => s.case_id);
  const held = SCENARIOS.filter((s) => SPLIT_ASSIGNMENT[s.case_id] === "heldout").map((s) => s.case_id);
  return [
    build("FROZEN-DEV-v1", "Development split (12 cases) — use for iteration and comparison.", "dev", dev),
    build("FROZEN-HELDOUT-v1", "Held-out split (8 cases) — final check only; access is logged.", "heldout", held),
    build("FROZEN-FULL-v1", "All 20 frozen cases — the release-gate prototype set (includes held-out).", "full", [...dev, ...held]),
  ];
}

export function getFrozenSet(id: string): FrozenSet | null {
  return frozenSets().find((f) => f.frozen_set_id === id) ?? null;
}

/** True when the set's cases and the policies still hash to the pinned value. */
export function verifyFrozenSet(set: FrozenSet): boolean {
  const pinned = PINNED_HASHES[set.frozen_set_id];
  if (!pinned || set.content_hash !== pinned) return false;
  try {
    return hashCases(set.case_ids) === pinned;
  } catch {
    return false;
  }
}

/** A run is comparable/evaluable only if it ran on the current, verified content of its set. */
export function runMatchesFrozenContent(run: { frozen_set_id: string; frozen_set_hash: string }): boolean {
  const set = getFrozenSet(run.frozen_set_id);
  return set !== null && verifyFrozenSet(set) && run.frozen_set_hash === set.content_hash;
}

export function includesHeldout(set: FrozenSet): boolean {
  return set.case_ids.some((id) => SPLIT_ASSIGNMENT[id] === "heldout");
}
