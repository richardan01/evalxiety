/**
 * Route-level tests for /api/agents/** (mock mode, temp data and agents dirs). The HTTP-run test calls the real
 * starter-kit agent server over the network on a spare port.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { NextRequest } from "next/server";

const pending: Array<Promise<unknown>> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined, after: (fn: () => unknown) => pending.push(Promise.resolve(fn())) };
});

import { GET as listAgents } from "./route";
import { GET as getAgent } from "./[agentId]/route";
import { POST as postImport } from "./[agentId]/import/route";
import { POST as postRun } from "./[agentId]/run/route";
import { GET as getRun } from "./[agentId]/runs/[runId]/route";
import { GET as getTrace } from "./[agentId]/traces/[traceId]/route";
import { POST as postAnnotation } from "./[agentId]/annotations/route";
import { POST as postJudge } from "./[agentId]/judge/route";
import { POST as postHeldout } from "./[agentId]/heldout/route";
import { POST as postApprove } from "./[agentId]/approve/route";
import { GET as getAudit } from "./[agentId]/audit/route";

const STARTER = path.join(process.cwd(), "agents", "example-support-bot");
const ID = "example-support-bot";
let dataDir: string;
let agentsDir: string;
let server: ChildProcess;
let port: number;

const req = (url: string, body?: unknown) =>
  new NextRequest(new URL(url, "http://localhost"), body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const read = (f: string) => fs.readFile(path.join(STARTER, f), "utf8");

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-routes-data-"));
  agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-routes-agents-"));
  process.env.AGENTTRUST_DATA_DIR = dataDir;
  process.env.EVALXIETY_AGENTS_DIR = agentsDir;
  process.env.MOCK_MODE = "true";
  port = await freePort();
  const dest = path.join(agentsDir, ID);
  await fs.mkdir(dest, { recursive: true });
  await fs.copyFile(path.join(STARTER, "cases.jsonl"), path.join(dest, "cases.jsonl"));
  const cfg = JSON.parse(await read("agent.json"));
  cfg.connection.url = `http://127.0.0.1:${port}/answer`;
  await fs.writeFile(path.join(dest, "agent.json"), JSON.stringify(cfg));
  server = spawn(process.execPath, [path.join(STARTER, "server.mjs"), "--version=v2"], { env: { ...process.env, EXAMPLE_AGENT_PORT: String(port) }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    const up = await fetch(`http://127.0.0.1:${port}/answer`, { method: "POST", body: "{}" }).then(() => true, () => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
});
afterAll(async () => {
  server?.kill();
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(agentsDir, { recursive: true, force: true });
});

describe("/api/agents", () => {
  it("lists agents and reports the folder", async () => {
    const { status, body } = await json(await listAgents());
    expect(status).toBe(200);
    expect(body.agents.map((a: { agent_id: string }) => a.agent_id)).toEqual([ID]);
    expect(body.agents_dir).toBe(agentsDir);
  });

  it("404s an unknown or malformed agent id", async () => {
    expect((await getAgent(req("/api/agents/nope"), ctx({ agentId: "nope" }))).status).toBe(404);
    expect((await getAgent(req("/api/agents/..%2F"), ctx({ agentId: "../etc" }))).status).toBe(404);
  });
});

describe("import", () => {
  const url = `/api/agents/${ID}/import`;
  it("dry run reports problems without saving", async () => {
    // "Check file" needs no name or version label.
    const { status, body } = await json(await postImport(req(url, { text: '{"case_id":"c01","output":1}\n{"case_id":"zz","output":1}', dry_run: true }), ctx({ agentId: ID })));
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.problems[0].line).toBe(2);
    expect(body.missing_case_ids).toContain("c02");
  });

  it("422 with line numbers; 423 for a held-out case", async () => {
    const bad = await json(await postImport(req(url, { text: "nope", agent_version: "v1", actor: "t" }), ctx({ agentId: ID })));
    expect(bad.status).toBe(422);
    expect(bad.body.problems[0]).toMatchObject({ line: 1 });
    const held = await postImport(req(url, { text: '{"case_id":"h01","output":"x"}', agent_version: "v1", actor: "t" }), ctx({ agentId: ID }));
    expect(held.status).toBe(423);
  });

  it("a spreadsheet is matched to cases by question text; locked final-exam rows are left out, not imported", async () => {
    const sheet = [
      "Question\tBot answer",
      "how do I reset my  password?\tGo to Settings → Security.",
      "How much does the Team plan cost?\t$12 per user per month.",
      "Can I get my money back for this month? I'm on the monthly plan.\tNo, monthly plans aren't refundable.",
    ].join("\n");
    const mapping = { answer: 1, question: 0 };
    const ok = await json(await postImport(req(url, { text: sheet, format: "csv", mapping, dry_run: true }), ctx({ agentId: ID })));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, lines: 2, skipped_locked: ["h01"] });
    expect(ok.body.missing_case_ids).toContain("c02");

    const unknown = await json(await postImport(req(url, { text: "question,answer\nWho are you?,A bot", format: "csv", mapping, dry_run: true }), ctx({ agentId: ID })));
    expect(unknown.body.ok).toBe(false);
    expect(unknown.body.problems[0]).toMatchObject({ line: 2 });
    expect(unknown.body.problems[0].message).toMatch(/No test case has the question “Who are you\?”/);

    // Nothing is imported when a row doesn't match, and a missing mapping is a problem, not a crash.
    const bad = await json(await postImport(req(url, { text: "question,answer\nWho are you?,A bot", format: "csv", mapping, agent_version: "sheet", actor: "t" }), ctx({ agentId: ID })));
    expect(bad.status).toBe(422);
    const noMap = await json(await postImport(req(url, { text: sheet, format: "csv", dry_run: true }), ctx({ agentId: ID })));
    expect(noMap.body.problems[0].message).toMatch(/Pick the answer column/);
  });

  it("400 when the actor or version is missing", async () => {
    expect((await postImport(req(url, { text: "x", agent_version: "", actor: "t" }), ctx({ agentId: ID }))).status).toBe(400);
    expect((await postImport(req(url, { text: "x", agent_version: "v1", actor: " " }), ctx({ agentId: ID }))).status).toBe(400);
  });

  it("201 on import, 200 on the identical re-import", async () => {
    const text = await read("traces.v1-baseline.jsonl");
    const first = await json(await postImport(req(url, { text, agent_version: "v1", actor: "t" }), ctx({ agentId: ID })));
    expect(first.status).toBe(201);
    const again = await json(await postImport(req(url, { text, agent_version: "v1", actor: "t" }), ctx({ agentId: ID })));
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
  });
});

describe("HTTP run against the real starter-kit server", () => {
  const url = `/api/agents/${ID}/run`;
  it("409 asks for confirmation with an estimate", async () => {
    const { status, body } = await json(await postRun(req(url, { agent_version: "v2", actor: "t" }), ctx({ agentId: ID })));
    expect(status).toBe(409);
    expect(body.confirmation_required).toBe(true);
    expect(body.estimate).toEqual({ calls: 9, cost_per_call_usd: 0, estimated_usd: 0, host: `127.0.0.1:${port}`, env_sent: [] });
  });

  it("202, then every visible case gets a trace from the agent", async () => {
    const { status, body } = await json(await postRun(req(url, { agent_version: "v2", actor: "t", confirm_batch: true }), ctx({ agentId: ID })));
    expect(status).toBe(202);
    expect(body.run.status).toBe("running");
    await Promise.all(pending);
    const run = await json(await getRun(req(`/api/agents/${ID}/runs/x`), ctx({ agentId: ID, runId: body.run.run_id })));
    expect(run.body.run.status).toBe("completed");
    expect(run.body.summary.n_with_trace).toBe(9);
    expect(run.body.summary.pass_all_count).toBe(8);
    const c09 = run.body.cases.find((c: { case_id: string }) => c.case_id === "c09");
    expect(c09.failed_evaluators).toEqual(["escalates_when_required"]);
  });

  it("the overview compares the HTTP run (candidate) with the imported run (baseline)", async () => {
    const { body } = await json(await getAgent(req(`/api/agents/${ID}`), ctx({ agentId: ID })));
    expect(body.runs.map((r: { execution_mode: string }) => r.execution_mode)).toEqual(["http", "imported"]);
    expect(body.gate.comparison.fixed.length).toBe(7);
    expect(body.gate.comparison.regressed).toEqual(["c09"]);
    expect(body.gate.comparison.new_critical_regressions).toEqual([{ case_id: "c09", evaluator_id: "escalates_when_required" }]);
  });
});

describe("review, judge, reveal, approve, audit", () => {
  it("annotation: 400 without fail details, 201 then 200 on update", async () => {
    const ov = (await json(await getAgent(req(`/api/agents/${ID}`), ctx({ agentId: ID })))).body;
    const traceId = ov.runs[0].trace_ids.c01;
    const url = `/api/agents/${ID}/annotations`;
    expect((await postAnnotation(req(url, { trace_id: traceId, reviewer: "Rich", task_outcome: "fail" }), ctx({ agentId: ID }))).status).toBe(400);
    expect((await postAnnotation(req(url, { trace_id: "atr_missing", reviewer: "Rich", task_outcome: "pass" }), ctx({ agentId: ID }))).status).toBe(404);
    expect((await postAnnotation(req(url, { trace_id: traceId, reviewer: "Rich", task_outcome: "pass" }), ctx({ agentId: ID }))).status).toBe(201);
    expect((await postAnnotation(req(url, { trace_id: traceId, reviewer: "Rich", task_outcome: "pass", notes: "fine" }), ctx({ agentId: ID }))).status).toBe(200);
    const t = (await json(await getTrace(req(`/api/agents/${ID}/traces/${traceId}?reviewer=Rich`), ctx({ agentId: ID, traceId })))).body;
    expect(t.my_annotation.notes).toBe("fine");
    expect(t.queue.items).toHaveLength(9);
  });

  it("judge runs in mock mode on example traces", async () => {
    const ov = (await json(await getAgent(req(`/api/agents/${ID}`), ctx({ agentId: ID })))).body;
    const { status, body } = await json(await postJudge(req(`/api/agents/${ID}/judge`, { run_id: ov.runs[0].run_id, actor: "t" }), ctx({ agentId: ID })));
    expect(status).toBe(200);
    expect(body.judged).toBe(9);
  });

  it("held-out reveal is audited and happens once", async () => {
    const url = `/api/agents/${ID}/heldout`;
    const ids = ["h01", "h02", "h03"];
    expect((await postHeldout(req(url, { actor: "t", reason: "short", case_ids: ids }), ctx({ agentId: ID }))).status).toBe(400);
    // The reveal must name exactly the cases still locked (what the person saw on the button).
    const partial = await json(await postHeldout(req(url, { actor: "t", reason: "done tuning prompt v2", case_ids: ["h01"] }), ctx({ agentId: ID })));
    expect(partial.status).toBe(409);
    expect(partial.body.error).toMatch(/changed since the page loaded/);
    expect((await postHeldout(req(url, { actor: "t", reason: "done tuning prompt v2", case_ids: ids }), ctx({ agentId: ID }))).status).toBe(200);
    expect((await postHeldout(req(url, { actor: "t", reason: "done tuning prompt v2", case_ids: ids }), ctx({ agentId: ID }))).status).toBe(409);
  });

  it("approval of a not-eligible candidate is refused", async () => {
    const ov = (await json(await getAgent(req(`/api/agents/${ID}`), ctx({ agentId: ID })))).body;
    const res = await postApprove(
      req(`/api/agents/${ID}/approve`, { approver: "Rich", decision: "approved", candidate_run_id: ov.selected.candidate, baseline_run_id: ov.selected.baseline, evidence_snapshot_hash: ov.evidence_snapshot_hash }),
      ctx({ agentId: ID }),
    );
    expect(res.status).toBe(409);
  });

  it("audit log lists what happened, newest first", async () => {
    const { body } = await json(await getAudit(req(`/api/agents/${ID}/audit`), ctx({ agentId: ID })));
    const actions = body.events.map((e: { action: string }) => e.action);
    expect(actions[0]).toBe("heldout_revealed");
    expect(actions).toEqual(expect.arrayContaining(["run_imported", "http_run_started", "http_run_completed", "annotation_created", "judge_batch", "frozen_version_created"]));
  });
});
