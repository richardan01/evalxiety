/**
 * Route-level test for /api/taxonomy, /api/annotations/categorize and /api/gold
 * against a temp data directory.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));

import { listAudit, saveTrace, upsertAnnotation } from "@/lib/storage/repos";
import { makeTrace } from "@/lib/testing/fixtures";
import * as taxonomyRoute from "@/app/api/taxonomy/route";
import * as categorizeRoute from "@/app/api/annotations/categorize/route";
import * as goldRoute from "@/app/api/gold/route";
import type { TaxonomyApiResponse, TaxonomyPostResponse } from "../taxonomy/types";
import type { GoldApiResponse } from "./types";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-review-routes-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const post = (body: unknown) => new Request("http://test/api", { method: "POST", body: JSON.stringify(body) });
async function json<T>(res: Response): Promise<{ status: number; body: T }> {
  return { status: res.status, body: (await res.json()) as T };
}

describe("taxonomy + categorize + gold routes", () => {
  it("runs the axial-coding → gold workflow with validation and audit", async () => {
    const trace = makeTrace("C01", undefined, { execution_mode: "mock" });
    await saveTrace(trace);
    const ann = await upsertAnnotation({
      trace_id: trace.trace_id,
      case_id: trace.case_id,
      reviewer: "Dana",
      open_coding_notes: "Quoted a promo that ended last month.",
      task_outcome: "fail",
      first_failure: { description: "Applied an expired promotion", failure_mode_id: null },
      additional_failure_mode_ids: [],
      severity: "major",
      unsupported_justification_label: "present",
      taxonomy_version: null,
    });

    // Seed taxonomy: hypotheses, zero observations, one uncategorised note.
    let tax = await json<TaxonomyApiResponse>(await taxonomyRoute.GET());
    expect(tax.status).toBe(200);
    expect(tax.body.version).toBe(1);
    expect(tax.body.reviewed_trace_count).toBe(1);
    expect(tax.body.frequencies.every((f) => f.any_count === 0)).toBe(true);
    expect(tax.body.trace_modes[trace.trace_id]).toBe("mock");

    // Validation: author + change note required; op errors → 400.
    expect((await taxonomyRoute.POST(post({ author: "", change_note: "x", op: { type: "retire", failure_mode_id: "wrong_policy_version" } }))).status).toBe(400);
    expect((await taxonomyRoute.POST(post({ author: "Dana", change_note: "x", op: { type: "retire", failure_mode_id: "ghost" } }))).status).toBe(400);

    const added = await json<TaxonomyPostResponse>(
      await taxonomyRoute.POST(
        post({ author: "Dana", change_note: "From note", op: { type: "add", name: "Expired promotion applied", definition: "Applies a promotion outside its window.", severity: "major" } }),
      ),
    );
    expect(added.status).toBe(200);
    expect(added.body.taxonomy_version.version).toBe(2);

    // Categorize: actor required, unknown annotation 404, then success.
    expect((await categorizeRoute.POST(post({ annotation_id: ann.annotation_id, actor: " ", first_failure_mode_id: null }))).status).toBe(400);
    expect((await categorizeRoute.POST(post({ annotation_id: "nope", actor: "Dana", first_failure_mode_id: null }))).status).toBe(404);
    const cat = await categorizeRoute.POST(
      post({ annotation_id: ann.annotation_id, actor: "Lee", first_failure_mode_id: added.body.failure_mode_id }),
    );
    expect(cat.status).toBe(200);
    const saved = (await cat.json()).annotation;
    expect(saved).toMatchObject({ reviewer: "Dana", annotation_id: ann.annotation_id, task_outcome: "fail", taxonomy_version: 2 });
    expect(saved.first_failure.description).toBe("Applied an expired promotion");

    tax = await json<TaxonomyApiResponse>(await taxonomyRoute.GET());
    const f = tax.body.frequencies.find((x) => x.failure_mode_id === added.body.failure_mode_id)!;
    expect(f).toMatchObject({ first_failure_count: 1, any_count: 1 });
    expect(tax.body.failure_modes.find((m) => m.failure_mode_id === added.body.failure_mode_id)!.status).toBe("observed");

    // Attach representative trace: allowed only for an observed trace.
    expect(
      (await taxonomyRoute.POST(post({ author: "Dana", change_note: "rep", op: { type: "attach_trace", failure_mode_id: "wrong_policy_version", trace_id: trace.trace_id } }))).status,
    ).toBe(400);
    expect(
      (await taxonomyRoute.POST(post({ author: "Dana", change_note: "rep", op: { type: "attach_trace", failure_mode_id: added.body.failure_mode_id, trace_id: trace.trace_id } }))).status,
    ).toBe(200);

    // Gold: candidate → promote → gone → annotation edited → candidate again → remove.
    let gold = await json<GoldApiResponse>(await goldRoute.GET());
    expect(gold.body.candidates).toHaveLength(1);
    expect(gold.body.candidates[0]).toMatchObject({ split: "dev", execution_mode: "mock", reason: "not_promoted" });
    expect(gold.body.candidates[0].expected_behavior?.text).toContain("Select");
    expect((await goldRoute.POST(post({ action: "promote", annotation_id: ann.annotation_id, promoted_by: "" }))).status).toBe(400);
    const promoted = await goldRoute.POST(post({ action: "promote", annotation_id: ann.annotation_id, promoted_by: "Dana", expected_behavior: "Decline." }));
    expect(promoted.status).toBe(200);
    const g = (await promoted.json()).gold;
    expect(g).toMatchObject({ expected_behavior: "Decline.", failure_mode_ids: [added.body.failure_mode_id], trace_execution_mode: "mock" });

    gold = await json<GoldApiResponse>(await goldRoute.GET());
    expect(gold.body.candidates).toHaveLength(0);
    expect(gold.body.gold).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 5));
    await upsertAnnotation({ ...saved, open_coding_notes: "Edited after promotion" });
    gold = await json<GoldApiResponse>(await goldRoute.GET());
    expect(gold.body.candidates[0]?.reason).toBe("annotation_updated_since_promotion");

    expect((await goldRoute.POST(post({ action: "remove", gold_id: "missing", actor: "Dana" }))).status).toBe(404);
    expect((await goldRoute.POST(post({ action: "remove", gold_id: g.gold_id, actor: "Dana" }))).status).toBe(200);
    gold = await json<GoldApiResponse>(await goldRoute.GET());
    expect(gold.body.gold).toHaveLength(0);

    const actions = (await listAudit()).map((e) => `${e.actor}:${e.action}`);
    expect(actions).toEqual(
      expect.arrayContaining(["Dana:taxonomy.add", "Lee:annotation.categorized", "Dana:taxonomy.attach_trace", "Dana:gold.promoted", "Dana:gold.removed"]),
    );
  });
});
