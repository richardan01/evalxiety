/**
 * Bounded-concurrency worker pool that stops scheduling new items as soon as one fails.
 *
 * Every item may be a paid Claude call, so after the first failure the remaining queue must not be
 * drained: in-flight items finish (they are already billed either way), queued items never start.
 * The first error is rethrown once all workers have stopped.
 */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  // Shared across workers (mutated from closures, so an object rather than a narrowed `let`).
  const failure: { hit: boolean; error: unknown } = { hit: false, error: undefined };
  const workers = Array.from({ length: Math.max(0, Math.min(limit, queue.length)) }, async () => {
    while (!failure.hit && queue.length) {
      const item = queue.shift()!;
      try {
        await fn(item);
      } catch (error) {
        if (!failure.hit) failure.error = error;
        failure.hit = true;
      }
    }
  });
  await Promise.all(workers);
  if (failure.hit) throw failure.error;
}
