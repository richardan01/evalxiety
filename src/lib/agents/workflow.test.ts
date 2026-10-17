/**
 * End-to-end for "your agents": load the committed starter kit, import two runs, call an HTTP agent, review,
 * judge, compare and reach a gate verdict. Uses temp data and agents directories.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getAgent, loadAgents, parseAgentConfig, parseCases } from "./config";
import { caseInputHash, computeLockState, parseImport } from "./ingest";
import { AgentRun, CheckConfig, HttpConnection, type AgentTrace as AgentTraceT, type LoadedAgent as LoadedAgentT } from "./schemas";
import { assertSafeConnection, callAgent, envNameBelongsTo, mapResponse, redactSecrets, redactText, resolveHeaders, UnsafeConnectionError } from "./http";
import { checkDefinitions, lookupCustom, runCheck } from "./checks";
import { CasesChangedError, ConfirmationRequiredError, freezeNewVersion, httpRun, importRun, ImportValidationError } from "./runs";
import { revealAgentHeldout, upsertAgentAnnotation, listAgentAudit, saveAgentRun } from "./repo";
import { agentOverview, agentsList, agentTraceDetail, judgeRunMissing, pickDefaults, recordAgentApproval, GateNotEligibleError, JudgeBusyError } from "./services";

const STARTER = path.join(process.cwd(), "agents", "example-support-bot");
let dataDir: string;
let agentsDir: string;

async function copyStarter(id: string, patch: (cfg: Record<string, unknown>) => void = () => {}) {
  const dest = path.join(agentsDir, id);
  await fs.mkdir(dest, { recursive: true });
  for (const f of ["cases.jsonl", "traces.v1-baseline.jsonl", "traces.v2-candidate.jsonl"]) await fs.copyFile(path.join(STARTER, f), path.join(dest, f));
  const cfg = JSON.parse(await fs.readFile(path.join(STARTER, "agent.json"), "utf8"));
  // Custom checks are registered per agent id, so a copy under another id drops the starter kit's custom check
  // (keeping it is refused at load time — see "config problems").
  if (id !== "example-support-bot") cfg.checks = cfg.checks.filter((c: { type: string }) => c.type !== "custom");
  patch(cfg);
  await fs.writeFile(path.join(dest, "agent.json"), JSON.stringify(cfg));
  return dest;
}

const read = (dir: string, f: string) => fs.readFile(path.join(dir, f), "utf8");
/** Reveal these held-out cases by their current content, as the reveal route does. */
async function reveal(agentId: string, ids: string[], reason = "done tuning") {
  const a = await getAgent(agentId);
  const cases = a.cases.filter((c) => ids.includes(c.case_id)).map((c) => ({ case_id: c.case_id, input_hash: caseInputHash(c.input) }));
  return revealAgentHeldout(agentId, "tester", reason, cases);
}
/** A starter trace file with the starter-kit marker removed: stands in for the same outputs from a real agent. */
const realText = async (f: string) =>
  (await read(STARTER, f))
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const o = JSON.parse(l);
      delete o.metadata;
      return JSON.stringify(o);
    })
    .join("\n");

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-agents-data-"));
  agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-agents-def-"));
  process.env.AGENTTRUST_DATA_DIR = dataDir;
  process.env.EVALXIETY_AGENTS_DIR = agentsDir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(agentsDir, { recursive: true, force: true });
});

describe("the committed starter kit", () => {
  it("agent.json and cases.jsonl are valid", async () => {
    const { config, problems } = parseAgentConfig(JSON.parse(await read(STARTER, "agent.json")));
    expect(problems).toEqual([]);
    expect(config!.example).toBe(true);
    const cases = parseCases(await read(STARTER, "cases.jsonl"));
    expect(cases.problems).toEqual([]);
    expect(cases.cases.length).toBe(12);
  });

  it("both example trace files import with zero problems", async () => {
    await copyStarter("example-support-bot");
    const agent = await getAgent("example-support-bot");
    for (const f of ["traces.v1-baseline.jsonl", "traces.v2-candidate.jsonl"]) {
      const p = parseImport(await read(STARTER, f), agent, computeLockState(agent, [], { revealed: false, revealed_at: null, revealed_by: null, reason: null, revealed_cases: [] }));
      expect(p.problems).toEqual([]);
      expect(p.lines.length).toBe(9);
    }
  });
});

describe("the committed template (agents/_template)", () => {
  it("has a valid agent.json with one universal check, and is not listed as an agent", async () => {
    const tpl = path.join(process.cwd(), "agents", "_template");
    const { config, problems } = parseAgentConfig(JSON.parse(await fs.readFile(path.join(tpl, "agent.json"), "utf8")));
    expect(problems).toEqual([]);
    expect(config!.example).toBe(false);
    expect(config!.judge).toBeNull();
    expect(config!.connection).toBeNull();
    // Its cases.jsonl holds only comments, so a copy fails loudly until real cases are added.
    expect(parseCases(await fs.readFile(path.join(tpl, "cases.jsonl"), "utf8")).cases).toEqual([]);
  });
});

describe("config problems are reported, not thrown", () => {
  it("names the file and line", async () => {
    const dir = path.join(agentsDir, "broken-bot");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "agent.json"), JSON.stringify({ name: "Broken", checks: [] }));
    await fs.writeFile(path.join(dir, "cases.jsonl"), '{"case_id":"a","input":1}\n{oops\n{"case_id":"a","input":2}\n');
    const { agents, problems } = await loadAgents();
    expect(agents.map((a) => a.agent_id)).not.toContain("broken-bot");
    expect(problems.filter((p) => p.agent_id === "broken-bot").map((p) => p.line)).toEqual([2, 3]);
    await fs.rm(dir, { recursive: true });
  });
});

describe("import", () => {
  it("rejects the whole file with line numbers; imports nothing", async () => {
    const agent = await getAgent("example-support-bot");
    const bad = ['{"case_id":"c01","output":"hi"}', "not json", '{"case_id":"zzz","output":"x"}', '{"case_id":"c01","output":"dup"}', '{"case_id":"c02"}', '{"case_id":"h01","output":"x"}'].join("\n");
    const err = await importRun({ agent, text: bad, agent_version: "v0", actor: "tester" }).catch((e) => e);
    expect(err).toBeInstanceOf(ImportValidationError);
    expect((err as ImportValidationError).problems.map((p) => p.line)).toEqual([2, 3, 4, 5, 6]);
    expect((err as ImportValidationError).heldout).toBe(true);
    expect((await agentOverview("example-support-bot")).runs).toEqual([]);
  });

  it("imports baseline and candidate, freezes v1 once, is idempotent", async () => {
    const agent = await getAgent("example-support-bot");
    const v1 = await importRun({ agent, text: await read(STARTER, "traces.v1-baseline.jsonl"), agent_version: "v1", actor: "tester" });
    expect(v1.created).toBe(true);
    expect(v1.run.frozen_version).toBe(1);
    expect(v1.run.data_origin).toBe("example");
    expect(v1.missing_case_ids).toEqual([]);
    const again = await importRun({ agent, text: await read(STARTER, "traces.v1-baseline.jsonl"), agent_version: "v1", actor: "tester" });
    expect(again.created).toBe(false);
    expect(again.run.run_id).toBe(v1.run.run_id);
    const v2 = await importRun({ agent, text: await read(STARTER, "traces.v2-candidate.jsonl"), agent_version: "v2", actor: "tester" });
    expect(v2.run.frozen_version).toBe(1);
  });
});

describe("checks, comparison and gate on the starter runs", () => {
  it("v2 fixes 7 cases but regresses c09: a case that passed in v1 now fails a critical check", async () => {
    const ov = await agentOverview("example-support-bot");
    const [cand, base] = ov.runs;
    expect(cand.agent_version).toBe("v2");
    expect(base.summary.pass_all_count).toBe(2); // c08 and c09
    expect(cand.summary.pass_all_count).toBe(8);
    // The story the docs tell: 7 fixed, c08 still passing, c09 passed in v1 and fails in v2.
    expect(ov.gate.comparison!.fixed).toEqual(["c01", "c02", "c03", "c04", "c05", "c06", "c07"]);
    expect(ov.gate.comparison!.still_passing).toEqual(["c08"]);
    expect(ov.gate.comparison!.regressed).toEqual(["c09"]);
    expect(ov.selected).toEqual({ candidate: cand.run_id, baseline: base.run_id });
    expect(ov.gate.comparison!.new_critical_regressions).toEqual([{ case_id: "c09", evaluator_id: "escalates_when_required" }]);
  });

  it("example data never decides the gate: NO_SHIP reasons are downgraded, status is INSUFFICIENT", async () => {
    const ov = await agentOverview("example-support-bot");
    expect(ov.gate.status).toBe("INSUFFICIENT_EVIDENCE");
    const reg = ov.gate.reasons.find((r) => r.code === "new_critical_regression")!;
    expect(reg.level).toBe("WARNING");
    expect(reg.message).toContain("example data");
    expect(ov.gate.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["example_data", "heldout_not_revealed", "insufficient_human_review", "judge_not_run"]));
  });

  it("the mock judge runs on example traces; results are labelled mock", async () => {
    const ov = await agentOverview("example-support-bot");
    const r = await judgeRunMissing("example-support-bot", ov.runs[1].run_id, "tester", false);
    expect(r.judged).toBe(9);
    const t = await agentTraceDetail("example-support-bot", ov.runs[1].trace_ids.c03);
    expect(t!.judge_current!.execution_mode).toBe("mock");
    expect(t!.judge_current!.verdict).toBe("FAIL"); // "$10" appears nowhere in the evidence
  });
});

describe("a real agent (example: false)", () => {
  it("the same failures say NO SHIP — the alarm can fire", async () => {
    await copyStarter("real-bot", (c) => {
      c.example = false;
      c.judge = null;
      c.min_reviewed_traces = 1;
    });
    const agent = await getAgent("real-bot");
    await importRun({ agent, text: await realText("traces.v1-baseline.jsonl"), agent_version: "v1", actor: "tester" });
    await importRun({ agent, text: await realText("traces.v2-candidate.jsonl"), agent_version: "v2", actor: "tester" });
    const ov = await agentOverview("real-bot");
    expect(ov.gate.status).toBe("NO_SHIP");
    expect(ov.gate.reasons.find((r) => r.code === "new_critical_regression")!.level).toBe("NO_SHIP");
    expect(ov.gate.reasons.find((r) => r.code === "critical_check_failed")!.case_ids).toEqual(["c09"]);
  });

  it("real traces are never judged by the mock heuristic", async () => {
    await copyStarter("judged-bot", (c) => (c.example = false));
    const agent = await getAgent("judged-bot");
    const { run } = await importRun({ agent, text: await realText("traces.v2-candidate.jsonl"), agent_version: "v2", actor: "tester" });
    await expect(judgeRunMissing("judged-bot", run.run_id, "tester", false)).rejects.toThrow(/MOCK_MODE=false/);
  });

  it("starter-kit traces stay EXAMPLE even when imported into a copied, non-example agent", async () => {
    const agent = await getAgent("judged-bot");
    const { run } = await importRun({ agent, text: await read(STARTER, "traces.v1-baseline.jsonl"), agent_version: "toy", actor: "tester" });
    expect(run.data_origin).toBe("example");
    const t = await agentTraceDetail("judged-bot", run.trace_ids.c01);
    expect(t!.trace.data_origin).toBe("example");
  });

  it("approval of an unknown run is refused", async () => {
    await expect(
      recordAgentApproval("real-bot", { approver: "Rich", decision: "rejected", notes: "", candidate_run_id: "arun_doesnotexist", baseline_run_id: null, evidence_snapshot_hash: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("approval is refused unless the gate is eligible", async () => {
    const ov = await agentOverview("real-bot");
    await expect(
      recordAgentApproval("real-bot", { approver: "Rich", decision: "approved", notes: "", candidate_run_id: ov.selected.candidate!, baseline_run_id: ov.selected.baseline, evidence_snapshot_hash: ov.evidence_snapshot_hash }),
    ).rejects.toBeInstanceOf(GateNotEligibleError);
  });
});

describe("human review", () => {
  it("stores named human labels and enforces fail details", async () => {
    const ov = await agentOverview("real-bot");
    const cand = ov.runs[0];
    const base = { agent_id: "real-bot", trace_id: cand.trace_ids.c09, case_id: "c09", run_id: cand.run_id, notes: "", judge_label: "not_assessed" as const };
    await expect(upsertAgentAnnotation({ ...base, reviewer: "  ", task_outcome: "pass", first_failure: null, failure_type: null, severity: null })).rejects.toThrow(/named human/);
    await expect(upsertAgentAnnotation({ ...base, reviewer: "Rich", task_outcome: "fail", first_failure: null, failure_type: null, severity: "major" })).rejects.toThrow(/first thing/);
    const { annotation, created } = await upsertAgentAnnotation({ ...base, reviewer: "Rich", task_outcome: "fail", first_failure: "Escalated a self-serve cancellation", failure_type: "Unneeded hand-off", severity: "critical" });
    expect(created).toBe(true);
    expect(annotation.label_source).toBe("human");
    const after = await agentOverview("real-bot");
    expect(after.failure_types[0]).toMatchObject({ name: "Unneeded hand-off", count: 1, critical: 1 });
    expect(after.gate.reasons.map((r) => r.code)).toContain("human_confirmed_critical");
  });
});

describe("frozen cases and held-out", () => {
  it("editing cases blocks new runs until a new version is frozen", async () => {
    const dir = path.join(agentsDir, "real-bot");
    await fs.appendFile(path.join(dir, "cases.jsonl"), '{"case_id":"c10","input":{"question":"Hi"},"expected":{"escalate":false}}\n');
    const agent = await getAgent("real-bot");
    await expect(importRun({ agent, text: await realText("traces.v1-baseline.jsonl"), agent_version: "v1b", actor: "tester" })).rejects.toBeInstanceOf(CasesChangedError);
    expect((await agentOverview("real-bot")).gate.reasons.map((r) => r.code)).toContain("cases_changed");
    const { version, created } = await freezeNewVersion(agent, "tester", "added c10");
    expect(created).toBe(true);
    expect(version.version).toBe(2);
    const r = await importRun({ agent, text: await realText("traces.v1-baseline.jsonl"), agent_version: "v1b", actor: "tester" });
    expect(r.run.frozen_version).toBe(2);
    expect(r.missing_case_ids).toEqual(["c10"]);
  });

  it("held-out cases import only after an audited reveal", async () => {
    const agent = await getAgent("real-bot");
    const line = '{"case_id":"h01","output":{"answer":"Monthly plans are not refundable.","citations":[],"escalate":false}}';
    await expect(importRun({ agent, text: line, agent_version: "h", actor: "tester" })).rejects.toBeInstanceOf(ImportValidationError);
    await reveal("real-bot", ["h01", "h02", "h03"]);
    const r = await importRun({ agent, text: line, agent_version: "h", actor: "tester" });
    expect(r.run.case_ids).toContain("h01");
    expect((await listAgentAudit("real-bot")).map((e) => e.action)).toContain("run_imported");
  });
});

describe("HTTP adapter", () => {
  it("maps structured and plain responses", () => {
    expect(mapResponse({ output: { a: 1 }, evidence: [{ id: "e1", text: "t" }], cost_usd: 0.1 })).toMatchObject({ output: { a: 1 }, evidence: [{ id: "e1", text: "t" }], cost_usd: 0.1, error: null });
    expect(mapResponse("plain text")).toMatchObject({ output: "plain text", error: null });
    expect(mapResponse({ output: "x", evidence: "nope" }).error).toMatch(/trace contract/);
  });

  it("reads secrets from the environment and names missing ones", () => {
    expect(resolveHeaders({ Authorization: "Bearer ${env:TOKEN_A}" }, { TOKEN_A: "s3cret-value" })).toEqual({ headers: { Authorization: "Bearer s3cret-value" }, secrets: { TOKEN_A: "s3cret-value" } });
    // Too short to redact safely.
    expect(() => resolveHeaders({ A: "${env:SHORT}" }, { SHORT: "abc" })).toThrow(/at least 8/);
    expect(() => resolveHeaders({ A: "${env:NOPE_1}", B: "${env:NOPE_2}" }, {})).toThrow(/NOPE_1, NOPE_2/);
    // A value with a line break is refused, naming only the variable (the value would otherwise end up in an error).
    const err = (() => {
      try {
        resolveHeaders({ A: "${env:BAD}" }, { BAD: "sk-secret\ninjected" });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(UnsafeConnectionError);
    expect(err!.message).toContain("BAD");
    expect(err!.message).not.toContain("sk-secret");
  });

  it("asks for confirmation before a batch, then records every case (errors included)", async () => {
    await copyStarter("http-bot", (c) => {
      c.example = false;
      (c.connection as Record<string, unknown>).cost_per_call_usd = 0.02;
      (c.connection as Record<string, unknown>).headers = { "X-Key": "${env:EVALXIETY_AGENT_HTTP_BOT_KEY}" };
    });
    process.env.EVALXIETY_AGENT_HTTP_BOT_KEY = "s3cr3t-value-xyz";
    const agent = await getAgent("http-bot");
    const err = await httpRun({ agent, agent_version: "v1", actor: "tester", confirm_batch: false }).catch((e) => e);
    expect(err).toBeInstanceOf(ConfirmationRequiredError);
    expect((err as ConfirmationRequiredError).estimate).toEqual({ calls: 9, cost_per_call_usd: 0.02, estimated_usd: 0.18, host: "127.0.0.1:4010", env_sent: ["EVALXIETY_AGENT_HTTP_BOT_KEY"] });
    expect((err as ConfirmationRequiredError).message).toContain("sending EVALXIETY_AGENT_HTTP_BOT_KEY");

    const seen: Array<{ headers: Record<string, string>; body: { case_id: string } }> = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push({ headers: init.headers as Record<string, string>, body });
      if (body.case_id === "c05") return new Response("upstream exploded", { status: 502 });
      if (body.case_id === "c06") return new Response(JSON.stringify({ output: null, error: "retriever timed out" }), { headers: { "Content-Type": "application/json" } });
      if (body.case_id === "c07") return new Response(JSON.stringify({ output: null }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ output: { answer: "ok", citations: [], escalate: false }, evidence: [] }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const { run } = await httpRun({ agent, agent_version: "v1", actor: "tester", confirm_batch: true, fetchImpl: fakeFetch });
    expect(seen).toHaveLength(9);
    expect(seen[0].headers["X-Key"]).toBe("s3cr3t-value-xyz");
    expect(run.status).toBe("completed");
    expect(Object.keys(run.trace_ids)).toHaveLength(9); // recorded incrementally under the run's lock
    const t = await agentTraceDetail("http-bot", run.trace_ids.c05);
    expect(t!.trace.execution_error).toMatch(/HTTP 502/);
    expect(t!.evaluation.incomplete).toBe(true);
    // An agent-reported error, and a null output with no error, are both errors: never graded as an answer.
    const t6 = await agentTraceDetail("http-bot", run.trace_ids.c06);
    expect(t6!.trace.execution_error).toBe("retriever timed out");
    const t7 = await agentTraceDetail("http-bot", run.trace_ids.c07);
    expect(t7!.trace.execution_error).toMatch(/no output/);
    expect(t7!.evaluation.results.every((r) => r.outcome === "ERROR")).toBe(true);
    expect(t7!.evaluation.pass_all).toBe(false);
    // Secret header values are never written anywhere under the data directory.
    const all = await fs.readdir(dataDir, { recursive: true });
    for (const f of all) {
      const full = path.join(dataDir, String(f));
      if ((await fs.stat(full)).isFile()) expect(await fs.readFile(full, "utf8")).not.toContain("s3cr3t-value-xyz");
    }
  });
});

describe("connection safety", () => {
  it("only EVALXIETY_AGENT_* variables can be sent, and never over plain http to another host", () => {
    expect(() => assertSafeConnection("my-bot", "http://127.0.0.1:9/x", { A: "${env:ANTHROPIC_API_KEY}" })).toThrow(UnsafeConnectionError);
    expect(() => assertSafeConnection("my-bot", "https://agent.example.com/x", { A: "Bearer ${env:AWS_SECRET_ACCESS_KEY}" })).toThrow(/EVALXIETY_AGENT_MY_BOT_/);
    // Another agent's secret is out of bounds too.
    expect(() => assertSafeConnection("my-bot", "https://agent.example.com/x", { A: "${env:EVALXIETY_AGENT_OTHER_BOT_TOKEN}" })).toThrow(UnsafeConnectionError);
    expect(() => assertSafeConnection("my-bot", "http://agent.example.com/x", { A: "${env:EVALXIETY_AGENT_MY_BOT_T}" })).toThrow(/plain http/);
    expect(() => assertSafeConnection("my-bot", "https://agent.example.com/x", { A: "${env:EVALXIETY_AGENT_MY_BOT_T}" })).not.toThrow();
    expect(() => assertSafeConnection("my-bot", "http://localhost:8000/x", { A: "${env:EVALXIETY_AGENT_MY_BOT_T}" })).not.toThrow();
    expect(() => assertSafeConnection("my-bot", "http://agent.example.com/x", {})).not.toThrow();
  });

  it("an unsafe agent.json is refused before any call, and shown on the overview", async () => {
    await copyStarter("leaky-bot", (c) => {
      c.example = false;
      (c.connection as Record<string, unknown>).headers = { "X-Key": "${env:ANTHROPIC_API_KEY}" };
    });
    let calls = 0;
    const spy = (async () => {
      calls++;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const agent = await getAgent("leaky-bot");
    await expect(httpRun({ agent, agent_version: "v1", actor: "t", confirm_batch: true, fetchImpl: spy })).rejects.toBeInstanceOf(UnsafeConnectionError);
    expect(calls).toBe(0);
    expect((await agentOverview("leaky-bot")).agent.connection!.unsafe).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe("no output is never an answer", () => {
  it("an imported null output (or an error line) is an error on every check", async () => {
    const agent = await getAgent("judged-bot");
    const text = ['{"case_id":"c01","output":null}', '{"case_id":"c02","error":"tool crashed"}', '{"case_id":"c03","output":"fine"}'].join("\n");
    const { run } = await importRun({ agent, text, agent_version: "nulls", actor: "t" });
    const t1 = await agentTraceDetail("judged-bot", run.trace_ids.c01);
    expect(t1!.trace.execution_error).toMatch(/no output/);
    expect(t1!.evaluation.results.every((r) => r.outcome === "ERROR")).toBe(true);
    const t2 = await agentTraceDetail("judged-bot", run.trace_ids.c02);
    expect(t2!.trace.execution_error).toBe("tool crashed");
    expect(t2!.evaluation.pass_all).toBe(false);
  });
});

describe("held-out lock is per case", () => {
  it("a held-out case added after a reveal stays locked until its own reveal", async () => {
    await copyStarter("lock-bot", (c) => (c.example = false));
    const dir = path.join(agentsDir, "lock-bot");
    let agent = await getAgent("lock-bot");
    await importRun({ agent, text: await realText("traces.v1-baseline.jsonl"), agent_version: "v1", actor: "t" });
    await reveal("lock-bot", ["h01", "h02", "h03"]);
    await fs.appendFile(path.join(dir, "cases.jsonl"), '{"case_id":"h04","split":"heldout","input":{"question":"Refund for last year?"},"expected":{"escalate":false}}\n');
    agent = await getAgent("lock-bot");
    await freezeNewVersion(agent, "t", "added h04");
    const line = '{"case_id":"h04","output":{"answer":"x","citations":[],"escalate":false}}';
    const err = await importRun({ agent, text: line, agent_version: "h", actor: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(ImportValidationError);
    expect((err as ImportValidationError).heldout).toBe(true);
    const ov = await agentOverview("lock-bot");
    expect(ov.cases.find((c) => c.case_id === "h04")!.locked).toBe(true);
    expect(ov.cases.find((c) => c.case_id === "h01")!.locked).toBe(false);
    expect(ov.gate.reasons.map((r) => r.code)).toContain("heldout_not_revealed");
    await reveal("lock-bot", ["h04"], "final check with h04");
    expect((await importRun({ agent, text: line, agent_version: "h", actor: "t" })).created).toBe(true);
  });

  it("moving a never-revealed held-out case to dev is flagged and audited", async () => {
    await copyStarter("move-bot", (c) => (c.example = false));
    const dir = path.join(agentsDir, "move-bot");
    let agent = await getAgent("move-bot");
    await importRun({ agent, text: await realText("traces.v1-baseline.jsonl"), agent_version: "v1", actor: "t" });
    const cases = (await fs.readFile(path.join(dir, "cases.jsonl"), "utf8")).replace('{"case_id": "h01", "split": "heldout",', '{"case_id": "h01", "split": "dev",');
    await fs.writeFile(path.join(dir, "cases.jsonl"), cases);
    agent = await getAgent("move-bot");
    await freezeNewVersion(agent, "t", "moved h01 to dev");
    const ov = await agentOverview("move-bot");
    expect(ov.gate.reasons.find((r) => r.code === "heldout_moved_to_dev")!.case_ids).toEqual(["h01"]);
    const freeze = (await listAgentAudit("move-bot")).filter((e) => e.action === "frozen_version_created").pop()!;
    expect(freeze.details.moved_to_dev).toEqual(["h01"]);
  });
});

describe("runs and judge batches", () => {
  it("a run left 'running' past its maximum duration shows as failed (interrupted)", async () => {
    const agent = await getAgent("real-bot");
    const ov = await agentOverview("real-bot");
    await saveAgentRun(AgentRun.parse({ ...ov.runs[0], run_id: "arun_stuck", status: "running", completed_at: null, created_at: "2020-01-01T00:00:00.000Z", trace_ids: {} }));
    const after = await agentOverview("real-bot");
    const stuck = after.runs.find((r) => r.run_id === "arun_stuck")!;
    expect(stuck.status).toBe("failed");
    expect(stuck.notes).toMatch(/Interrupted/);
    expect(agent.agent_id).toBe("real-bot");
  });

  it("a second judge batch on the same run is refused while one is running", async () => {
    const ov = await agentOverview("example-support-bot");
    const runId = ov.runs[0].run_id;
    const results = await Promise.allSettled([judgeRunMissing("example-support-bot", runId, "t", false), judgeRunMissing("example-support-bot", runId, "t", false)]);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof JudgeBusyError)).toHaveLength(1);
  });

  it("the default baseline prefers a different version label over a re-run of the candidate's version", async () => {
    await copyStarter("rerun-bot", (c) => (c.example = false));
    const agent = await getAgent("rerun-bot");
    const v1 = await importRun({ agent, text: await realText("traces.v1-baseline.jsonl"), agent_version: "v1", actor: "t" });
    await new Promise((r) => setTimeout(r, 5));
    const v2a = await importRun({ agent, text: await realText("traces.v2-candidate.jsonl"), agent_version: "v2", actor: "t" });
    await new Promise((r) => setTimeout(r, 5));
    const v2b = await importRun({ agent, text: (await realText("traces.v2-candidate.jsonl")) + "\n", agent_version: "v2", actor: "t" });
    expect(v2b.run.run_id).not.toBe(v2a.run.run_id);
    const ov = await agentOverview("rerun-bot");
    expect(ov.selected).toEqual({ candidate: v2b.run.run_id, baseline: v1.run.run_id });
  });
});

describe("held-out lock cannot be laundered", () => {
  async function freshLocked(id: string) {
    await copyStarter(id, (c) => (c.example = false));
    const agent = await getAgent(id);
    await importRun({ agent, text: await realText("traces.v1-baseline.jsonl"), agent_version: "v1", actor: "t" });
    return path.join(agentsDir, id);
  }
  const editCases = async (dir: string, fn: (lines: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) => {
    const lines = (await fs.readFile(path.join(dir, "cases.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    await fs.writeFile(path.join(dir, "cases.jsonl"), fn(lines).map((l) => JSON.stringify(l)).join("\n") + "\n");
  };

  it("renaming a held-out case to a new dev id is caught by content", async () => {
    const dir = await freshLocked("rename-bot");
    await editCases(dir, (ls) => ls.map((l) => (l.case_id === "h01" ? { ...l, case_id: "d01", split: "dev" } : l)));
    await freezeNewVersion(await getAgent("rename-bot"), "t", "renamed");
    const ov = await agentOverview("rename-bot");
    expect(ov.gate.reasons.find((r) => r.code === "heldout_moved_to_dev")!.case_ids).toEqual(["d01"]);
    const freeze = (await listAgentAudit("rename-bot")).filter((e) => e.action === "frozen_version_created").pop()!;
    expect(freeze.details.renamed_heldout).toEqual([{ from: "h01", to: "d01" }]);
  });

  it("deleting a never-revealed held-out case is flagged and audited", async () => {
    const dir = await freshLocked("delete-bot");
    await editCases(dir, (ls) => ls.filter((l) => l.case_id !== "h02"));
    await freezeNewVersion(await getAgent("delete-bot"), "t", "dropped h02");
    const ov = await agentOverview("delete-bot");
    expect(ov.gate.reasons.find((r) => r.code === "heldout_removed")!.case_ids).toEqual(["h02"]);
    expect(ov.gate.checks.find((c) => c.id === "heldout")!.status).toBe("fail");
    const freeze = (await listAgentAudit("delete-bot")).filter((e) => e.action === "frozen_version_created").pop()!;
    expect(freeze.details.removed_heldout).toEqual(["h02"]);
  });

  it("a held-out case moved to dev (even edited) can't be run before its reveal", async () => {
    const dir = await freshLocked("trip-bot");
    await editCases(dir, (ls) => ls.map((l) => (l.case_id === "h01" ? { ...l, split: "dev", input: { question: "slightly edited" } } : l)));
    const agent = await getAgent("trip-bot");
    await freezeNewVersion(agent, "t", "peek");
    const err = await importRun({ agent, text: '{"case_id":"h01","output":{"answer":"tuned","citations":[],"escalate":false}}', agent_version: "peek", actor: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(ImportValidationError);
    expect((err as ImportValidationError).problems[0].message).toMatch(/never revealed/);
    const ov = await agentOverview("trip-bot");
    expect(ov.cases.find((c) => c.case_id === "h01")).toMatchObject({ locked: true });
    expect(ov.gate.next_step).toMatch(/move it back/);
  });

  it("a dev case that was already run, then promoted to held-out, is flagged until it gets fresh input", async () => {
    const dir = await freshLocked("promote-bot");
    await editCases(dir, (ls) => ls.map((l) => (l.case_id === "c01" ? { ...l, split: "heldout" } : l)));
    await freezeNewVersion(await getAgent("promote-bot"), "t", "promote c01");
    let ov = await agentOverview("promote-bot");
    expect(ov.gate.reasons.find((r) => r.code === "heldout_used_before_reveal")!.case_ids).toEqual(["c01"]);
    await editCases(dir, (ls) => ls.map((l) => (l.case_id === "c01" ? { ...l, input: { question: "A fresh, never-run question" } } : l)));
    await freezeNewVersion(await getAgent("promote-bot"), "t", "fresh c01");
    ov = await agentOverview("promote-bot");
    expect(ov.gate.reasons.map((r) => r.code)).not.toContain("heldout_used_before_reveal");
  });

  it("editing a never-revealed held-out case's input is not reported as a deletion", async () => {
    const dir = await freshLocked("edit-bot");
    await editCases(dir, (ls) => ls.map((l) => (l.case_id === "h02" ? { ...l, input: { question: "typo fixed" } } : l)));
    await freezeNewVersion(await getAgent("edit-bot"), "t", "typo");
    const ov = await agentOverview("edit-bot");
    expect(ov.gate.reasons.map((r) => r.code)).not.toContain("heldout_removed");
    expect(ov.cases.find((c) => c.case_id === "h02")!.locked).toBe(true);
  });

  it("new content under an id that was revealed before stays locked", async () => {
    const dir = await freshLocked("reuse-bot");
    await reveal("reuse-bot", ["h01", "h02", "h03"]);
    await editCases(dir, (ls) => ls.map((l) => (l.case_id === "h01" ? { ...l, input: { question: "A brand new held-out question" } } : l)));
    const agent = await getAgent("reuse-bot");
    await freezeNewVersion(agent, "t", "fresh h01");
    const ov = await agentOverview("reuse-bot");
    expect(ov.cases.find((c) => c.case_id === "h01")!.locked).toBe(true);
    expect(ov.cases.find((c) => c.case_id === "h02")!.locked).toBe(false);
    const err = await importRun({ agent, text: '{"case_id":"h01","output":"x"}', agent_version: "x", actor: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(ImportValidationError);
  });
});

describe("default runs and confirmations", () => {
  it("re-importing the baseline version doesn't swap the roles", async () => {
    await copyStarter("swap-bot", (c) => (c.example = false));
    const agent = await getAgent("swap-bot");
    await importRun({ agent, text: await realText("traces.v1-baseline.jsonl"), agent_version: "v1", actor: "t" });
    await new Promise((r) => setTimeout(r, 5));
    const v2 = await importRun({ agent, text: await realText("traces.v2-candidate.jsonl"), agent_version: "v2", actor: "t" });
    await new Promise((r) => setTimeout(r, 5));
    const v1b = await importRun({ agent, text: (await realText("traces.v1-baseline.jsonl")) + "\n", agent_version: "v1", actor: "t" });
    const ov = await agentOverview("swap-bot");
    expect(ov.selected).toEqual({ candidate: v2.run.run_id, baseline: v1b.run.run_id });
  });

  it("a one-case run that sends a secret still asks for confirmation, and an echoed secret is redacted", async () => {
    await copyStarter("echo-bot", (c) => {
      c.example = false;
      (c.connection as Record<string, unknown>).headers = { Authorization: "Bearer ${env:EVALXIETY_AGENT_ECHO_BOT_TOKEN}" };
    });
    process.env.EVALXIETY_AGENT_ECHO_BOT_TOKEN = "tok-ECHO-123456";
    const agent = await getAgent("echo-bot");
    const err = await httpRun({ agent, agent_version: "v1", actor: "t", confirm_batch: false, case_ids: ["c01"] }).catch((e) => e);
    expect(err).toBeInstanceOf(ConfirmationRequiredError);
    const echo = (async (_u: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return new Response(`invalid token ${auth}`, { status: 401 });
    }) as typeof fetch;
    const { run } = await httpRun({ agent, agent_version: "v1", actor: "t", confirm_batch: true, case_ids: ["c01"], fetchImpl: echo });
    const t = await agentTraceDetail("echo-bot", run.trace_ids.c01);
    expect(t!.trace.execution_error).toContain("[REDACTED:EVALXIETY_AGENT_ECHO_BOT_TOKEN]");
    expect(t!.trace.execution_error).not.toContain("tok-ECHO-123456");
  });
});

describe("config problems that would make a check meaningless", () => {
  it("an unregistered custom check, a misspelled key and a limitless max_length are reported at load", async () => {
    await copyStarter("typo-bot", (c) => {
      c.example = false;
      (c.checks as Array<Record<string, unknown>>).push(
        { id: "mine", type: "custom", function: "notRegistered", question: "q" },
        { id: "short", type: "max_length", maxWords: 50, question: "q" },
        { id: "nolimit", type: "max_length", question: "q" },
      );
    });
    const { problems } = await loadAgents();
    const msgs = problems.filter((p) => p.agent_id === "typo-bot").map((p) => p.message).join(" | ");
    expect(msgs).toMatch(/maxWords/);
    await fs.writeFile(
      path.join(agentsDir, "typo-bot", "agent.json"),
      JSON.stringify({ name: "Typo", checks: [{ id: "mine", type: "custom", function: "notRegistered", question: "q" }, { id: "nolimit", type: "max_length", question: "q" }] }),
    );
    const again = (await loadAgents()).problems.filter((p) => p.agent_id === "typo-bot").map((p) => p.message).join(" | ");
    expect(again).toMatch(/no function "notRegistered" is registered for "typo-bot"/);
    expect(again).toMatch(/set max_words and\/or max_chars/);
    await fs.rm(path.join(agentsDir, "typo-bot"), { recursive: true });
  });
});

describe("review 3 regressions", () => {
  it("an agent id that is another's prefix can't read its token (support vs support-bot)", () => {
    expect(envNameBelongsTo("support", "EVALXIETY_AGENT_SUPPORT_BOT_TOKEN")).toBe(false);
    expect(envNameBelongsTo("support-bot", "EVALXIETY_AGENT_SUPPORT_BOT_TOKEN")).toBe(true);
    expect(() => assertSafeConnection("support", "https://x.example/", { A: "${env:EVALXIETY_AGENT_SUPPORT_BOT_TOKEN}" })).toThrow(UnsafeConnectionError);
  });

  it("a secret echoed across the 300-character error cut is still fully redacted", async () => {
    const secret = "tok-SECRET-abcdef123456";
    const echo = (async () => new Response("x".repeat(290) + secret, { status: 401 })) as unknown as typeof fetch;
    const conn = HttpConnection.parse({ type: "http", url: "https://agent.example/eval" });
    const r = await callAgent(conn, { case_id: "c", input: {}, split: "dev" }, { Authorization: `Bearer ${secret}` }, echo, { secrets: { EVALXIETY_AGENT_X_TOKEN: secret } });
    expect(r.error).not.toContain("tok-SECRET");
    expect(r.error).toContain("[REDACTED:EVALXIETY_AGENT_X_TOKEN]".slice(0, 10));
  });

  it("defaults: a lone label is the baseline; scratch labels and failed runs never decide the roles", () => {
    const mk = (id: string, label: string, at: string, status: "completed" | "failed" = "completed") =>
      ({ run_id: id, agent_version: label, created_at: at, status, frozen_hash: "H" }) as unknown as import("./schemas").AgentRun;
    expect(pickDefaults([mk("a", "v1", "1")])).toEqual({ candidate: null, baseline: expect.objectContaining({ run_id: "a" }) });
    const runs = [mk("f", "v2", "0", "failed"), mk("a", "v1", "1"), mk("b", "v2", "2"), mk("s", "scratch-check", "3")];
    const d = pickDefaults(runs);
    expect(d.candidate!.run_id).toBe("b");
    expect(d.baseline!.run_id).toBe("a");
    // "V1 " is the same version as "v1": a re-run under it stays the baseline.
    const d2 = pickDefaults([...runs, mk("c", "V1 ", "4")]);
    expect(d2.candidate!.run_id).toBe("b");
    expect(d2.baseline!.run_id).toBe("c");
  });

  it("a mistyped expected_field or an invalid regex is a load error", async () => {
    await copyStarter("field-bot", (c) => {
      c.example = false;
      (c.checks as Array<Record<string, unknown>>).push(
        { id: "typo", type: "matches_expected", field: "escalate", expected_field: "escalte", question: "q" },
        { id: "badre", type: "regex", pattern: "(", must: "match", question: "q" },
      );
    });
    const msgs = (await loadAgents()).problems.filter((p) => p.agent_id === "field-bot").map((p) => p.message).join(" | ");
    expect(msgs).toMatch(/no case's "expected" has "escalte"/);
    expect(msgs).toMatch(/invalid pattern/);
    await fs.rm(path.join(agentsDir, "field-bot"), { recursive: true });
  });

  it("inherited names never count as registered custom checks", () => {
    expect(lookupCustom({ "example-support-bot": {} }, "example-support-bot", "toString")).toBeNull();
    expect(lookupCustom({}, "constructor", "keys")).toBeNull();
  });

  it("an unmodified copy of the starter kit explains itself", async () => {
    const dest = path.join(agentsDir, "copied-kit");
    await fs.cp(STARTER, dest, { recursive: true });
    const msgs = (await loadAgents()).problems.filter((p) => p.agent_id === "copied-kit").map((p) => p.message).join(" | ");
    expect(msgs).toMatch(/start from agents\/_template instead/);
    await fs.rm(dest, { recursive: true });
  });
});

describe("final-gate fixes", () => {
  it("escaped and numeric echoes of a secret are redacted", () => {
    const secret = "abc/def+ghi\"jkl==";
    const secrets = { EVALXIETY_AGENT_X_TOKEN: secret };
    for (const body of [
      JSON.stringify({ detail: `invalid token ${secret}` }), // Node escaping
      JSON.stringify({ detail: `invalid token ${secret}` }).replace(/\//g, "\\/"), // PHP escaping
      `{"detail": "invalid token ${[...secret].map((ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")).join("")}"}`,
      `not json at all ${secret}`,
    ]) {
      const out = redactText(body, secrets);
      expect(out).not.toContain("abc/def");
      expect(out).not.toContain("abc\\/def");
      expect(out).not.toContain("\\u0061\\u0062\\u0063");
    }
    expect(redactSecrets({ account: 12345678901 }, { EVALXIETY_AGENT_X_ID: "12345678901" })).toEqual({ account: "[REDACTED:EVALXIETY_AGENT_X_ID]" });
  });

  it("with allow_empty_output and a judge, an empty answer gets judged so the gate can finish", async () => {
    await copyStarter("empty-bot", (c) => {
      c.example = true; // mock judge runs on example data
      c.allow_empty_output = true;
    });
    const agent = await getAgent("empty-bot");
    const { run } = await importRun({ agent, text: '{"case_id":"c01","output":""}\n{"case_id":"c02","output":{"answer":"Annual plans can be refunded within 30 days of purchase.","citations":["KB-1"],"escalate":false}}', agent_version: "v1", actor: "t" });
    expect(run.status).toBe("completed");
    const r = await judgeRunMissing("empty-bot", run.run_id, "t", false);
    expect(r.judged).toBe(2);
    const ov = await agentOverview("empty-bot", { candidate: run.run_id, baseline: "none" });
    expect(ov.gate.reasons.find((x) => x.code === "judge_not_run")).toBeUndefined();
  });

  it("an import where every line errored is a failed run and never a default", async () => {
    await copyStarter("down-bot", (c) => (c.example = false));
    const agent = await getAgent("down-bot");
    const { run } = await importRun({ agent, text: '{"case_id":"c01","error":"agent down"}\n{"case_id":"c02","error":"agent down"}', agent_version: "v2", actor: "t" });
    expect(run.status).toBe("failed");
  });

  it("the default baseline is the version you ship (first label, or the last approved), not the newest other run", () => {
    const mk = (id: string, label: string, at: string) => ({ run_id: id, agent_version: label, created_at: at, status: "completed", frozen_hash: "H" }) as unknown as AgentRun;
    const runs = [mk("a", "v1", "1"), mk("b", "v2", "2"), mk("c", "v3", "3")];
    expect(pickDefaults(runs)).toMatchObject({ candidate: { run_id: "c" }, baseline: { run_id: "a" } });
    // v2 was approved and shipped: v3 is compared with v2.
    expect(pickDefaults(runs, null, null, ["b"])).toMatchObject({ candidate: { run_id: "c" }, baseline: { run_id: "b" } });
    // Explicit "no baseline" with a single version leaves no candidate either (nothing to compare yet).
    expect(pickDefaults([mk("a", "v1", "1")], null, "none")).toEqual({ candidate: null, baseline: null });
    // Picking the candidate's run as the baseline never yields the same run on both sides.
    const d = pickDefaults(runs, null, "c");
    expect(d.candidate?.run_id).not.toBe("c");
  });

  it("a held-out case's content duplicated as a dev case is locked from the very first run", async () => {
    await copyStarter("dup-bot", (c) => (c.example = false));
    const dir = path.join(agentsDir, "dup-bot");
    await fs.appendFile(path.join(dir, "cases.jsonl"), '{"case_id":"d99","input":{"question":"Can I get my money back for this month? I\'m on the monthly plan."}}\n');
    const agent = await getAgent("dup-bot");
    const err = await importRun({ agent, text: '{"case_id":"d99","output":"x"}', agent_version: "v1", actor: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(ImportValidationError);
  });

  it("a regex must:match on a blank answer field is ERROR", () => {
    const cfg = CheckConfig.parse({ id: "m", question: "q", type: "regex", field: "answer", pattern: "^.*$", must: "match" });
    const a = { config: { checks: [cfg] } } as unknown as LoadedAgentT;
    const t = { trace_id: "t", agent_id: "x", run_id: "r", case_id: "c", timestamp: "", agent_version: "v", input: {}, output: { answer: "", other: "text" }, evidence: [], tool_calls: [], model_id: null, latency_ms: null, cost_usd: null, execution_mode: "imported", execution_error: null, data_origin: "real", metadata: {} } as const;
    expect(runCheck(cfg, checkDefinitions(a)[0], t as unknown as AgentTraceT, null, {}).outcome).toBe("ERROR");
  });
});

describe("listing", () => {
  it("lists every valid agent with its status", async () => {
    const { agents } = await agentsList();
    expect(agents.map((a) => a.agent_id)).toEqual(expect.arrayContaining(["example-support-bot", "real-bot", "http-bot"]));
    // The list shows the same verdict as the agent's own gate.
    expect(agents.find((a) => a.agent_id === "real-bot")!.status).toBe((await agentOverview("real-bot")).gate.status);
    expect(agents.find((a) => a.agent_id === "example-support-bot")!).toMatchObject({ example: true, cases: 12, runs: 2 });
  });
});
