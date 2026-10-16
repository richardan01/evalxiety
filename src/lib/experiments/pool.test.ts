import { describe, expect, it } from "vitest";
import { pool } from "./pool";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("pool", () => {
  it("runs every item with at most `limit` in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(5);
      inFlight--;
      done.push(i);
    });
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it("stops scheduling queued items after the first failure and rethrows that error", async () => {
    const started: number[] = [];
    const boom = new Error("API error 529");
    const run = pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (i) => {
      started.push(i);
      if (i === 2) {
        await tick(1);
        throw boom;
      }
      await tick(20); // 1 and 3 are in flight when 2 fails; they must finish, nothing new may start.
    });
    await expect(run).rejects.toBe(boom);
    expect(started.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("with a serial pool nothing after the failing item runs", async () => {
    const started: number[] = [];
    await expect(
      pool([1, 2, 3, 4], 1, async (i) => {
        started.push(i);
        if (i === 2) throw new Error("spend cap");
      }),
    ).rejects.toThrow("spend cap");
    expect(started).toEqual([1, 2]);
  });

  it("surfaces the first error when several in-flight items fail", async () => {
    const run = pool([1, 2, 3], 3, async (i) => {
      await tick(i);
      throw new Error(`fail ${i}`);
    });
    await expect(run).rejects.toThrow("fail 1");
  });

  it("handles an empty list and a zero/negative limit", async () => {
    await expect(pool([], 3, async () => {})).resolves.toBeUndefined();
    const ran: number[] = [];
    await pool([1], 0, async (i) => {
      ran.push(i);
    });
    expect(ran).toEqual([]); // a zero-width pool runs nothing; callers pass limit ≥ 1
  });
});
