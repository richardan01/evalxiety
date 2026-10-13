import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { listAudit } from "@/lib/storage/repos";

const LIMIT = 200;

/** GET /api/audit — the latest 200 audit events, newest first. */
export async function GET() {
  await connection();
  return handle(async () => {
    const all = await listAudit();
    // The log is append-only (chronological); reverse first so the stable sort keeps same-millisecond events newest first.
    const events = [...all]
      .reverse()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, LIMIT);
    return ok({ events, total: all.length, limit: LIMIT });
  });
}
