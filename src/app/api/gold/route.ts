import { connection } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import type { DatasetSplit } from "@/lib/domain/schemas";
import { SPLIT_ASSIGNMENT, SPLIT_VERSION } from "@/lib/domain/scenarios";
import { expectedBehaviorFor, promoteToGold } from "@/lib/services";
import {
  audit,
  getHeldoutState,
  latestTaxonomy,
  listAnnotations,
  listGold,
  listTraces,
  removeGold,
} from "@/lib/storage/repos";
import { selectCandidates } from "@/app/review/gold/candidates";
import type { GoldApiResponse, GoldCandidate } from "@/app/review/gold/types";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("promote"),
    annotation_id: z.string().trim().min(1),
    promoted_by: z.string().trim().min(1, "promoted_by (a named human) is required"),
    expected_behavior: z.string().optional(),
  }),
  z.object({
    action: z.literal("remove"),
    gold_id: z.string().trim().min(1),
    actor: z.string().trim().min(1, "actor (a named human) is required"),
  }),
]);

/** Gold examples (with provenance) and the promotion queue of human-reviewed frozen-case traces. */
export async function GET() {
  await connection();
  return handle(async () => {
    const [gold, annotations, traces, tax, heldout] = await Promise.all([
      listGold(),
      listAnnotations(),
      listTraces(),
      latestTaxonomy(),
      getHeldoutState(),
    ]);
    const { candidates: raw, superseded } = selectCandidates(
      annotations,
      gold,
      traces.map((t) => ({ trace_id: t.trace_id, case_id: t.case_id, execution_mode: t.execution_mode, data_origin: t.data_origin })),
      SPLIT_ASSIGNMENT,
    );
    const candidates: GoldCandidate[] = raw.map((c) => {
      let expected: GoldCandidate["expected_behavior"] = null;
      let error: string | null = null;
      try {
        expected = expectedBehaviorFor(c.trace.case_id);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      return {
        annotation: c.annotation,
        case_id: c.trace.case_id,
        trace_id: c.trace.trace_id,
        split: c.split,
        execution_mode: c.trace.execution_mode,
        expected_behavior: expected,
        expected_behavior_error: error,
        reason: c.reason,
        existing_gold_id: c.existing_gold_id,
      };
    });
    const splitCounts: Record<DatasetSplit, number> = { dev: 0, heldout: 0 };
    for (const s of Object.values(SPLIT_ASSIGNMENT)) splitCounts[s]++;
    const body: GoldApiResponse = {
      gold: [...gold].sort((a, b) => a.case_id.localeCompare(b.case_id) || a.promoted_at.localeCompare(b.promoted_at)),
      candidates,
      failure_mode_names: Object.fromEntries(tax.failure_modes.map((m) => [m.failure_mode_id, m.name])),
      split_case_counts: splitCounts,
      split_version: SPLIT_VERSION,
      heldout: { revealed: heldout.revealed, revealed_at: heldout.revealed_at, revealed_by: heldout.revealed_by },
      superseded_by_other_annotation: superseded,
    };
    return ok(body);
  });
}

/** Promote a human annotation to gold, or remove a gold example. Both are audited. */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = Body.parse(await req.json().catch(() => null));
    if (body.action === "promote") {
      try {
        const gold = await promoteToGold({
          annotation_id: body.annotation_id,
          promoted_by: body.promoted_by,
          expected_behavior: body.expected_behavior,
        });
        return ok({ gold });
      } catch (err) {
        return fail(400, err instanceof Error ? err.message : String(err));
      }
    }
    const existing = (await listGold()).find((g) => g.gold_id === body.gold_id);
    if (!existing) return fail(404, `Gold example ${body.gold_id} not found`);
    try {
      await removeGold(body.gold_id);
    } catch (err) {
      return fail(400, err instanceof Error ? err.message : String(err));
    }
    await audit(body.actor, "gold.removed", {
      gold_id: existing.gold_id,
      trace_id: existing.trace_id,
      case_id: existing.case_id,
      annotation_id: existing.annotation_id,
      dataset_split: existing.dataset_split,
      label_version: existing.label_version,
    });
    return ok({ removed: existing.gold_id });
  });
}
