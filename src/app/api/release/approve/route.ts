import { connection } from "next/server";
import { handle, ok, fail } from "@/lib/api/http";
import { DecisionBody, recordReleaseDecision } from "@/app/release/_server/decision";

/**
 * Record a human release decision (approve / reject) bound to the current
 * evidence snapshot. Approve → 409 unless the recomputed gate is
 * ELIGIBLE_FOR_DEMO_APPROVAL. Reject is always allowed (notes required).
 * Success returns the recomputed release view plus `recorded_approval`.
 */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = DecisionBody.parse(await req.json());
    const out = await recordReleaseDecision(body);
    switch (out.kind) {
      case "not_found":
        return fail(404, out.message);
      case "snapshot_changed":
        return fail(409, out.message, [`current evidence snapshot ${out.current_hash.slice(0, 12)}`]);
      case "blocked":
        return fail(
          409,
          out.message,
          out.view.gate.reasons.filter((r) => r.level !== "WARNING").map((r) => `${r.level}: ${r.message}`),
        );
      case "recorded":
        return ok({ ...out.view, recorded_approval: out.approval });
    }
  });
}
