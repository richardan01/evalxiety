import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { reviewQueue } from "@/lib/services";

/**
 * GET /api/review/queue
 * → { items: QueueItem[], reviewed_count: number, total: number }
 * Every trace with its dev/held-out split and the human annotations recorded on it.
 */
export async function GET() {
  await connection();
  return handle(async () => ok(await reviewQueue()));
}
