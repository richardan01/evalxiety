import { connection } from "next/server";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { getAgent } from "@/lib/agents/config";
import { MAX_IMPORT_BYTES, parseImport } from "@/lib/agents/ingest";
import { getLockState, importRun } from "@/lib/agents/runs";

/** "Check file": only validates, saves nothing, so it needs no name or version label. */
const DryRun = z.object({
  text: z.string().min(1, "paste or upload a JSONL file"),
  dry_run: z.literal(true),
});

const Body = z.object({
  text: z.string().min(1, "paste or upload a JSONL file"),
  agent_version: z.string().trim().min(1, "name the version that produced these traces (e.g. prompt-v2)").max(100),
  actor: z.string().trim().min(1, "a named person (actor) is required"),
  notes: z.string().trim().max(2000).optional(),
  dry_run: z.literal(false).optional(),
});

/**
 * POST /api/agents/:agentId/import — import one run of traces (JSONL, one trace per line).
 * 201 { run, created, missing_case_ids } · 200 dry run { ok, problems, lines, missing_case_ids }
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
      const dry = DryRun.safeParse(raw);
      if (dry.success) {
        const p = parseImport(dry.data.text, agent, await getLockState(agent));
        return ok({ ok: p.problems.length === 0, problems: p.problems, lines: p.lines.length, missing_case_ids: p.missing_case_ids });
      }
      const body = Body.parse(raw);
      const res = await importRun({ agent, text: body.text, agent_version: body.agent_version, actor: body.actor, notes: body.notes ?? null });
      return ok(res, { status: res.created ? 201 : 200 });
    }),
  );
}
