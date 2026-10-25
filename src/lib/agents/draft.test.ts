/**
 * Claude drafts, a person decides. The Claude call is stubbed: these tests pin what is sent (never a final-exam
 * question, never answer content) and how a draft is turned into something the app can use (or refused).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.hoisted(() => ({ mode: "live" as "live" | "mock", reply: "", requests: [] as Array<{ system: string; user: string; purpose: string; cacheDir?: string }> }));
vi.mock("../llm/client", () => ({
  modeInfo: () => ({ mode: call.mode, reason: call.mode === "live" ? "Connected with your API key" : "No API key connected", spend_cap_usd: 10 }),
  callStructured: async (req: { system: string; user: string; purpose: string; cacheDir?: string }) => {
    call.requests.push(req);
    return { raw_text: call.reply, served_model_id: "claude-opus-5-5", stop_reason: "end_turn", usage: null, estimated_cost_usd: 0.01, latency_ms: 5, cache_hit: false, error: null };
  },
}));
import { answerShape, draftCases, draftRule, fieldsOf, ruleFromDraft } from "./draft";
import type { LockState } from "./ingest";
import type { AgentTrace, LoadedAgent } from "./schemas";

const agent: LoadedAgent = {
  agent_id: "help-desk",
  dir: "/tmp/x",
  config: {
    name: "Help desk",
    description: "Answers billing questions",
    example: false,
    connection: null,
    checks: [{ id: "answers", type: "non_empty", field: "answer", question: "Answers?", severity: "major", blocking: false }],
    judge: null,
    allow_empty_output: false,
    min_reviewed_traces: 10,
    pass_all_threshold: 0.9,
  },
  cases: [
    { case_id: "c01", input: { question: "How do I get a refund?" }, split: "dev", expected: { escalate: false } },
    { case_id: "c02", input: { question: "Can I pay yearly?" }, split: "dev" },
    { case_id: "h01", input: { question: "SECRET final exam question" }, split: "heldout" },
  ],
};
const lock: LockState = { locked: new Map([["h01", "held out"]]), revealed: new Set(), movedToDev: [] };
const trace = (output: unknown): AgentTrace => ({
  trace_id: "t",
  agent_id: "help-desk",
  run_id: "r",
  case_id: "c01",
  timestamp: "",
  agent_version: "v1",
  input: null,
  output,
  evidence: [],
  tool_calls: [],
  model_id: null,
  latency_ms: null,
  cost_usd: null,
  execution_mode: "imported",
  execution_error: null,
  data_origin: "real",
  metadata: {},
});

const nullRule = {
  field: null, pattern: null, flags: null, must: null, max_words: null, max_chars: null, mode: null, expected_field: null,
  required_fields: null, citations_field: null, require_at_least_one: null, max: null, fix_hint: null,
};

beforeEach(() => {
  call.mode = "live";
  call.requests = [];
});

describe("what drafting learns about the answers", () => {
  it("reads field names and types, never the content", () => {
    expect(fieldsOf([{ answer: "secret text", meta: { lang: "en" }, citations: ["KB-1"] }, { answer: null }])).toEqual([
      { path: "answer", type: "string or null" },
      { path: "meta", type: "object" },
      { path: "meta.lang", type: "string" },
      { path: "citations", type: "list" },
    ]);
    expect(answerShape([trace("plain text")])).toEqual({ kind: "text", fields: [] });
    expect(answerShape([trace('{"answer": "x"}')]).kind).toBe("json");
    expect(answerShape([])).toEqual({ kind: "unknown", fields: [] });
  });
});

describe("draftRule", () => {
  it("needs live mode", async () => {
    call.mode = "mock";
    await expect(draftRule(agent, lock, "Never promise refunds", [])).rejects.toThrow(/needs a Claude API key/);
    expect(call.requests).toHaveLength(0);
  });

  it("turns a draft into a valid rule with a free name, sending field names but no answer content", async () => {
    call.reply = JSON.stringify({
      kind: "rule",
      explanation: "Flags refund promises.",
      rule: { ...nullRule, id: "answers", question: "Does it avoid promising refunds?", type: "regex", field: "answer", pattern: "\\b(guarantee|full refund)\\b", flags: "i", must: "no_match", severity: "major", blocking: true, max: 99 },
      ai_reviewer: null,
      bad_example: "I guarantee a full refund.",
    });
    const d = await draftRule(agent, lock, "Never promise refunds", [trace({ answer: "CONFIDENTIAL customer text" })]);
    expect(d).toMatchObject({ kind: "rule", bad_example: "I guarantee a full refund.", cost_usd: 0.01 });
    if (d.kind !== "rule") throw new Error("expected a rule");
    // "answers" is taken, so it's renamed from its question; properties the type doesn't use (max) are dropped.
    expect(d.rule).toEqual({ id: "avoid_promising_refunds", type: "regex", question: "Does it avoid promising refunds?", field: "answer", pattern: "\\b(guarantee|full refund)\\b", flags: "i", must: "no_match", severity: "major", blocking: true });
    const sent = call.requests[0];
    expect(sent.user).toContain("- answer (string)");
    expect(sent.user).toContain("- escalate (boolean)");
    expect(sent.user).not.toContain("CONFIDENTIAL");
    expect(sent.user).not.toContain("SECRET");
    expect(sent.purpose).toBe("agent-draft-rule");
    expect(sent.cacheDir).toBe("agents/help-desk/llm_cache");
  });

  it("refuses a draft that isn't a usable rule (an invalid pattern) instead of passing it on", async () => {
    call.reply = JSON.stringify({ kind: "rule", explanation: "x", rule: { ...nullRule, id: "x", question: "Q?", type: "regex", field: "answer", pattern: "(", flags: "i", must: "no_match", severity: "major", blocking: false }, ai_reviewer: null, bad_example: null });
    const d = await draftRule(agent, lock, "something", []);
    expect(d.kind).toBe("unclear");
    expect(d.kind === "unclear" && d.explanation).toMatch(/wasn't a usable rule/);
  });

  it("passes on a judgement call as an AI reviewer question", async () => {
    call.reply = JSON.stringify({
      kind: "ai_reviewer",
      explanation: "Tone needs judgement.",
      rule: null,
      ai_reviewer: { question: "Is the answer rude to the customer?", fail_definition: "It insults or blames the customer.", pass_definition: "It is polite or neutral." },
      bad_example: null,
    });
    expect(await draftRule(agent, lock, "Be polite", [])).toMatchObject({ kind: "ai_reviewer", judge: { question: "Is the answer rude to the customer?" } });
  });

  it("turns each rule type's fields into exactly that type's rule", () => {
    const base = { ...nullRule, id: "x", question: "Q?", severity: "minor" as const, blocking: false };
    expect(ruleFromDraft({ ...base, type: "max_length", field: "answer", max_words: 80, pattern: "ignored" }, []).rule).toMatchObject({ type: "max_length", field: "answer", max_words: 80 });
    expect(ruleFromDraft({ ...base, type: "max_length", field: "answer", max_words: 80, pattern: "ignored" }, []).rule).not.toHaveProperty("pattern");
    expect(ruleFromDraft({ ...base, type: "max_latency_ms", max: 3000 }, []).rule).toMatchObject({ max: 3000 });
    expect(ruleFromDraft({ ...base, type: "max_latency_ms" }, []).problem).toMatch(/max/);
  });
});

describe("draftCases", () => {
  it("sends practice questions only, and keeps new, well-formed questions in the agent's input shape", async () => {
    call.reply = JSON.stringify({
      cases: [
        { input: "Can I get a refund after 40 days?", notes: "Outside the window" },
        { input: "how do i get a refund?", notes: "Duplicate of c01" },
        { input: "  ", notes: "Blank" },
        { input: "Do you bill in euros?", notes: "Currency" },
      ],
    });
    const res = await draftCases(agent, lock, "refund edge cases", 5);
    expect(res.drafts).toEqual([
      { input: { question: "Can I get a refund after 40 days?" }, notes: "Outside the window" },
      { input: { question: "Do you bill in euros?" }, notes: "Currency" },
    ]);
    const sent = call.requests[0].user;
    expect(sent).toContain("How do I get a refund?");
    expect(sent).not.toContain("SECRET");
    expect(sent).toContain("refund edge cases");
    expect(sent).toContain("Write exactly 5 new test inputs.");
  });
});
