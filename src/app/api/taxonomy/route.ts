import { connection } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import { Severity } from "@/lib/domain/schemas";
import { DETERMINISTIC_EVALUATORS } from "@/lib/evaluators/deterministic";
import { JUDGE_ID } from "@/lib/judge/judge";
import { taxonomyView } from "@/lib/services";
import {
  appendTaxonomyVersion,
  TaxonomyConflictError,
  audit,
  getTrace,
  latestTaxonomy,
  listAnnotations,
  listTaxonomyVersions,
  listTraces,
} from "@/lib/storage/repos";
import { applyTaxonomyOp } from "@/app/review/taxonomy/derive";
import type { EvaluatorOption, TaxonomyApiResponse, TaxonomyPostResponse } from "@/app/review/taxonomy/types";

const EVALUATOR_OPTIONS: EvaluatorOption[] = [
  ...DETERMINISTIC_EVALUATORS.map((d) => ({
    evaluator_id: d.evaluator_id,
    kind: "deterministic" as const,
    label: `${d.evaluator_id} (deterministic, ${d.validation_status.replace(/_/g, " ")})`,
    experimental: false,
  })),
  {
    evaluator_id: JUDGE_ID,
    kind: "llm_judge",
    label: `${JUDGE_ID} (LLM judge — EXPERIMENTAL)`,
    experimental: true,
  },
];

const Id = z.string().trim().min(1);
const Op = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), name: Id, definition: Id, severity: Severity }),
  z.object({
    type: z.literal("edit"),
    failure_mode_id: Id,
    name: z.string().optional(),
    definition: z.string().optional(),
    severity: Severity.optional(),
    linked_evaluator_id: z.string().min(1).nullable().optional(),
  }),
  z.object({ type: z.literal("merge"), source_id: Id, target_id: Id }),
  z.object({ type: z.literal("retire"), failure_mode_id: Id }),
  z.object({ type: z.literal("attach_trace"), failure_mode_id: Id, trace_id: Id }),
]);

const Body = z.object({
  author: z.string().trim().min(1, "author (a named human) is required"),
  change_note: z.string().trim().min(1, "change_note is required: say why the taxonomy changes"),
  op: Op,
});

/** Latest taxonomy with human-only observed frequencies, plus version history and the inputs the axial-coding UI needs. */
export async function GET() {
  await connection();
  return handle(async () => {
    const [view, versions, annotations, traces] = await Promise.all([
      taxonomyView(),
      listTaxonomyVersions(),
      listAnnotations(),
      listTraces(),
    ]);
    const body: TaxonomyApiResponse = {
      ...view,
      versions: versions
        .map((v) => ({
          version: v.version,
          created_at: v.created_at,
          author: v.author,
          change_note: v.change_note,
          mode_count: v.failure_modes.length,
        }))
        .sort((a, b) => b.version - a.version),
      annotations: annotations.filter((a) => a.label_source === "human"),
      trace_modes: Object.fromEntries(traces.map((t) => [t.trace_id, t.execution_mode])),
      evaluator_options: EVALUATOR_OPTIONS,
    };
    return ok(body);
  });
}

/** Apply ONE axial-coding change; every change is persisted as a new taxonomy version and audited. */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = Body.parse(await req.json().catch(() => null));
    const latest = await latestTaxonomy();
    const op = body.op;
    const [annotations, trace] = await Promise.all([
      listAnnotations(),
      op.type === "attach_trace" ? getTrace(op.trace_id) : Promise.resolve(null),
    ]);
    let applied: ReturnType<typeof applyTaxonomyOp>;
    try {
      applied = applyTaxonomyOp(latest.failure_modes, op, {
        annotations,
        traceExists: trace !== null,
        evaluatorIds: EVALUATOR_OPTIONS.map((e) => e.evaluator_id),
      });
    } catch (err) {
      return fail(400, err instanceof Error ? err.message : String(err));
    }
    let created;
    try {
      created = await appendTaxonomyVersion(body.author, body.change_note, applied.modes, latest.version);
    } catch (err) {
      if (err instanceof TaxonomyConflictError) return fail(409, err.message);
      throw err;
    }
    await audit(body.author, `taxonomy.${op.type}`, {
      previous_version: latest.version,
      version: created.version,
      failure_mode_id: applied.failure_mode_id,
      change_note: body.change_note,
      op,
    });
    const res: TaxonomyPostResponse = { taxonomy_version: created, failure_mode_id: applied.failure_mode_id };
    return ok(res);
  });
}
