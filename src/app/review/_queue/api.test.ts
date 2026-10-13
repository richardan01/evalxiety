/**
 * Route-level tests for the review API (mock mode, temp data dir).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { NextRequest } from "next/server";
import { makeTrace } from "@/lib/testing/fixtures";
import { appendTaxonomyVersion, latestTaxonomy, listAudit, saveTrace } from "@/lib/storage/repos";
import { mergeModes } from "@/lib/taxonomy/ops";
import { GET as getQueue } from "@/app/api/review/queue/route";
import { GET as listAnn, POST as postAnn } from "@/app/api/annotations/route";
import { GET as getEvals } from "@/app/api/traces/[id]/evaluations/route";
import { POST as postJudge } from "@/app/api/judge/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

let dir: string;
const dev = makeTrace("C01", undefined, { execution_mode: "mock" });
const held = makeTrace("C06", undefined, { execution_mode: "mock" });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-review-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
  await saveTrace(dev);
  await saveTrace(held);
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const validFail = {
  trace_id: dev.trace_id,
  reviewer: "Ada",
  open_coding_notes: "Quoted the requested rate without routing approval.",
  task_outcome: "fail",
  first_failure: { description: "No approval routed", failure_mode_id: "missing_human_approval" },
  additional_failure_mode_ids: [],
  severity: "critical",
  unsupported_justification_label: "absent",
  taxonomy_version: 1,
};

describe("review API", () => {
  it("lists every trace as unreviewed at first", async () => {
    const body = await (await getQueue()).json();
    expect(body.total).toBe(2);
    expect(body.reviewed_count).toBe(0);
  });

  it("rejects inconsistent or anonymous annotations", async () => {
    expect((await postAnn(post({ ...validFail, severity: null }))).status).toBe(400);
    expect((await postAnn(post({ ...validFail, reviewer: "  " }))).status).toBe(400);
    expect((await postAnn(post({ ...validFail, open_coding_notes: "" }))).status).toBe(400);
    expect((await postAnn(post({ ...validFail, task_outcome: "pass" }))).status).toBe(400);
    expect(
      (await postAnn(post({ ...validFail, first_failure: { description: "x", failure_mode_id: "no_such_mode" } }))).status,
    ).toBe(400);
    expect((await postAnn(post({ ...validFail, trace_id: "trace_missing" }))).status).toBe(404);
    expect((await postAnn(post({ ...validFail, case_id: "C02" }))).status).toBe(400);
  });

  it("creates then updates one human annotation per reviewer, and audits both", async () => {
    const r1 = await postAnn(post(validFail));
    expect(r1.status).toBe(201);
    const a1 = (await r1.json()).annotation;
    expect(a1).toMatchObject({ label_source: "human", case_id: "C01", reviewer: "Ada" });

    const r2 = await postAnn(post({ ...validFail, reviewer: " Ada ", severity: "major" }));
    expect(r2.status).toBe(200);
    expect((await r2.json()).annotation.annotation_id).toBe(a1.annotation_id);

    const list = await (await listAnn(new NextRequest(`http://localhost/api/annotations?trace_id=${dev.trace_id}`))).json();
    expect(list.annotations).toHaveLength(1);
    expect(list.annotations[0].severity).toBe("major");
    const saved = (await listAudit()).filter((e) => e.action === "annotation.saved");
    expect(saved.map((e) => e.details.created)).toEqual([true, false]);

    const q = await (await getQueue()).json();
    expect(q.reviewed_count).toBe(1);
  });

  it("rejects invalid JSON and newly assigned merged categories, but keeps already-recorded ones", async () => {
    const bad = await postAnn(new Request("http://localhost/api", { method: "POST", body: "{not json" }));
    expect(bad.status).toBe(400);

    const tax = await latestTaxonomy();
    await appendTaxonomyVersion("tester", "merge", mergeModes(tax.failure_modes, "missing_human_approval", "margin_guardrail_violation"));
    // Ada already recorded missing_human_approval: re-saving keeps it.
    expect((await postAnn(post({ ...validFail, taxonomy_version: 2 }))).status).toBe(200);
    // Grace assigns the merged id fresh: rejected with a pointer to the target.
    const r = await postAnn(post({ ...validFail, reviewer: "Grace", taxonomy_version: 2 }));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toContain("margin_guardrail_violation");
  });

  it("returns 4 deterministic results and runs the judge on one dev trace", async () => {
    const before = await (await getEvals(new NextRequest("http://localhost"), ctx(dev.trace_id))).json();
    expect(before.deterministic).toHaveLength(4);
    expect(before.judge_results).toEqual([]);
    expect(before.judge_call).toMatchObject({ mode: "mock", estimated_usd: 0, can_run: true });
    expect(before.judge_locked).toBeNull();

    expect((await postJudge(post({ trace_id: dev.trace_id, actor: "" }))).status).toBe(400);
    const res = await postJudge(post({ trace_id: dev.trace_id, actor: "Ada" }));
    expect(res.status).toBe(200);
    const { judge_result } = await res.json();
    expect(judge_result).toMatchObject({ label_source: "llm_judge", execution_mode: "mock", trace_id: dev.trace_id });

    const after = await (await getEvals(new NextRequest("http://localhost"), ctx(dev.trace_id))).json();
    expect(after.judge_results).toHaveLength(1);
    expect((await listAudit()).some((e) => e.action === "judge.run" && e.actor === "Ada")).toBe(true);
  });

  it("keeps judge results locked on held-out traces before the reveal", async () => {
    expect((await postJudge(post({ trace_id: held.trace_id, actor: "Ada" }))).status).toBe(409);
    const ev = await (await getEvals(new NextRequest("http://localhost"), ctx(held.trace_id))).json();
    expect(ev.judge_locked).not.toBeNull();
    expect(ev.judge_results).toEqual([]);
    expect(ev.deterministic).toHaveLength(4);
    expect((await getEvals(new NextRequest("http://localhost"), ctx("trace_missing"))).status).toBe(404);
  });
});
