import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { SpendCapError, committedUsd, readLedger, reserveSpend, settleSpend, worstCaseCostUsd } from "./client";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-spend-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.LIVE_SPEND_CAP_USD = "1";
});
beforeEach(async () => {
  await fs.rm(path.join(dir, "spend_ledger.json"), { force: true });
});
afterAll(async () => {
  delete process.env.LIVE_SPEND_CAP_USD;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("enforceable spend cap", () => {
  it("worst case covers full output plus a fallback attempt", () => {
    // 0 input bytes → only overhead tokens; 16k output at $20/M + $25/M.
    expect(worstCaseCostUsd(0, 16000)).toBeCloseTo((2000 * 5 + 16000 * 20 + 2000 * 6.25 + 16000 * 25) / 1e6, 6);
    expect(worstCaseCostUsd(10_000, 16000)).toBeGreaterThan(worstCaseCostUsd(0, 16000));
  });

  it("worst case is priced for the requested model, with the fallback term only where fallback exists", () => {
    // Haiku 5.5: input $0.1/M (cache write $0.125/M), output $0.5/M, no server-side fallback.
    expect(worstCaseCostUsd(0, 16000, "claude-haiku-5-5")).toBeCloseTo((2000 * 0.125 + 16000 * 0.5) / 1e6, 9);
    // Sonnet 5.5 keeps the fallback attempt: input $2/M (cache write $2.5/M), output $10/M + fallback.
    expect(worstCaseCostUsd(0, 16000, "claude-sonnet-5-5")).toBeCloseTo((2000 * 2.5 + 16000 * 10 + 2000 * 6.25 + 16000 * 25) / 1e6, 9);
    expect(worstCaseCostUsd(0, 16000, "claude-haiku-5-5")).toBeLessThan(worstCaseCostUsd(0, 16000) / 40);
    // Unknown model ids fall back to the default (Opus) bound rather than under-reserving.
    expect(worstCaseCostUsd(0, 16000, "claude-unknown")).toBeCloseTo(worstCaseCostUsd(0, 16000), 12);
  });

  it("concurrent reservations can never jointly exceed the cap", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => reserveSpend(`c${i}`, 0.3)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(3); // 3 × $0.30 ≤ $1 < 4 × $0.30
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(SpendCapError);
    expect(committedUsd(await readLedger())).toBeLessThanOrEqual(1);
  });

  it("settling replaces the hold with the actual cost and frees budget", async () => {
    const id = await reserveSpend("a", 0.9);
    await expect(reserveSpend("b", 0.2)).rejects.toBeInstanceOf(SpendCapError);
    await settleSpend(id, "a", 0.05, "claude-opus-5-5");
    const l = await readLedger();
    expect(l.reservations).toHaveLength(0);
    expect(l.total_estimated_usd).toBeCloseTo(0.05);
    expect(l.live_calls).toBe(1);
    await expect(reserveSpend("b", 0.2)).resolves.toBeTypeOf("string");
  });

  it("an unbilled failure releases the hold without recording spend", async () => {
    const id = await reserveSpend("a", 0.5);
    await settleSpend(id, "a", null, null);
    const l = await readLedger();
    expect(l.total_estimated_usd).toBe(0);
    expect(l.live_calls).toBe(0);
    expect(l.reservations).toHaveLength(0);
  });

  it("reads ledgers written before reservations existed", async () => {
    await fs.writeFile(path.join(dir, "spend_ledger.json"), JSON.stringify({ total_estimated_usd: 0.4, live_calls: 2, entries: [] }));
    expect(committedUsd(await readLedger())).toBeCloseTo(0.4);
    await expect(reserveSpend("x", 0.7)).rejects.toBeInstanceOf(SpendCapError);
  });
});
