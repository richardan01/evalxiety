import { connection, type NextRequest } from "next/server";
import { handle, ok, fail } from "@/lib/api/http";
import { SCENARIOS, splitOf } from "@/lib/domain/scenarios";
import { compareRunIds } from "@/lib/services";

/** Paired, case-level comparison of two runs over the same frozen set (identical content hash). */
export async function GET(req: NextRequest) {
  await connection();
  return handle(async () => {
    const baseline = req.nextUrl.searchParams.get("baseline");
    const candidate = req.nextUrl.searchParams.get("candidate");
    if (!baseline || !candidate) return fail(400, "Provide ?baseline=<run_id>&candidate=<run_id>");
    if (baseline === candidate) return fail(400, "Choose two different runs to compare");
    let result;
    try {
      result = await compareRunIds(baseline, candidate);
    } catch (err) {
      return fail(400, err instanceof Error ? err.message : String(err));
    }
    const caseIds = new Set(result.comparison.pairs.map((p) => p.case_id));
    const case_meta = Object.fromEntries(
      SCENARIOS.filter((s) => caseIds.has(s.case_id)).map((s) => [s.case_id, { title: s.title, split: splitOf(s.case_id) }]),
    );
    return ok({ ...result, case_meta });
  });
}
