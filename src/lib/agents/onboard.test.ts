import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import { loadAgentFromDir } from "./config";
import { MissingEnvError, UnsafeConnectionError } from "./http";
import { OnboardError, buildCases, createAgent, testConnection, tokenEnvName } from "./onboard";
import { suggestChecks } from "./suggest";

let agentsDir: string;
let server: http.Server;
let url: string;
let lastAuth: string | undefined;

beforeAll(async () => {
  agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-onboard-"));
  process.env.EVALXIETY_AGENTS_DIR = agentsDir;
  server = http.createServer((req, res) => {
    lastAuth = req.headers.authorization;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ output: { answer: "Use Settings → Reset.", citations: ["KB-1"], escalate: false }, evidence: [{ id: "KB-1", text: "Reset from Settings." }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/answer`;
});

afterAll(async () => {
  delete process.env.EVALXIETY_AGENTS_DIR;
  delete process.env[tokenEnvName("tok-bot")];
  await new Promise((r) => server.close(r));
  await fs.rm(agentsDir, { recursive: true, force: true });
});

describe("suggestChecks", () => {
  it("infers shape, citation and latency checks from a structured reply", () => {
    const checks = suggestChecks({ output: { answer: "hi", citations: ["a"], escalate: false }, evidence: [{ id: "a" }], latency_ms: 300 });
    expect(checks.map((c) => c.id)).toEqual(["answers_at_all", "valid_response", "cites_only_given_evidence", "fast_enough"]);
    expect(checks[0]).toMatchObject({ type: "non_empty", field: "answer", blocking: true });
    expect(checks[1]).toMatchObject({ type: "json_output", required_fields: ["answer", "citations", "escalate"] });
    expect(checks[3]).toMatchObject({ type: "max_latency_ms", max: 5000 });
  });

  it("skips the citation check when the agent returned no evidence to check against", () => {
    const ids = suggestChecks({ output: { answer: "hi", citations: ["a"] }, evidence: [], latency_ms: 10 }).map((c) => c.id);
    expect(ids).not.toContain("cites_only_given_evidence");
  });

  it("falls back to a whole-output non_empty check for text replies or no reply", () => {
    expect(suggestChecks({ output: "plain text", evidence: [], latency_ms: 2000 }).map((c) => c.id)).toEqual(["answers_at_all", "fast_enough"]);
    expect(suggestChecks({ output: "plain text", evidence: [], latency_ms: 2000 })[1]).toMatchObject({ max: 10000 });
    expect(suggestChecks(null)).toEqual([expect.objectContaining({ id: "answers_at_all", field: "" })]);
  });
});

describe("buildCases", () => {
  it("wraps plain lines in the input key and holds out every 5th case", () => {
    const text = Array.from({ length: 10 }, (_, i) => `question ${i + 1}`).join("\n");
    const out = buildCases(text, "question", true);
    const lines = out.jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(out).toMatchObject({ count: 10, heldout: 2 });
    expect(lines[0]).toEqual({ case_id: "q01", input: { question: "question 1" } });
    expect(lines[4]).toEqual({ case_id: "q05", split: "heldout", input: { question: "question 5" } });
  });

  it("sends a bare string when there is no input key, and skips blank and comment lines", () => {
    const out = buildCases("\n// note\nhello\n\nworld\n", null, true);
    expect(out.count).toBe(2);
    expect(JSON.parse(out.jsonl.split("\n")[0])).toEqual({ case_id: "q01", input: "hello" });
  });

  it("uses JSONL as written and reports bad lines", () => {
    const out = buildCases('{"case_id": "a", "input": 1, "split": "heldout"}\n{"case_id": "b", "input": 2}', "question", true);
    expect(out).toMatchObject({ count: 2, heldout: 1 });
    expect(() => buildCases('{"case_id": "a"}', null, true)).toThrow(/line 1/);
    expect(() => buildCases("  \n", null, true)).toThrow(OnboardError);
  });
});

describe("testConnection", () => {
  it("calls the endpoint once and suggests checks from the reply", async () => {
    const r = await testConnection({ agent_id: "my-bot", connection: { url, auth: null, timeout_ms: 5000 }, sample_input: { question: "hi" } });
    expect(r.result.error).toBeNull();
    expect(r.result.output).toMatchObject({ answer: "Use Settings → Reset." });
    expect(r.suggested_checks.map((c) => c.id)).toContain("cites_only_given_evidence");
  });

  it("sends the token from the agent's own env var, and says which one when it is missing", async () => {
    const body = { agent_id: "tok-bot", connection: { url, auth: { name: "Authorization", prefix: "Bearer " }, timeout_ms: 5000 }, sample_input: "hi" };
    await expect(testConnection(body)).rejects.toThrow(MissingEnvError);
    await expect(testConnection(body)).rejects.toThrow(tokenEnvName("tok-bot"));
    process.env[tokenEnvName("tok-bot")] = "secret-token-123";
    await testConnection(body);
    expect(lastAuth).toBe("Bearer secret-token-123");
  });

  it("refuses to send a token over plain http to another host", async () => {
    await expect(
      testConnection({ agent_id: "tok-bot", connection: { url: "http://example.com/answer", auth: { name: "Authorization", prefix: "" }, timeout_ms: 1000 }, sample_input: "hi" }),
    ).rejects.toThrow(UnsafeConnectionError);
  });
});

describe("createAgent", () => {
  const base = {
    name: "My bot",
    description: "Answers help-desk questions",
    connection: { url: "http://127.0.0.1:9/answer", auth: { name: "Authorization", prefix: "Bearer " }, timeout_ms: 30_000 },
    checks: suggestChecks(null),
    cases_text: "How do I reset my password?\nCan I get a refund?",
    input_key: "question",
    holdout: true,
  };

  it("writes a folder the loader accepts, with the token as an env reference", async () => {
    const out = await createAgent({ ...base, agent_id: "my-bot" });
    expect(out).toMatchObject({ agent_id: "my-bot", cases: 2, heldout: 0, checks: 1, token_env: "EVALXIETY_AGENT_MY_BOT_TOKEN" });
    const { agent, problems } = await loadAgentFromDir("my-bot", path.join(agentsDir, "my-bot"));
    expect(problems).toEqual([]);
    expect(agent?.config.connection?.headers).toEqual({ Authorization: "Bearer ${env:EVALXIETY_AGENT_MY_BOT_TOKEN}" });
    expect(agent?.cases.map((c) => c.input)).toEqual([{ question: "How do I reset my password?" }, { question: "Can I get a refund?" }]);
  });

  it("never overwrites an existing folder", async () => {
    const before = await fs.readFile(path.join(agentsDir, "my-bot", "agent.json"), "utf8");
    await expect(createAgent({ ...base, agent_id: "my-bot", name: "Other" })).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(path.join(agentsDir, "my-bot", "agent.json"), "utf8")).toBe(before);
  });

  it("creates an import-only agent with no connection", async () => {
    await createAgent({ ...base, agent_id: "import-bot", connection: null });
    const { agent } = await loadAgentFromDir("import-bot", path.join(agentsDir, "import-bot"));
    expect(agent?.config.connection).toBeNull();
  });

  it("rejects reserved ids and bad cases without leaving a folder behind", async () => {
    await expect(createAgent({ ...base, agent_id: "example-mine" })).rejects.toThrow(/reserved/);
    await expect(createAgent({ ...base, agent_id: "bad-cases", cases_text: '{"case_id": "x"}' })).rejects.toThrow(OnboardError);
    await expect(fs.stat(path.join(agentsDir, "bad-cases"))).rejects.toThrow();
  });
});
