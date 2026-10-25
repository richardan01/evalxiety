/**
 * Importing a spreadsheet of answers saves a real test run (not just a dry run), matched by question text, with locked
 * final-exam rows left out. Own temp data and agents dirs.
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
import { GET as getAgent } from "./[agentId]/route";

const STARTER = path.join(process.cwd(), "agents", "example-support-bot");
const ID = "sheet-bot";
let dataDir: string;
let agentsDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-sheet-data-"));
  agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-sheet-agents-"));
  process.env.AGENTTRUST_DATA_DIR = dataDir;
  process.env.EVALXIETY_AGENTS_DIR = agentsDir;
  process.env.MOCK_MODE = "true";
  const dest = path.join(agentsDir, ID);
  await fs.mkdir(dest, { recursive: true });
  await fs.copyFile(path.join(STARTER, "cases.jsonl"), path.join(dest, "cases.jsonl"));
  await fs.writeFile(
    path.join(dest, "agent.json"),
    JSON.stringify({ name: "Sheet bot", checks: [{ id: "answers", type: "non_empty", question: "Does it answer?", severity: "major" }] }),
  );
});
afterAll(async () => {
  delete process.env.EVALXIETY_AGENTS_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(agentsDir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  postImport(new Request(`http://localhost/api/agents/${ID}/import`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), {
    params: Promise.resolve({ agentId: ID }),
  });

describe("spreadsheet import", () => {
  it("creates a run from question and answer columns", async () => {
    const cases = (await fs.readFile(path.join(STARTER, "cases.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { case_id: string; input: { question: string } });
    // Every question, quoted CSV, answers that contain commas; held-out rows included as a PM's export would.
    const csv = ["question,answer", ...cases.map((c) => `"${c.input.question.replace(/"/g, '""')}","Answer to ${c.case_id}, politely"`)].join("\n");
    const res = await post({ text: csv, format: "csv", mapping: { answer: 1, question: 0 }, agent_version: "v1", actor: "Priya" });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.skipped_locked.sort()).toEqual(["h01", "h02", "h03"]);
    expect(body.missing_case_ids).toEqual([]);
    expect(Object.keys(body.run.trace_ids).sort()).toEqual(cases.filter((c) => !c.case_id.startsWith("h")).map((c) => c.case_id).sort());

    const ov = await (await getAgent(new NextRequest(`http://localhost/api/agents/${ID}`), { params: Promise.resolve({ agentId: ID }) })).json();
    expect(ov.runs[0]).toMatchObject({ agent_version: "v1", created_by: "Priya", execution_mode: "imported" });
    expect(ov.runs[0].summary.pass_all_count).toBe(9);
  });
});
