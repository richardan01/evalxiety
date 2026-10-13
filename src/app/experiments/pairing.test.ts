import { describe, expect, it } from "vitest";
import { isCurrentContent, latestComparablePair, pairBlocker } from "./pairing";
import type { RunRow } from "./types";

const SETS = [
  { frozen_set_id: "FROZEN-DEV-v1", content_hash: "cur" },
  { frozen_set_id: "FROZEN-FULL-v1", content_hash: "full" },
];

let n = 0;
function row(
  role: "baseline" | "corrected",
  opts: { hash?: string; set?: string; mode?: "live" | "mock"; status?: "completed" | "running" | "failed"; at?: string } = {},
): RunRow {
  n += 1;
  return {
    run: {
      run_id: `run_${n}`,
      created_at: opts.at ?? `2026-10-13T07:${String(n).padStart(2, "0")}:00.000Z`,
      frozen_set_id: opts.set ?? "FROZEN-DEV-v1",
      frozen_set_hash: opts.hash ?? "cur",
      execution_mode: opts.mode ?? "live",
      status: opts.status ?? "completed",
    },
    config_role: role,
    config_label: role === "baseline" ? "Baseline" : "Corrected",
  } as unknown as RunRow;
}

describe("latestComparablePair", () => {
  it("skips pairs recorded on older case content and picks the newest current pair", () => {
    const oldB = row("baseline", { hash: "old" });
    const oldC = row("corrected", { hash: "old" });
    const b = row("baseline");
    const c = row("corrected");
    expect(latestComparablePair([oldC, oldB, c, b], SETS)).toEqual([b, c]);
    expect(isCurrentContent(oldB, SETS)).toBe(false);
  });

  it("requires both runs completed and in the same execution mode", () => {
    const bMock = row("baseline", { mode: "mock" });
    const cLive = row("corrected", { mode: "live" });
    const bRunning = row("baseline", { status: "running" });
    expect(latestComparablePair([bMock, cLive, bRunning], SETS)).toBeNull();
    const bLive = row("baseline", { mode: "live" });
    expect(latestComparablePair([bMock, cLive, bLive], SETS)).toEqual([bLive, cLive]);
  });

  it("never pairs runs from different frozen sets", () => {
    const b = row("baseline", { set: "FROZEN-FULL-v1", hash: "full" });
    const c = row("corrected");
    expect(latestComparablePair([b, c], SETS)).toBeNull();
  });
});

describe("pairBlocker", () => {
  it("explains why two runs cannot be compared", () => {
    const b = row("baseline");
    const c = row("corrected");
    expect(pairBlocker(c, b, SETS)).toBeNull();
    expect(pairBlocker(b, b, SETS)).toMatch(/other side/);
    expect(pairBlocker(row("corrected", { set: "FROZEN-FULL-v1", hash: "full" }), b, SETS)).toMatch(/Different test set/);
    expect(pairBlocker(row("corrected", { hash: "old" }), undefined, SETS)).toMatch(/older case content/);
  });
});
