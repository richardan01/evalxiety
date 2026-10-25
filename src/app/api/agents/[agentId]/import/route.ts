import { connection } from "next/server";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { parseTable, tracesFromTable } from "@/lib/agents/csv";
import { MAX_IMPORT_BYTES, parseImport, type LockState } from "@/lib/agents/ingest";
import type { LoadedAgent } from "@/lib/agents/schemas";
import { getLockState, importRun, ImportValidationError } from "@/lib/agents/runs";

const Column = z.number().int().min(0).max(500);

/** For a spreadsheet: which column holds the answers, and which one says which test case each row is. */
const Mapping = z.object({
  answer: Column,
  answer_field: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "a field name: letters, digits, _ and -").nullable().optional(),
  case_id: Column.nullable().optional(),
  question: Column.nullable().optional(),
});

const Source = {
  text: z.string().min(1, "paste or upload a file"),
  /** "csv" also covers TSV (cells copied from a spreadsheet) and semicolon-separated files. */
  format: z.enum(["jsonl", "csv"]).default("jsonl"),
  mapping: Mapping.optional(),
};

/** "Check file": only validates, saves nothing, so it needs no name or version label. */
const DryRun = z.object({ ...Source, dry_run: z.literal(true) });

const Body = z.object({
  ...Source,
  agent_version: z.string().trim().min(1, "name the version that produced these answers (e.g. prompt-v2)").max(100),
  actor: z.string().trim().min(1, "a named person (actor) is required"),
  notes: z.string().trim().max(2000).optional(),
  dry_run: z.literal(false).optional(),
});

/**
 * A spreadsheet becomes the same JSONL a file import takes, so every rule of the JSONL import still applies. Rows that
 * match a locked final-exam case are left out and counted (never imported); anything else that doesn't match is a
 * problem with its line number, and nothing is imported.
 */
function toJsonl(src: z.infer<typeof DryRun> | z.infer<typeof Body>, agent: LoadedAgent, lock: LockState): { text: string; skipped_locked: string[] } {
  if (src.format === "jsonl") return { text: src.text, skipped_locked: [] };
  if (!src.mapping) throw new ImportValidationError([{ line: 1, message: "Pick the answer column, and the question or case id column." }], false);
  let table;
  try {
    table = parseTable(src.text);
  } catch (e) {
    throw new ImportValidationError([{ line: 1, message: e instanceof Error ? e.message : String(e) }], false);
  }
  const conv = tracesFromTable(table, agent.cases, new Set(lock.locked.keys()), src.mapping);
  if (conv.problems.length) throw new ImportValidationError(conv.problems, false);
  if (conv.lines === 0) {
    throw new ImportValidationError(
      [{ line: 1, message: conv.skipped_locked.length ? "Every row is a locked final-exam case, so there is nothing to import yet." : "The sheet has no answer rows." }],
      false,
    );
  }
  return { text: conv.jsonl, skipped_locked: conv.skipped_locked };
}

/**
 * POST /api/agents/:agentId/import — import one run of answers: JSONL (one trace per line) or a spreadsheet (CSV/TSV
 * with a column mapping).
 * 201 { run, created, missing_case_ids, skipped_locked } · 200 dry run { ok, problems, lines, missing_case_ids, skipped_locked }
 * 422 { problems: [{line, message}] } (nothing imported) · 423 held-out case before reveal · 409 cases changed
 * 413 file too large
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[agentId]/import">) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      const { agentId } = await ctx.params;
      // The body is the file JSON-encoded (quotes and newlines escaped), so allow for that; parseImport checks the real size.
      if (Number(req.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES * 2) {
        return fail(413, `The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split it into smaller imports.`);
      }
      const raw = await req.json().catch(() => null);
      const agent = await getAgent(agentId);
      const lock = await getLockState(agent);
      const dry = DryRun.safeParse(raw);
      if (dry.success) {
        let src;
        try {
          src = toJsonl(dry.data, agent, lock);
        } catch (e) {
          if (e instanceof ImportValidationError) return ok({ ok: false, problems: e.problems, lines: 0, missing_case_ids: [], skipped_locked: [] });
          throw e;
        }
        const p = parseImport(src.text, agent, lock);
        return ok({ ok: p.problems.length === 0, problems: p.problems, lines: p.lines.length, missing_case_ids: p.missing_case_ids, skipped_locked: src.skipped_locked });
      }
      const body = Body.parse(raw);
      const src = toJsonl(body, agent, lock);
      const res = await importRun({ agent, text: src.text, agent_version: body.agent_version, actor: body.actor, notes: body.notes ?? null });
      return ok({ ...res, skipped_locked: src.skipped_locked }, { status: res.created ? 201 : 200 });
    }),
  );
}
