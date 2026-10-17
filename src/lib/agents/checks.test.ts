import { describe, expect, it } from "vitest";
import {
  checkDefinitions,
  getPath,
  isEmptyOutput,
  matchWithTimeout,
  MAX_REGEX_INPUT,
  parsedOutput,
  runCheck,
  runChecks,
  textLeaves,
  type CustomCheckRegistry,
} from "./checks";
import { CheckConfig, type AgentCase, type AgentTrace, type LoadedAgent } from "./schemas";

function trace(over: Partial<AgentTrace> = {}): AgentTrace {
  return {
    trace_id: "atr_1",
    agent_id: "bot",
    run_id: "arun_1",
    case_id: "c1",
    timestamp: "2026-10-17T00:00:00Z",
    agent_version: "v1",
    input: { question: "q" },
    output: { answer: "Refunds within 30 days.", citations: ["KB-1"], escalate: false },
    evidence: [{ id: "KB-1", text: "Refunds within 30 days." }],
    tool_calls: [],
    model_id: null,
    latency_ms: 500,
    cost_usd: 0.01,
    execution_mode: "imported",
    execution_error: null,
    data_origin: "real",
    metadata: {},
    ...over,
  };
}

const testCase = (over: Partial<AgentCase> = {}): AgentCase => ({ case_id: "c1", input: { question: "q" }, split: "dev", expected: { escalate: false }, ...over });

function run(raw: Record<string, unknown>, t = trace(), c: AgentCase | null = testCase(), registry: CustomCheckRegistry = {}) {
  const cfg = CheckConfig.parse({ id: "x", question: "q?", ...raw });
  const agent = { config: { checks: [cfg] } } as unknown as LoadedAgent;
  return runCheck(cfg, checkDefinitions(agent)[0], t, c, registry);
}

describe("helpers", () => {
  it("parses JSON-looking strings and leaves text alone", () => {
    expect(parsedOutput('{"a":1}')).toEqual({ a: 1 });
    expect(parsedOutput("hello")).toBe("hello");
    expect(parsedOutput("{not json")).toBe("{not json");
  });
  it("reads dot paths into objects and arrays", () => {
    expect(getPath({ a: { b: [10, 20] } }, "a.b.1")).toBe(20);
    expect(getPath({ a: 1 }, "")).toEqual({ a: 1 });
    expect(typeof getPath({ a: 1 }, "b")).toBe("symbol");
  });
});

describe("json_output", () => {
  it("passes when required fields are present", () => {
    expect(run({ type: "json_output", required_fields: ["answer", "citations"] }).outcome).toBe("PASS");
  });
  it("fails on a missing or null field", () => {
    const r = run({ type: "json_output", required_fields: ["answer", "missing"] });
    expect(r.outcome).toBe("FAIL");
    expect(r.details).toEqual({ missing: ["missing"] });
    expect(run({ type: "json_output", required_fields: ["a"] }, trace({ output: { a: null, b: "text" } })).outcome).toBe("FAIL");
  });
  it("fails on plain text, passes on a JSON string", () => {
    expect(run({ type: "json_output" }, trace({ output: "just text" })).outcome).toBe("FAIL");
    expect(run({ type: "json_output", required_fields: ["a"] }, trace({ output: '{"a": 1}' })).outcome).toBe("PASS");
  });
});

describe("matches_expected", () => {
  const cfg = { type: "matches_expected", field: "escalate", expected_field: "escalate" };
  it("passes and fails on exact match", () => {
    expect(run(cfg).outcome).toBe("PASS");
    expect(run(cfg, trace({ output: { escalate: true } })).outcome).toBe("FAIL");
  });
  it("is not applicable without an expected value", () => {
    expect(run(cfg, trace(), testCase({ expected: undefined })).outcome).toBe("NOT_APPLICABLE");
    expect(run(cfg, trace(), testCase({ expected: { other: 1 } })).outcome).toBe("NOT_APPLICABLE");
  });
  it("fails when the output lacks the field", () => {
    expect(run(cfg, trace({ output: { answer: "x" } })).outcome).toBe("FAIL");
  });
  it("supports case-insensitive and contains modes", () => {
    const t = trace({ output: { label: "  Billing " } });
    expect(run({ type: "matches_expected", field: "label", expected_field: "label", mode: "case_insensitive" }, t, testCase({ expected: { label: "billing" } })).outcome).toBe("PASS");
    expect(run({ type: "matches_expected", field: "answer", mode: "contains" }, trace(), testCase({ expected: "30 DAYS" })).outcome).toBe("PASS");
    expect(run({ type: "matches_expected", field: "answer", mode: "contains" }, trace(), testCase({ expected: "60 days" })).outcome).toBe("FAIL");
  });
});

describe("regex", () => {
  it("must match", () => {
    expect(run({ type: "regex", field: "answer", pattern: "30 days", must: "match" }).outcome).toBe("PASS");
    expect(run({ type: "regex", field: "answer", pattern: "60 days", must: "match" }).outcome).toBe("FAIL");
  });
  it("must not match", () => {
    expect(run({ type: "regex", field: "answer", pattern: "guarantee", flags: "i", must: "no_match" }).outcome).toBe("PASS");
    const r = run({ type: "regex", field: "answer", pattern: "REFUNDS", flags: "i", must: "no_match" });
    expect(r.outcome).toBe("FAIL");
    expect(r.summary).toContain("Refunds");
  });
  it("reports an invalid pattern as ERROR, never PASS", () => {
    expect(run({ type: "regex", pattern: "(", must: "no_match" }).outcome).toBe("ERROR");
  });
});

describe("fail closed when the output changes shape", () => {
  it("a forbidden-pattern check on a missing field scans the whole output", () => {
    const leak = trace({ output: "here is the key sk-ABC123" });
    const r = run({ type: "regex", field: "answer", pattern: "sk-[A-Z0-9]+", must: "no_match", severity: "critical" }, leak);
    expect(r.outcome).toBe("FAIL");
    expect(r.summary).toContain("whole output");
  });
  it("a length check on a missing field measures the whole output", () => {
    const long = trace({ output: { text: "one two three four five six" } });
    expect(run({ type: "max_length", field: "answer", max_words: 3 }, long).outcome).toBe("FAIL");
  });
  it("a null or missing output is ERROR on every check, even with no execution_error", () => {
    expect(run({ type: "regex", field: "answer", pattern: "x", must: "no_match" }, trace({ output: null })).outcome).toBe("ERROR");
    expect(run({ type: "max_length", max_words: 3 }, trace({ output: undefined })).outcome).toBe("ERROR");
  });
  it.each([[""], ["   \n "], [{}], [[]], [{ answer: "" }], [{ answer: null, citations: [] }], ['{"answer": "  "}']])("an empty answer %j is ERROR, never PASS", (output) => {
    expect(run({ type: "regex", field: "answer", pattern: "secret", must: "no_match" }, trace({ output })).outcome).toBe("ERROR");
    expect(run({ type: "max_length", max_words: 3 }, trace({ output })).outcome).toBe("ERROR");
  });
  it("a trace with an error is ERROR on every check, even if it also has output", () => {
    const r = run({ type: "regex", pattern: "x", must: "no_match" }, trace({ output: "partial answer", execution_error: "tool crashed" }));
    expect(r.outcome).toBe("ERROR");
    expect(r.summary).toContain("tool crashed");
  });
  it("a null or blank answer field is ERROR (no answer), never a pass", () => {
    const leak = trace({ output: { answer: null, message: "your key is sk-live-ABC123" } });
    expect(run({ type: "regex", field: "answer", pattern: "sk-live-[A-Z0-9]+", must: "no_match" }, leak).outcome).toBe("ERROR");
    const blank = trace({ output: { answer: "", escalate: false } });
    expect(run({ type: "max_length", field: "answer", max_words: 3 }, blank).outcome).toBe("ERROR");
    expect(run({ type: "regex", field: "answer", pattern: "x", must: "no_match" }, blank).outcome).toBe("ERROR");
  });
  it("a missing field (changed shape) makes no_match and max_length read the whole output", () => {
    const leak = trace({ output: { message: "your key is sk-live-ABC123" } });
    expect(run({ type: "regex", field: "answer", pattern: "sk-live-[A-Z0-9]+", must: "no_match" }, leak).outcome).toBe("FAIL");
    const long = trace({ output: { text: "one two three four five" } });
    expect(run({ type: "max_length", field: "answer", max_words: 3 }, long).outcome).toBe("FAIL");
  });
  it("allow_empty_output lets an empty answer be graded instead of erroring", () => {
    const cfg = CheckConfig.parse({ id: "x", question: "q?", type: "matches_expected", field: "entities", expected_field: "entities" });
    const agent = { config: { checks: [cfg], allow_empty_output: true } } as unknown as LoadedAgent;
    const r = runCheck(cfg, checkDefinitions(agent)[0], trace({ output: { entities: [] } }), testCase({ expected: { entities: [] } }), {}, true);
    expect(r.outcome).toBe("PASS");
    expect(runCheck(cfg, checkDefinitions(agent)[0], trace({ output: { entities: [] } }), testCase({ expected: { entities: [] } }), {}, false).outcome).toBe("ERROR");
  });
  it("the whole-output fallback reads text values, not JSON escapes", () => {
    const t = trace({ output: { other: 'line one\nsays "secret"' } });
    expect(run({ type: "regex", field: "answer", pattern: '\nsays "secret"', must: "no_match" }, t).outcome).toBe("FAIL");
  });
});

describe("regex safety", () => {
  it("a forbidden-pattern check refuses text longer than it can scan (ERROR, never PASS)", () => {
    const padded = trace({ output: { answer: "x".repeat(MAX_REGEX_INPUT) + " sk-live-ABC" } });
    const r = run({ type: "regex", field: "answer", pattern: "sk-live", must: "no_match", severity: "critical" }, padded);
    expect(r.outcome).toBe("ERROR");
    expect(r.summary).toMatch(/can only scan/);
    // must:"match" too: a pattern can't vouch for text it didn't read.
    expect(run({ type: "regex", field: "answer", pattern: "^x", must: "match" }, padded).outcome).toBe("ERROR");
  });
  it("a catastrophic pattern is stopped and reported as ERROR instead of stalling the server", () => {
    const t = trace({ output: { answer: "a".repeat(40) + "!" } });
    const started = Date.now();
    const r = run({ type: "regex", field: "answer", pattern: "^(\\w+\\s?)+$", must: "match" }, t);
    expect(r.outcome).toBe("ERROR");
    expect(r.summary).toMatch(/longer than/);
    expect(Date.now() - started).toBeLessThan(5000);
    // Once a pattern has timed out, it isn't run again: the next trace gets ERROR immediately.
    const t2 = Date.now();
    const again = run({ type: "regex", field: "answer", pattern: "^(\\w+\\s?)+$", must: "match" }, trace({ trace_id: "atr_2", output: { answer: "b".repeat(40) + "!" } }));
    expect(again.outcome).toBe("ERROR");
    expect(Date.now() - t2).toBeLessThan(100);
  });
  it("a no_match catastrophic pattern is ERROR too", () => {
    const r = run({ type: "regex", field: "answer", pattern: "^(a|aa)+$", must: "no_match" }, trace({ output: { answer: "a".repeat(45) + "b" } }));
    expect(r.outcome).toBe("ERROR");
  });
  it("matchWithTimeout returns normal results for normal patterns", () => {
    expect(matchWithTimeout(/b+/, "abbbc")![0]).toBe("bbb");
    expect(matchWithTimeout(/z/, "abc")).toBeNull();
  });
});

describe("non_empty", () => {
  it("passes when there is text, fails on an empty field or a missing one", () => {
    expect(run({ type: "non_empty" }, trace({ output: { answer: "hi" } })).outcome).toBe("PASS");
    expect(run({ type: "non_empty", field: "answer" }, trace({ output: { answer: "", other: "x" } })).outcome).toBe("FAIL");
    expect(run({ type: "non_empty", field: "answer" }, trace({ output: { other: "x" } })).outcome).toBe("FAIL");
  });
});

describe("helpers for empty answers", () => {
  it("textLeaves and isEmptyOutput", () => {
    expect(textLeaves({ a: "x", b: [1, true, null, { c: "y" }] })).toEqual(["x", "1", "true", "y"]);
    expect(isEmptyOutput('{"a": ""}')).toBe(true);
    expect(isEmptyOutput({ a: 0 })).toBe(false);
    expect(isEmptyOutput("no")).toBe(false);
  });
});

describe("max_length", () => {
  it("counts words and characters", () => {
    expect(run({ type: "max_length", field: "answer", max_words: 4 }).outcome).toBe("PASS");
    expect(run({ type: "max_length", field: "answer", max_words: 3 }).outcome).toBe("FAIL");
    expect(run({ type: "max_length", field: "answer", max_chars: 5 }).outcome).toBe("FAIL");
  });
});

describe("cites_evidence", () => {
  const cfg = { type: "cites_evidence", citations_field: "citations" };
  it("passes when every citation exists", () => {
    expect(run(cfg).outcome).toBe("PASS");
  });
  it("fails on a citation the agent was not given", () => {
    const r = run(cfg, trace({ output: { citations: ["KB-1", "KB-9"] } }));
    expect(r.outcome).toBe("FAIL");
    expect(r.details).toMatchObject({ unknown: ["KB-9"] });
  });
  it("accepts objects with an id", () => {
    expect(run(cfg, trace({ output: { citations: [{ id: "KB-1" }] } })).outcome).toBe("PASS");
  });
  it("no citations: not applicable, or FAIL when required", () => {
    expect(run(cfg, trace({ output: { answer: "x", citations: [] } })).outcome).toBe("NOT_APPLICABLE");
    expect(run({ ...cfg, require_at_least_one: true }, trace({ output: { answer: "x", citations: [] } })).outcome).toBe("FAIL");
  });
  it("a missing citations field fails (a renamed field or plain text can't switch the check off)", () => {
    expect(run(cfg, trace({ output: { answer: "see KB-9", sources: ["KB-9"] } })).outcome).toBe("FAIL");
    expect(run(cfg, trace({ output: "See KB-9 for details" })).outcome).toBe("FAIL");
  });
  it("errors on a malformed citation list", () => {
    expect(run(cfg, trace({ output: { citations: [42] } })).outcome).toBe("ERROR");
  });
});

describe("no_tool_errors, max_latency_ms, max_cost_usd", () => {
  it("tool errors", () => {
    expect(run({ type: "no_tool_errors" }).outcome).toBe("NOT_APPLICABLE");
    expect(run({ type: "no_tool_errors" }, trace({ tool_calls: [{ name: "search" }] })).outcome).toBe("PASS");
    expect(run({ type: "no_tool_errors" }, trace({ tool_calls: [{ name: "search", error: "timeout" }] })).outcome).toBe("FAIL");
  });
  it("latency and cost", () => {
    expect(run({ type: "max_latency_ms", max: 1000 }).outcome).toBe("PASS");
    expect(run({ type: "max_latency_ms", max: 100 }).outcome).toBe("FAIL");
    expect(run({ type: "max_latency_ms", max: 100 }, trace({ latency_ms: null })).outcome).toBe("NOT_APPLICABLE");
    expect(run({ type: "max_cost_usd", max: 0.001 }).outcome).toBe("FAIL");
    expect(run({ type: "max_cost_usd", max: 1 }).outcome).toBe("PASS");
  });
});

describe("custom checks", () => {
  const registry: CustomCheckRegistry = {
    bot: {
      ok: () => ({ outcome: "PASS", summary: "fine" }),
      bad: () => ({ outcome: "FAIL", summary: "nope" }),
      boom: () => {
        throw new Error("kaboom");
      },
      weird: () => ({ outcome: "MAYBE" as "PASS", summary: "?" }),
    },
  };
  it("runs a registered function", () => {
    expect(run({ type: "custom", function: "ok" }, trace(), testCase(), registry).outcome).toBe("PASS");
    expect(run({ type: "custom", function: "bad" }, trace(), testCase(), registry).outcome).toBe("FAIL");
  });
  it("unregistered, throwing or invalid functions are ERROR, never PASS", () => {
    expect(run({ type: "custom", function: "missing" }, trace(), testCase(), registry).outcome).toBe("ERROR");
    expect(run({ type: "custom", function: "boom" }, trace(), testCase(), registry).summary).toContain("kaboom");
    expect(run({ type: "custom", function: "weird" }, trace(), testCase(), registry).outcome).toBe("ERROR");
  });
});

describe("failed agent calls", () => {
  it("every check reports ERROR when the call failed with no output", () => {
    const agent = {
      config: { checks: [CheckConfig.parse({ id: "a", question: "q", type: "json_output" }), CheckConfig.parse({ id: "b", question: "q", type: "max_latency_ms", max: 1 })] },
      cases: [testCase()],
    } as unknown as LoadedAgent;
    const results = runChecks(agent, trace({ output: null, execution_error: "HTTP 500" }), {});
    expect(results.map((r) => r.outcome)).toEqual(["ERROR", "ERROR"]);
  });
});

describe("definitions", () => {
  it("version changes when a check's config changes", () => {
    const a = checkDefinitions({ config: { checks: [CheckConfig.parse({ id: "x", question: "q", type: "max_latency_ms", max: 1 })] } } as unknown as LoadedAgent)[0];
    const b = checkDefinitions({ config: { checks: [CheckConfig.parse({ id: "x", question: "q", type: "max_latency_ms", max: 2 })] } } as unknown as LoadedAgent)[0];
    expect(a.version).not.toBe(b.version);
    expect(a.validation).toBe("built_in_tested");
  });
});
