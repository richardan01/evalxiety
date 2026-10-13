import { connection } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import { audit, latestTaxonomy, listAnnotations, upsertAnnotation } from "@/lib/storage/repos";
import type { CategorizeResponse } from "@/app/review/taxonomy/types";

const Body = z.object({
  annotation_id: z.string().trim().min(1),
  actor: z.string().trim().min(1, "actor (a named human) is required"),
  first_failure_mode_id: z.string().trim().min(1).nullable(),
  additional_failure_mode_ids: z.array(z.string().trim().min(1)).optional(),
});

/**
 * Axial coding: assign failure-mode categories to an existing HUMAN annotation.
 * Only the category fields and taxonomy_version change; the reviewer, label and
 * notes are re-saved unchanged (same reviewer, so the annotation is updated in place).
 */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = Body.parse(await req.json().catch(() => null));
    const annotation = (await listAnnotations()).find((a) => a.annotation_id === body.annotation_id);
    if (!annotation) return fail(404, `Annotation ${body.annotation_id} not found`);
    if (annotation.label_source !== "human") return fail(400, "Only human annotations can be categorised");

    const tax = await latestTaxonomy();
    const check = (id: string): string | null => {
      const m = tax.failure_modes.find((x) => x.failure_mode_id === id);
      if (!m) return `Unknown failure mode "${id}" in taxonomy v${tax.version}`;
      if (m.status === "merged") return `${id} was merged into ${m.merged_into}; assign ${m.merged_into} instead`;
      if (m.status === "retired") return `${id} is retired; choose an active category`;
      return null;
    };

    // Only NEWLY assigned ids must be active categories; ids already stored on the annotation are kept as recorded
    // (merged ids still roll up into their target when frequencies are computed).
    if (body.first_failure_mode_id !== null) {
      if (!annotation.first_failure) {
        return fail(400, "This annotation records no first failure (the reviewer marked the task as passed), so it has nothing to categorise");
      }
      if (body.first_failure_mode_id !== annotation.first_failure.failure_mode_id) {
        const err = check(body.first_failure_mode_id);
        if (err) return fail(400, err);
      }
    }
    const additional = [...new Set(body.additional_failure_mode_ids ?? annotation.additional_failure_mode_ids)].filter(
      (id) => id !== body.first_failure_mode_id,
    );
    for (const id of additional) {
      if (annotation.additional_failure_mode_ids.includes(id)) continue;
      const err = check(id);
      if (err) return fail(400, err);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { annotation_id, created_at, updated_at, label_source, ...unchanged } = annotation;
    const saved = await upsertAnnotation({
      ...unchanged,
      first_failure: annotation.first_failure
        ? { ...annotation.first_failure, failure_mode_id: body.first_failure_mode_id }
        : null,
      additional_failure_mode_ids: additional,
      taxonomy_version: tax.version,
    });
    await audit(body.actor, "annotation.categorized", {
      annotation_id: saved.annotation_id,
      trace_id: saved.trace_id,
      case_id: saved.case_id,
      reviewer: saved.reviewer,
      taxonomy_version: tax.version,
      before: {
        first_failure_mode_id: annotation.first_failure?.failure_mode_id ?? null,
        additional_failure_mode_ids: annotation.additional_failure_mode_ids,
      },
      after: {
        first_failure_mode_id: saved.first_failure?.failure_mode_id ?? null,
        additional_failure_mode_ids: saved.additional_failure_mode_ids,
      },
    });
    const res: CategorizeResponse = { annotation: saved };
    return ok(res);
  });
}
