import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api/http";
import { DatasetSplit, ExecutionMode } from "@/lib/domain/schemas";
import { calibrationView } from "@/lib/services";

const Query = z.object({
  split: DatasetSplit.default("dev"),
  mode: ExecutionMode.default("live"),
  include_demo: z.enum(["1", "true"]).optional(),
});

/**
 * Judge calibration against human gold labels. Held-out before an audited reveal returns
 * `{ locked: true, heldout }` with 200 — the lock is a normal state, not an error.
 */
export async function GET(req: NextRequest) {
  await connection();
  return handle(async () => {
    const sp = req.nextUrl.searchParams;
    const query = Query.parse({
      split: sp.get("split") || undefined,
      mode: sp.get("mode") || undefined,
      include_demo: sp.get("include_demo") || undefined,
    });
    return ok(await calibrationView({ split: query.split, mode: query.mode, include_demo: query.include_demo !== undefined }));
  });
}
