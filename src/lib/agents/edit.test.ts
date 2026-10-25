/**
 * The agent-file editor's guarantees that the routes can't reach on their own: an edit that would leave a file the
 * loader rejects is refused with nothing written, and no edit can change the connection.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { configTextOf, definitionHash, editDefinition, EditError, readDefinition, serializeCase, withCaseRemoved, withCaseReplaced, withCasesAdded, withJudge, withoutRule, withRule } from "./edit";
import type { CheckConfig } from "./schemas";

const ID = "edit-bot";
let agentsDir: string;
let dataDir: string;
const CONFIG = { name: "Edit bot", connection: { type: "http", url: "https://agent.example.com/a", headers: {} }, checks: [{ id: "answers", type: "non_empty", question: "Answers?" }], judge: null, pass_all_threshold: 0.9 };
const CASES = '// comment\n{"case_id":"c01","input":"hi"}\n\n{"case_id":"c02","input":"bye","notes":"n"}\n';

beforeAll(async () => {
  agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-edit-agents-"));
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-edit-data-"));
  process.env.EVALXIETY_AGENTS_DIR = agentsDir;
  process.env.AGENTTRUST_DATA_DIR = dataDir;
  await fs.mkdir(path.join(agentsDir, ID));
  await fs.writeFile(path.join(agentsDir, ID, "agent.json"), JSON.stringify(CONFIG));
  await fs.writeFile(path.join(agentsDir, ID, "cases.jsonl"), CASES);
});
afterAll(async () => {
  delete process.env.EVALXIETY_AGENTS_DIR;
  await fs.rm(agentsDir, { recursive: true, force: true });
  await fs.rm(dataDir, { recursive: true, force: true });
});

const rule = (id: string): CheckConfig => ({ id, type: "max_length", question: "Short?", field: "", max_words: 50, severity: "minor", blocking: false });

describe("pure edits", () => {
  it("adds and removes rules by name", () => {
    const raw = { name: "x", checks: [rule("a")] };
    expect(withRule(raw, rule("b")).checks).toHaveLength(2);
    expect(() => withRule(raw, rule("a"))).toThrow(/already a rule called "a"/);
    expect(() => withRule(raw, { id: "c", type: "custom", function: "f", question: "?", severity: "major", blocking: false })).toThrow(EditError);
    expect(withoutRule(raw, "a").checks).toEqual([]);
    expect(() => withoutRule(raw, "zz")).toThrow(/no rule called "zz"/);
  });

  it("sets the AI reviewer where it was, and removes the key entirely", () => {
    const judge = { question: "Does it make things up?", fail_definition: "f", pass_definition: "p", model: "claude-sonnet-5-5" as const };
    expect(Object.keys(withJudge({ name: "x", judge: null, checks: [] }, judge))).toEqual(["name", "judge", "checks"]);
    expect(withJudge({ name: "x" }, judge)).toEqual({ name: "x", judge });
    expect(withJudge({ name: "x", judge }, null)).toEqual({ name: "x" });
  });

  it("edits cases line by line, leaving comments and blank lines alone", () => {
    const added = withCasesAdded(CASES.trimEnd(), [{ case_id: "c03", input: { q: "new" }, split: "heldout", origin: "ai_drafted" }]);
    expect(added).toBe(`${CASES.trimEnd()}\n{"case_id":"c03","split":"heldout","input":{"q":"new"},"origin":"ai_drafted"}\n`);
    expect(withCaseReplaced(CASES, { case_id: "c02", input: "ciao", split: "dev" })).toBe('// comment\n{"case_id":"c01","input":"hi"}\n\n{"case_id":"c02","input":"ciao"}\n');
    expect(withCaseRemoved(CASES, "c01")).toBe('// comment\n\n{"case_id":"c02","input":"bye","notes":"n"}\n');
    expect(() => withCaseRemoved(CASES, "nope")).toThrow(/no test case "nope"/);
    expect(serializeCase({ case_id: "a", input: 1, split: "dev", expected: false })).toBe('{"case_id":"a","input":1,"expected":false}');
  });
});

describe("editDefinition", () => {
  it("refuses a change the loader would reject, and writes nothing", async () => {
    const d = await readDefinition(ID);
    const before = await fs.readFile(path.join(agentsDir, ID, "agent.json"), "utf8");
    const broken = { ...d.raw, checks: [{ id: "len", type: "max_length", question: "Short?" }] }; // a length rule with no limit
    await expect(
      editDefinition(ID, { actor: "P", base: d.hash, action: "test", apply: async () => ({ configText: configTextOf(broken), details: {} }) }),
    ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/set max_words and\/or max_chars/) });
    expect(await fs.readFile(path.join(agentsDir, ID, "agent.json"), "utf8")).toBe(before);
  });

  it("never changes the connection", async () => {
    const d = await readDefinition(ID);
    const moved = { ...d.raw, connection: { type: "http", url: "https://attacker.example.net/a", headers: {} } };
    await expect(editDefinition(ID, { actor: "P", base: d.hash, action: "test", apply: async () => ({ configText: configTextOf(moved), details: {} }) })).rejects.toThrow(
      /never change "connection"/,
    );
  });

  it("writes only what changed, and returns the new fingerprint", async () => {
    const d = await readDefinition(ID);
    const res = await editDefinition(ID, { actor: "P", base: d.hash, action: "test", apply: async (x) => ({ casesText: withCaseRemoved(x.casesText, "c02"), details: {} }) });
    const casesNow = await fs.readFile(path.join(agentsDir, ID, "cases.jsonl"), "utf8");
    expect(casesNow).not.toContain("c02");
    expect(res.hash).toBe(definitionHash(await fs.readFile(path.join(agentsDir, ID, "agent.json"), "utf8"), casesNow));
    expect((await fs.readdir(path.join(agentsDir, ID))).sort()).toEqual(["agent.json", "cases.jsonl"]); // no temp files left
  });
});
