import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import { Annotation } from "@/lib/domain/schemas";
import { splitOf } from "@/lib/domain/scenarios";
import { audit, getTrace, listAnnotations, listTaxonomyVersions, upsertAnnotation } from "@/lib/storage/repos";

/**
 * Request body for a human annotation: the Annotation contract minus the fields the server owns
 * (id, timestamps, label_source — always "human" — and case_id, which is taken from the trace).
 */
const AnnotationBody = Annotation.omit({
  annotation_id: true,
  created_at: true,
  updated_at: true,
  label_source: true,
  case_id: true,
})
  .extend({
    case_id: z.string().optional(), // ignored unless it contradicts the trace
    reviewer: z.string().trim().min(1, "A named reviewer is required"),
    open_coding_notes: z.string().trim().default(""), // required for Fail (checked below); optional for Pass
    first_failure: z
      .object({
        description: z.string().trim().min(1, "Describe the first observed failure"),
        failure_mode_id: z.string().trim().min(1).nullable(),
      })
      .nullable(),
    additional_failure_mode_ids: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((b, ctx) => {
    if (b.task_outcome === "fail") {
      if (!b.open_coding_notes) ctx.addIssue({ code: "custom", path: ["open_coding_notes"], message: "describe what went wrong (required for Fail)" });
      if (!b.first_failure) ctx.addIssue({ code: "custom", path: ["first_failure"], message: "required when the outcome is Fail" });
      if (!b.severity) ctx.addIssue({ code: "custom", path: ["severity"], message: "required when the outcome is Fail" });
    } else {
      if (b.first_failure) ctx.addIssue({ code: "custom", path: ["first_failure"], message: "must be null when the outcome is Pass" });
      if (b.severity) ctx.addIssue({ code: "custom", path: ["severity"], message: "must be null when the outcome is Pass" });
      if (b.additional_failure_mode_ids.length > 0) {
        ctx.addIssue({ code: "custom", path: ["additional_failure_mode_ids"], message: "must be empty when the outcome is Pass" });
      }
    }
  });

/**
 * GET /api/annotations[?trace_id=…][&reviewer=…]
 * → { annotations: Annotation[] }   (human labels only)
 */
export async function GET(req: NextRequest) {
  await connection();
  return handle(async () => {
    const traceId = req.nextUrl.searchParams.get("trace_id");
    const reviewer = req.nextUrl.searchParams.get("reviewer");
    const annotations = (await listAnnotations()).filter(
      (a) => (!traceId || a.trace_id === traceId) && (!reviewer || a.reviewer === reviewer),
    );
    return ok({ annotations });
  });
}

/**
 * POST /api/annotations  (upsert: one annotation per trace × reviewer)
 * body: { trace_id, reviewer, open_coding_notes, task_outcome: "pass"|"fail",
 *         first_failure: { description, failure_mode_id|null } | null, additional_failure_mode_ids: string[],
 *         severity: "critical"|"major"|"minor"|null, unsupported_justification_label: "present"|"absent"|"not_assessed",
 *         taxonomy_version: number|null }
 * → 201/200 { annotation: Annotation, created: boolean }
 */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = AnnotationBody.parse(await req.json().catch(() => null));
    const trace = await getTrace(body.trace_id);
    if (!trace) return fail(404, `Trace ${body.trace_id} not found`);
    if (body.case_id && body.case_id !== trace.case_id) {
      return fail(400, "Invalid request", [`case_id: ${body.case_id} does not match trace case ${trace.case_id}`]);
    }

    // Newly assigned failure modes must be active categories in the latest taxonomy. Ids already recorded on this
    // reviewer's existing label are kept as recorded even if they were merged/retired since (they still roll up).
    const versions = await listTaxonomyVersions();
    const latest = versions[versions.length - 1];
    const existing = (await listAnnotations()).find((a) => a.trace_id === trace.trace_id && a.reviewer === body.reviewer);
    const alreadyRecorded = new Set(
      [existing?.first_failure?.failure_mode_id, ...(existing?.additional_failure_mode_ids ?? [])].filter(Boolean),
    );
    const modeIds = [body.first_failure?.failure_mode_id, ...body.additional_failure_mode_ids].filter(
      (x): x is string => Boolean(x),
    );
    const problems = modeIds.flatMap((id) => {
      if (alreadyRecorded.has(id)) return [];
      const m = latest.failure_modes.find((x) => x.failure_mode_id === id);
      if (!m) return [`unknown failure mode "${id}" in taxonomy v${latest.version}`];
      if (m.status === "merged") return [`${id} was merged into ${m.merged_into}; choose ${m.merged_into} instead`];
      if (m.status === "retired") return [`${id} is retired; choose an active category or leave it uncategorised`];
      return [];
    });
    if (problems.length) return fail(400, "Invalid request", problems);
    if (body.taxonomy_version !== null && !versions.some((v) => v.version === body.taxonomy_version)) {
      return fail(400, "Invalid request", [`taxonomy_version: ${body.taxonomy_version} does not exist`]);
    }

    const annotation = await upsertAnnotation({
      trace_id: trace.trace_id,
      case_id: trace.case_id,
      reviewer: body.reviewer,
      open_coding_notes: body.open_coding_notes,
      task_outcome: body.task_outcome,
      first_failure: body.first_failure,
      additional_failure_mode_ids: [...new Set(body.additional_failure_mode_ids)],
      severity: body.severity,
      unsupported_justification_label: body.unsupported_justification_label,
      taxonomy_version: body.taxonomy_version,
      checklist: body.checklist,
      rubric_version: body.rubric_version,
    });
    const created = annotation.created_at === annotation.updated_at;
    await audit(annotation.reviewer, "annotation.saved", {
      annotation_id: annotation.annotation_id,
      trace_id: annotation.trace_id,
      case_id: annotation.case_id,
      created,
      task_outcome: annotation.task_outcome,
      severity: annotation.severity,
      first_failure_mode_id: annotation.first_failure?.failure_mode_id ?? null,
      additional_failure_mode_ids: annotation.additional_failure_mode_ids,
      unsupported_justification_label: annotation.unsupported_justification_label,
      taxonomy_version: annotation.taxonomy_version,
      trace_execution_mode: trace.execution_mode,
      split: splitOf(trace.case_id),
    });
    return ok({ annotation, created }, { status: created ? 201 : 200 });
  });
}
