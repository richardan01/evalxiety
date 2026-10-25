/**
 * Defining "good" from the agent page, through the real routes: rules can be added only once they fail at least once,
 * cases can be added, edited and removed (never a locked final-exam case, whose content is never returned), the AI
 * reviewer question can be set, and the starter kit and the connection are never written. Own temp data and agents dirs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});
import { GET as getDefinition } from "./[agentId]/definition/route";
import { POST as postRules } from "./[agentId]/rules/route";
import { POST as postCases } from "./[agentId]/cases/route";
import { POST as postJudge } from "./[agentId]/judge-config/route";
import { POST as postImport } from "./[agentId]/import/route";
import { POST as postFreeze } from "./[agentId]/freeze/route";
import { listAgentAudit } from "@/lib/agents/repo";

const STARTER = path.join(process.cwd(), "agents", "example-support-bot");
const ID = "help-desk";
const CONNECTION = { type: "http", url: "https://agent.example.com/answer", headers: { Authorization: "Bearer ${env:EVALXIETY_AGENT_HELP_DESK_TOKEN}" } };
let dataDir: string;
let agentsDir: string;

const req = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = (agentId = ID) => ({ params: Promise.resolve({ agentId }) });
// Every agent route takes the same { params: { agentId } }; the generated per-route context types just don't say so.
type Handler = (req: Request, ctx: { params: Promise<{ agentId: string }> }) => Promise<Response>;
const call = async (fn: Handler, route: string, body: unknown, agentId = ID) => {
  const res = await fn(req(`/api/agents/${agentId}/${route}`, body), params(agentId));
  return { status: res.status, body: await res.json() };
};
const rules = (body: unknown, agentId = ID) => call(postRules as Handler, "rules", body, agentId);
const cases = (body: unknown, agentId = ID) => call(postCases as Handler, "cases", body, agentId);
const judge = (body: unknown, agentId = ID) => call(postJudge as Handler, "judge-config", body, agentId);
const definition = async (agentId = ID) => (await getDefinition(new Request(`http://localhost/api/agents/${agentId}/definition`), params(agentId))).json();
const agentJson = async () => JSON.parse(await fs.readFile(path.join(agentsDir, ID, "agent.json"), "utf8"));
const casesText = () => fs.readFile(path.join(agentsDir, ID, "cases.jsonl"), "utf8");

const PROMISES = { id: "no_promises", type: "regex", question: "Does the answer avoid promising outcomes?", field: "answer", pattern: "\\b(pinky promise|cross my heart)\\b", flags: "i", must: "no_match", severity: "major" };

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-define-data-"));
  agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-define-agents-"));
  process.env.AGENTTRUST_DATA_DIR = dataDir;
  process.env.EVALXIETY_AGENTS_DIR = agentsDir;
  process.env.MOCK_MODE = "true";
  delete process.env.ANTHROPIC_API_KEY;
  // A copy of the starter kit's starter files under a real (non-example) agent, plus the starter kit itself.
  for (const id of [ID, "example-support-bot"]) await fs.mkdir(path.join(agentsDir, id), { recursive: true });
  await fs.copyFile(path.join(STARTER, "agent.json"), path.join(agentsDir, "example-support-bot", "agent.json"));
  await fs.copyFile(path.join(STARTER, "cases.jsonl"), path.join(agentsDir, "example-support-bot", "cases.jsonl"));
  await fs.writeFile(path.join(agentsDir, ID, "cases.jsonl"), `// Help-desk questions\n${await fs.readFile(path.join(STARTER, "cases.jsonl"), "utf8")}`);
  await fs.writeFile(
    path.join(agentsDir, ID, "agent.json"),
    JSON.stringify({ name: "Help desk", _comment: "kept as written", connection: CONNECTION, checks: [{ id: "answers", type: "non_empty", field: "answer", question: "Does it answer?" }] }, null, 2),
  );
  // One test of the agent: the starter kit's first version's answers.
  const text = await fs.readFile(path.join(STARTER, "traces.v1-baseline.jsonl"), "utf8");
  const imported = await call(postImport as Handler, "import", { text, agent_version: "v1", actor: "Priya" });
  expect(imported.status).toBe(201);
});
afterAll(async () => {
  delete process.env.EVALXIETY_AGENTS_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(agentsDir, { recursive: true, force: true });
});

let base: string;
beforeEach(async () => {
  base = (await definition()).definition_hash;
});

describe("the definition", () => {
  it("lists rules, answer fields and cases, without a locked final-exam case's content or the connection", async () => {
    const d = await definition();
    expect(d.editable).toBe(true);
    expect(d.answers.kind).toBe("json");
    expect(d.answers.fields.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(["answer", "citations", "escalate"]));
    expect(d.input_shape).toEqual({ kind: "field", key: "question" });
    const h01 = d.cases.find((c: { case_id: string }) => c.case_id === "h01");
    expect(h01).toMatchObject({ split: "heldout", locked: true, input: null, expected: null });
    expect(JSON.stringify(d)).not.toContain("money back");
    expect(JSON.stringify(d)).not.toContain("agent.example.com");
    expect(d.cases.find((c: { case_id: string }) => c.case_id === "c01")).toMatchObject({ input: { question: "How do I reset my password?" }, locked: false });
  });
});

describe("rules", () => {
  it("previews a rule on the latest test's answers without saving it", async () => {
    const before = await agentJson();
    const { status, body } = await rules({ action: "preview", rule: { ...PROMISES, id: "x", pattern: "\\bvalue you\\b" } });
    expect(status).toBe(200);
    expect(body.run.agent_version).toBe("v1");
    expect(body.counts.fail).toBeGreaterThan(0);
    expect(body.proven).toBe(true);
    expect(body.proven_by).toMatchObject({ kind: "answer" });
    expect(body.results.find((r: { outcome: string }) => r.outcome === "FAIL").answer).toMatch(/value you/);
    expect(await agentJson()).toEqual(before);
  });

  it("refuses to add a rule that never fails, and adds it once a bad answer proves it can", async () => {
    const neverFails = await rules({ action: "add", actor: "Priya", base, rule: PROMISES });
    expect(neverFails.status).toBe(422);
    expect(neverFails.body.error).toMatch(/hasn't failed on anything yet/);
    expect(neverFails.body.preview.counts.fail).toBe(0);
    expect((await agentJson()).checks).toHaveLength(1);

    const added = await rules({ action: "add", actor: "Priya", base, rule: PROMISES, probe: { answer: "I pinky promise a refund." }, drafted_by_ai: true });
    expect(added.status).toBe(201);
    expect(added.body.proven_by).toEqual({ kind: "probe", case_id: "c01" });
    const json = await agentJson();
    expect(json.checks.map((c: { id: string }) => c.id)).toEqual(["answers", "no_promises"]);
    // Nothing else in agent.json moved: not the connection, not the comment.
    expect(json.connection).toEqual(CONNECTION);
    expect(json._comment).toBe("kept as written");
    const audit = (await listAgentAudit(ID)).filter((e) => e.action === "rule_added");
    expect(audit.at(-1)).toMatchObject({ actor: "Priya", details: { proven_by: { kind: "probe" }, probe_answer: "I pinky promise a refund.", drafted_by_ai: true } });
  });

  it("doesn't count a failure caused only by a misspelled field as proof", async () => {
    const typo = { id: "has_anwser", type: "non_empty", field: "anwser", question: "Is the answer filled in?", severity: "major" };
    const { body } = await rules({ action: "preview", rule: typo });
    expect(body.counts.fail).toBe(body.results.length);
    expect(body.proven).toBe(false);
    expect(body.warnings.join(" ")).toMatch(/None of the answers has “anwser”/);
    // The probe for "must fill in a field" blanks that field, which does prove a correctly named rule.
    const ok = await rules({ action: "preview", rule: { ...typo, id: "has_citations", field: "citations" }, probe: { answer: "x" } });
    expect(ok.body.probe).toMatchObject({ outcome: "FAIL", counts_as_proof: true });
  });

  it("never counts a bad answer as proof for a field no real answer has (a typo)", async () => {
    // The bad answer is built around the field, so it "fails"; with no real answer having the field, that proves nothing.
    const typo = { id: "has_anwser", type: "non_empty", field: "anwser", question: "Is the answer filled in?", severity: "critical" };
    const probe = await rules({ action: "add", actor: "Priya", base, rule: typo, probe: { answer: "x" } });
    expect(probe.status).toBe(422);
    expect(probe.body.preview.probe.counts_as_proof).toBe(false);
    const must = { id: "says_sorry", type: "regex", field: "anwser", pattern: "sorry", flags: "i", must: "match", question: "Does it apologise?", severity: "minor" };
    expect((await rules({ action: "preview", rule: must, probe: { answer: "no apology" } })).body.proven).toBe(false);
    const fields = { id: "shape", type: "json_output", required_fields: ["answer", "citatoins"], question: "Is the answer complete?", severity: "major" };
    const json = await rules({ action: "preview", rule: fields });
    expect(json.body.counts.fail).toBe(json.body.results.length);
    expect(json.body.proven).toBe(false);
    expect(json.body.warnings.join(" ")).toMatch(/None of the answers has “citatoins”/);
  });

  it("doesn't count text answers compared with structured reference answers as proof", async () => {
    const rule = { id: "same", type: "matches_expected", field: "answer", expected_field: "", mode: "exact", question: "Is it the reference answer?", severity: "major" };
    const { body } = await rules({ action: "preview", rule, probe: { answer: "anything" } });
    expect(body.counts.fail).toBeGreaterThan(0);
    expect(body.proven).toBe(false);
    expect(body.warnings.join(" ")).toMatch(/reference answers are structured \(escalate\)/);
  });

  it("proves time, cost and tool-error limits with a bad answer, and refuses a probe on a locked case", async () => {
    const slow = await rules({ action: "preview", rule: { id: "fast", type: "max_latency_ms", max: 3000, question: "Does it answer within 3 s?" }, probe: { answer: "9 s" } });
    expect(slow.body.probe).toMatchObject({ outcome: "FAIL", counts_as_proof: true });
    const cost = await rules({ action: "preview", rule: { id: "cheap", type: "max_cost_usd", max: 0.1, question: "Does it cost at most 10 cents?" }, probe: { answer: "$0.50" } });
    expect(cost.body.probe).toMatchObject({ outcome: "FAIL", counts_as_proof: true });
    expect((await rules({ action: "preview", rule: { id: "cheap", type: "max_cost_usd", max: 0.1, question: "Cheap?" }, probe: { answer: "a lot" } })).status).toBe(400);
    const tools = await rules({ action: "preview", rule: { id: "tools_ok", type: "no_tool_errors", question: "Do its tools work?" }, probe: { answer: "Timeout calling the orders API" } });
    expect(tools.body.probe).toMatchObject({ outcome: "FAIL", counts_as_proof: true });
    const locked = await rules({ action: "preview", rule: PROMISES, probe: { answer: "pinky promise", case_id: "h01" } });
    expect(locked.status).toBe(400);
  });

  it("refuses an invalid rule, a duplicate name and a custom rule", async () => {
    expect((await rules({ action: "preview", rule: { ...PROMISES, id: "bad", pattern: "(" } })).body.error).toMatch(/invalid pattern/);
    const dup = await rules({ action: "add", actor: "Priya", base, rule: { ...PROMISES, id: "answers" }, probe: { answer: "pinky promise" } });
    expect(dup.status).toBe(409);
    const custom = await rules({ action: "add", actor: "Priya", base, rule: { id: "c", type: "custom", function: "x", question: "Custom?" }, probe: { answer: "x" } });
    expect(custom.status).toBe(400);
    expect(custom.body.error).toMatch(/custom-checks\.ts/);
  });

  it("refuses an edit made on files that changed since the page loaded", async () => {
    const res = await rules({ action: "remove", actor: "Priya", base: "stale", id: "answers" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed since you opened the page/);
  });

  it("removes a rule, logged under a name", async () => {
    const res = await rules({ action: "remove", actor: "Priya", base, id: "no_promises" });
    expect(res.status).toBe(200);
    expect((await agentJson()).checks.map((c: { id: string }) => c.id)).toEqual(["answers"]);
    expect((await listAgentAudit(ID)).at(-1)).toMatchObject({ action: "rule_removed", actor: "Priya" });
  });

  it("drafting needs live mode, and says how to get it", async () => {
    const res = await rules({ action: "draft", actor: "Priya", request: "Never promise a refund." });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/needs a Claude API key/);
  });
});

describe("test cases", () => {
  it("adds cases with the next ids, keeping comments and other lines as they were", async () => {
    const before = await casesText();
    const res = await cases({
      action: "add",
      actor: "Priya",
      base,
      cases: [
        { input: { question: "Do you have a student discount?" }, expected: { escalate: false }, notes: "Pricing edge case" },
        { input: { question: "My card was charged twice." }, origin: "ai_drafted" },
      ],
    });
    expect(res.status).toBe(201);
    // Numbering continues from the most common prefix (c01–c09), not the held-out h01–h03.
    expect(res.body.added).toEqual(["c10", "c11"]);
    expect(res.body.needs_lock).toBe(true);
    expect(res.body.next_version).toBe(2);
    const after = await casesText();
    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length).trim().split("\n").map((l) => JSON.parse(l))).toEqual([
      { case_id: "c10", input: { question: "Do you have a student discount?" }, expected: { escalate: false }, notes: "Pricing edge case" },
      { case_id: "c11", input: { question: "My card was charged twice." }, origin: "ai_drafted" },
    ]);
  });

  it("edits a case's question and note, keeping its split and where it came from", async () => {
    const res = await cases({ action: "update", actor: "Priya", base, case_id: "c11", input: { question: "I was charged twice this month." }, expected: null, notes: "Billing" });
    expect(res.status).toBe(200);
    const line = (await casesText()).split("\n").find((l) => l.includes('"c11"'))!;
    expect(JSON.parse(line)).toEqual({ case_id: "c11", input: { question: "I was charged twice this month." }, notes: "Billing", origin: "ai_drafted" });
    expect((await listAgentAudit(ID)).at(-1)).toMatchObject({ action: "case_updated", details: { case_id: "c11", changed: ["input", "notes"] } });
  });

  it("changes only what was sent, and refuses a save that changes nothing", async () => {
    const before = (await casesText()).split("\n").find((l) => l.includes('"c11"'))!;
    const res = await cases({ action: "update", actor: "Priya", base: (await definition()).definition_hash, case_id: "c11", notes: "Billing, charged twice" });
    expect(res.status).toBe(200);
    const after = JSON.parse((await casesText()).split("\n").find((l) => l.includes('"c11"'))!);
    expect(after).toEqual({ ...JSON.parse(before), notes: "Billing, charged twice" });
    expect(res.body.needs_lock).toBe(true); // still from the earlier question changes, not from this note
    const none = await cases({ action: "update", actor: "Priya", base: res.body.definition_hash, case_id: "c11", notes: "Billing, charged twice" });
    expect(none.status).toBe(400);
  });

  it("refuses a question another case already asks, without saying which", async () => {
    const dev = await cases({ action: "add", actor: "Priya", base, cases: [{ input: { question: "How much does the Team plan cost?" } }] });
    expect(dev.status).toBe(409);
    // A final-exam question gets the same answer, so adding cases can't be used to find out what the exam asks.
    const exam = await cases({ action: "add", actor: "Priya", base, cases: [{ input: { question: "What uptime do enterprise customers get?" } }] });
    expect(exam.status).toBe(409);
    expect(exam.body.error).toBe(dev.body.error);
    expect(exam.body.error).not.toMatch(/h0|held|exam/i);
  });

  it("never changes or removes a locked final-exam case", async () => {
    const edit = await cases({ action: "update", actor: "Priya", base, case_id: "h01", input: { question: "peek" } });
    expect(edit.status).toBe(423);
    const remove = await cases({ action: "remove", actor: "Priya", base, case_id: "h01" });
    expect(remove.status).toBe(423);
    expect(await casesText()).toContain("money back");
  });

  it("adds a final-exam case that is locked from then on", async () => {
    const res = await cases({ action: "add", actor: "Priya", base, cases: [{ input: { question: "Secret exam question" }, split: "heldout" }] });
    expect(res.status).toBe(201);
    const d = await definition();
    expect(d.cases.find((c: { case_id: string }) => c.case_id === res.body.added[0])).toMatchObject({ split: "heldout", locked: true, input: null });
  });

  it("removes a practice case, and the next lock records the new set", async () => {
    const res = await cases({ action: "remove", actor: "Priya", base, case_id: "c10" });
    expect(res.status).toBe(200);
    expect(await casesText()).not.toContain('"c10"');
    const frozen = await call(postFreeze as Handler, "freeze", { actor: "Priya", note: "Added billing questions" });
    expect(frozen.body.version.version).toBe(2);
  });
});

describe("answers that no longer fit their case", () => {
  it("leaves out answers to an older wording, and never hands a removed case's id to a new question", async () => {
    const id = "small-bot";
    await fs.mkdir(path.join(agentsDir, id));
    await fs.writeFile(path.join(agentsDir, id, "agent.json"), JSON.stringify({ name: "Small bot", checks: [{ id: "answers", type: "non_empty", question: "Answers?" }] }));
    await fs.writeFile(path.join(agentsDir, id, "cases.jsonl"), ["a", "b", "c"].map((q, i) => JSON.stringify({ case_id: `c0${i + 1}`, input: q })).join("\n") + "\n");
    const text = ["c01", "c02", "c03"].map((c) => JSON.stringify({ case_id: c, output: `answer to ${c} pinky promise` })).join("\n");
    expect((await call(postImport as Handler, "import", { text, agent_version: "v1", actor: "Priya" }, id)).status).toBe(201);

    let h = (await definition(id)).definition_hash;
    const edited = await cases({ action: "update", actor: "Priya", base: h, case_id: "c01", input: "a, reworded" }, id);
    expect(edited.status).toBe(200);
    const preview = await rules({ action: "preview", rule: { ...PROMISES, field: "" } }, id);
    expect(preview.body.results.map((r: { case_id: string }) => r.case_id)).toEqual(["c02", "c03"]);
    expect(preview.body.warnings.join(" ")).toMatch(/1 answer\(s\) in this test were to an older wording/);

    h = edited.body.definition_hash;
    const removed = await cases({ action: "remove", actor: "Priya", base: h, case_id: "c03" }, id);
    const added = await cases({ action: "add", actor: "Priya", base: removed.body.definition_hash, cases: [{ input: "d" }] }, id);
    expect(added.body.added).toEqual(["c04"]); // c03 was answered in v1, so it's never reused
  });
});

describe("the AI reviewer question", () => {
  it("sets, changes and removes it, each change a new version", async () => {
    const q = { question: "Does the answer state a fact the articles don't support?", fail_definition: "A fact is missing from the articles.", pass_definition: "Every fact is in the articles.", model: "claude-sonnet-5-5" };
    const set = await judge({ actor: "Priya", base, judge: q });
    expect(set.status).toBe(200);
    expect(set.body.previous_version).toBeNull();
    expect((await agentJson()).judge).toEqual(q);
    const changed = await judge({ actor: "Priya", base: set.body.definition_hash, judge: { ...q, question: "Does the answer state a price the articles don't support?" } });
    expect(changed.body.version).not.toBe(set.body.version);
    expect(changed.body.previous_version).toBe(set.body.version);
    const removed = await judge({ actor: "Priya", base: changed.body.definition_hash, judge: null });
    expect(removed.status).toBe(200);
    expect(await agentJson()).not.toHaveProperty("judge");
    expect((await agentJson()).connection).toEqual(CONNECTION);
  });
});

describe("the starter kit", () => {
  it("is read-only", async () => {
    const d = await definition("example-support-bot");
    expect(d.editable).toBe(false);
    const before = await fs.readFile(path.join(agentsDir, "example-support-bot", "agent.json"), "utf8");
    const res = await rules({ action: "remove", actor: "Priya", base: d.definition_hash, id: "concise_answer" }, "example-support-bot");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/starter kit/);
    expect((await cases({ action: "add", actor: "Priya", base: d.definition_hash, cases: [{ input: "x" }] }, "example-support-bot")).status).toBe(403);
    expect(await fs.readFile(path.join(agentsDir, "example-support-bot", "agent.json"), "utf8")).toBe(before);
  });
});
