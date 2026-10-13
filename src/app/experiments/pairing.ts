/**
 * Which two runs can be compared. Mirrors the compare API's rules (same frozen
 * set, identical content hash, recorded on the set's current content) so the
 * page can pick a valid pair up front instead of showing a rejection.
 */
import type { FrozenSetRow, RunRow } from "./types";

type SetHashes = Array<Pick<FrozenSetRow, "frozen_set_id" | "content_hash">>;

/** True when the run was recorded on its frozen set's current content. */
export function isCurrentContent(row: RunRow, sets: SetHashes): boolean {
  const set = sets.find((s) => s.frozen_set_id === row.run.frozen_set_id);
  return set !== undefined && set.content_hash === row.run.frozen_set_hash;
}

/** Why `row` cannot be compared against `other`, or null when it can. */
export function pairBlocker(row: RunRow, other: RunRow | undefined, sets: SetHashes): string | null {
  if (!isCurrentContent(row, sets)) return "Recorded on older case content — re-run to compare";
  if (!other) return null;
  if (other.run.run_id === row.run.run_id) return "Already selected on the other side";
  if (other.run.frozen_set_id !== row.run.frozen_set_id || other.run.frozen_set_hash !== row.run.frozen_set_hash) {
    return `Different test set (${row.run.frozen_set_id} vs ${other.run.frozen_set_id})`;
  }
  return null;
}

/**
 * Newest completed Corrected run that has a completed Baseline run on the same
 * frozen set (identical, current content) in the same execution mode.
 */
export function latestComparablePair(runs: RunRow[], sets: SetHashes): [RunRow, RunRow] | null {
  const usable = runs
    .filter((r) => r.run.status === "completed" && isCurrentContent(r, sets))
    .sort((a, b) => Date.parse(b.run.created_at) - Date.parse(a.run.created_at));
  for (const c of usable.filter((r) => r.config_role === "corrected")) {
    const b = usable.find(
      (r) =>
        r.config_role === "baseline" &&
        r.run.frozen_set_id === c.run.frozen_set_id &&
        r.run.frozen_set_hash === c.run.frozen_set_hash &&
        r.run.execution_mode === c.run.execution_mode,
    );
    if (b) return [b, c];
  }
  return null;
}
