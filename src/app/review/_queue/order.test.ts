import { describe, expect, it } from "vitest";
import { firstUnreviewed, neighbours, nextUnreviewedAfter, reviewOrder, type Orderable } from "./order";

const item = (id: string, mode: "live" | "mock", split: Orderable["split"], ts: string, reviewed = false): Orderable => ({
  split,
  reviewed,
  trace: { trace_id: id, timestamp: ts, execution_mode: mode },
});

const items: Orderable[] = [
  item("mock-dev", "mock", "dev", "2026-10-01T00:00:00Z"),
  item("live-held", "live", "heldout", "2026-10-01T00:00:00Z"),
  item("live-dev-new", "live", "dev", "2026-10-03T00:00:00Z"),
  item("live-dev-old", "live", "dev", "2026-10-02T00:00:00Z", true),
  item("mock-custom", "mock", null, "2026-09-01T00:00:00Z"),
];

describe("review order", () => {
  it("puts live before mock and dev before held-out/custom, oldest first", () => {
    expect(reviewOrder(items).map((i) => i.trace.trace_id)).toEqual([
      "live-dev-old",
      "live-dev-new",
      "live-held",
      "mock-dev",
      "mock-custom",
    ]);
  });

  it("starts with the first unreviewed live dev trace", () => {
    expect(firstUnreviewed(items)?.trace.trace_id).toBe("live-dev-new");
    expect(firstUnreviewed(items, new Set(["live-dev-new"]))?.trace.trace_id).toBe("live-held");
    expect(firstUnreviewed(items.map((i) => ({ ...i, reviewed: true })))).toBeNull();
  });

  it("finds the next unreviewed trace after the current one, wrapping and skipping deferred", () => {
    expect(nextUnreviewedAfter(items, "live-held")?.trace.trace_id).toBe("mock-dev");
    expect(nextUnreviewedAfter(items, "mock-custom")?.trace.trace_id).toBe("live-dev-new");
    expect(nextUnreviewedAfter(items, "live-dev-new", new Set(["live-held", "mock-dev"]))?.trace.trace_id).toBe("mock-custom");
    expect(nextUnreviewedAfter([items[2]], "live-dev-new")).toBeNull();
  });

  it("reports position and neighbours", () => {
    const n = neighbours(items, "live-held");
    expect(n.index).toBe(2);
    expect(n.total).toBe(5);
    expect(n.prev?.trace.trace_id).toBe("live-dev-new");
    expect(n.next?.trace.trace_id).toBe("mock-dev");
    expect(neighbours(items, "missing").index).toBe(-1);
  });
});
