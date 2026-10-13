/**
 * Review order shared by the queue and the one-trace-per-screen workspace.
 *
 * Live traces before mock traces (mock output is not evidence about the real model), and within each
 * mode dev-split traces before held-out / custom ones. Inside a group: oldest first, so the order is
 * stable while new traces are appended.
 */
export interface Orderable {
  split: "dev" | "heldout" | null;
  reviewed: boolean;
  trace: { trace_id: string; timestamp: string; execution_mode: "live" | "mock" };
}

export function reviewPriority(item: Orderable): number {
  return (item.trace.execution_mode === "live" ? 0 : 2) + (item.split === "dev" ? 0 : 1);
}

export function reviewOrder<T extends Orderable>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      reviewPriority(a) - reviewPriority(b) ||
      a.trace.timestamp.localeCompare(b.trace.timestamp) ||
      a.trace.trace_id.localeCompare(b.trace.trace_id),
  );
}

/** First trace nobody has labelled yet, skipping ids in `skip` (e.g. deferred this session). */
export function firstUnreviewed<T extends Orderable>(items: T[], skip: ReadonlySet<string> = new Set()): T | null {
  return reviewOrder(items).find((i) => !i.reviewed && !skip.has(i.trace.trace_id)) ?? null;
}

/** Next unlabelled trace after `currentId` in review order (wrapping), never `currentId` itself. */
export function nextUnreviewedAfter<T extends Orderable>(
  items: T[],
  currentId: string,
  skip: ReadonlySet<string> = new Set(),
): T | null {
  const ordered = reviewOrder(items);
  const start = ordered.findIndex((i) => i.trace.trace_id === currentId);
  const rotated = start < 0 ? ordered : [...ordered.slice(start + 1), ...ordered.slice(0, start)];
  return rotated.find((i) => !i.reviewed && i.trace.trace_id !== currentId && !skip.has(i.trace.trace_id)) ?? null;
}

/** Position helpers for prev/next and the "k of M" counter. */
export function neighbours<T extends Orderable>(items: T[], currentId: string) {
  const ordered = reviewOrder(items);
  const index = ordered.findIndex((i) => i.trace.trace_id === currentId);
  return {
    index, // -1 if the trace is not in the queue
    total: ordered.length,
    prev: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}

// ---------------------------------------------------------------------------
// Session-only "deferred" list. Deferring records nothing on the server.
// ---------------------------------------------------------------------------

const DEFERRED_KEY = "agenttrust.review.deferred";

export function readDeferred(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(DEFERRED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function addDeferred(traceId: string): Set<string> {
  const next = readDeferred();
  next.add(traceId);
  window.sessionStorage.setItem(DEFERRED_KEY, JSON.stringify([...next]));
  return next;
}

export function removeDeferred(traceId: string) {
  const next = readDeferred();
  if (next.delete(traceId)) window.sessionStorage.setItem(DEFERRED_KEY, JSON.stringify([...next]));
}
