/**
 * Reviewing through the real routes: "not sure" needs a note and isn't counted as a review, two reviewers' agreement and
 * disagreements reach the agent page and the release report, and the review queue knows what each person has marked.
 * Own temp data and agents dirs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});
import { POST as postImport } from "./[agentId]/import/route";
import { POST as postAnnotation } from "./[agentId]/annotations/route";
import { GET as getAgent } from "./[agentId]/route";
import { GET as getTrace } from "./[agentId]/traces/[traceId]/route";
import { reportMarkdown } from "@/lib/agents/report";

const STARTER = path.join(process.cwd(), "agents", "example-support-bot");
const ID = "review-bot";
let dataDir: string;
let agentsDir: string;
let traces: Record<string, string>;

const post = (fn: typeof postAnnotation, route: string, body: unknown) =>
  fn(new Request(`http://localhost/api/agents/${ID}/${route}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), {
    params: Promise.resolve({ agentId: ID }),
  });
const label = async (trace: string, reviewer: string, outcome: "pass" | "fail" | "unsure", over: Record<string, unknown> = {}) => {
  const res = await post(postAnnotation, "annotations", { trace_id: traces[trace], reviewer, task_outcome: outcome, ...over });
  return { status: res.status, body: await res.json() };
};
const overview = async () => (await getAgent(new NextRequest(`http://localhost/api/agents/${ID}`), { params: Promise.resolve({ agentId: ID }) })).json();

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-review-data-"));
  agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-review-agents-"));
  process.env.AGENTTRUST_DATA_DIR = dataDir;
  process.env.EVALXIETY_AGENTS_DIR = agentsDir;
  process.env.MOCK_MODE = "true";
  await fs.mkdir(path.join(agentsDir, ID));
  await fs.copyFile(path.join(STARTER, "cases.jsonl"), path.join(agentsDir, ID, "cases.jsonl"));
  await fs.writeFile(path.join(agentsDir, ID, "agent.json"), JSON.stringify({ name: "Review bot", checks: [{ id: "answers", type: "non_empty", field: "answer", question: "Answers?" }] }));
  const res = await post(postImport as unknown as typeof postAnnotation, "import", { text: await fs.readFile(path.join(STARTER, "traces.v1-baseline.jsonl"), "utf8"), agent_version: "v1", actor: "Priya" });
  traces = (await res.json()).run.trace_ids;
});
afterAll(async () => {
  delete process.env.EVALXIETY_AGENTS_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(agentsDir, { recursive: true, force: true });
});

describe("not sure", () => {
  it("needs a note saying what's unclear, and can't carry a failure", async () => {
    expect((await label("c01", "Priya", "unsure")).body.error).toMatch(/Say what makes it unclear/);
    expect((await label("c01", "Priya", "unsure", { notes: "x", first_failure: "y", severity: "major" })).status).toBe(400);
    expect((await label("c01", "Priya", "unsure", { notes: "Is a reset link a full answer?" })).status).toBe(201);
  });

  it("is shown but isn't counted as a review", async () => {
    await label("c02", "Priya", "pass");
    const ov = await overview();
    expect(ov.reviewed_trace_count).toBe(1);
    expect(ov.review.progress).toMatchObject({ total: 9, reviewed: 1, unsure: 1, open: 8 });
    expect(ov.review.next_trace_id).toBe(traces.c01);
  });
});

describe("two reviewers", () => {
  it("measures how often they agree and lists where they don't", async () => {
    await label("c01", "Alex", "fail", { first_failure: "Doesn't say the link expires", severity: "minor" });
    await label("c02", "Alex", "pass");
    await label("c03", "Priya", "pass");
    await label("c03", "Alex", "fail", { first_failure: "Wrong price", severity: "major" });
    const ov = await overview();
    // c01: Priya is unsure (not a verdict), so only c02 and c03 are shared: they agree on c02, disagree on c03.
    expect(ov.review.agreement).toMatchObject({ shared: 2, pairs: 2, agreeing: 1, rate: 0.5, reviewers: ["Alex", "Priya"], enough: false });
    expect(ov.review.agreement.disputes.map((d: { case_id: string }) => d.case_id)).toEqual(["c03"]);
    expect(ov.review.progress).toMatchObject({ reviewed: 3, unsure: 0, disputed: 1 });

    const md = reportMarkdown(ov);
    expect(md).toContain("- Reviewers (Alex, Priya) agree on 1 of 2 shared verdicts (50%");
    expect(md).toContain("Too few to rely on yet: 2 answers reviewed by two people, at least 10 needed.");
    expect(md).toContain("- They disagree on: c03 (Priya: pass, Alex: fail).");
  });

  it("knows which answers each reviewer has marked", async () => {
    const view = await (await getTrace(new NextRequest(`http://localhost/api/agents/${ID}/traces/${traces.c01}?reviewer=Alex`), { params: Promise.resolve({ agentId: ID, traceId: traces.c01 }) })).json();
    const mine = view.queue.items.filter((i: { mine: boolean }) => i.mine).map((i: { case_id: string }) => i.case_id);
    expect(mine).toEqual(["c01", "c02", "c03"]);
    expect(view.queue.progress.mine).toBe(3);
  });
});
