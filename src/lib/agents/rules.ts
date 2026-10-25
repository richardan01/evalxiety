/**
 * Trying a rule before it counts: run it on the agent's real answers, and on a bad answer the person writes (the
 * "probe"), and show what it would say.
 *
 * A rule is added only once it has FAILED at least once, on a real answer or on the probe. A rule that can never fail
 * (a typo in a phrase, a limit nothing reaches) would make every version look good; making it fail first proves it can
 * catch something. A rule that fails only because it reads a field no answer has (a typo in the field name), or compares
 * text answers with structured reference answers, fails everything for that reason alone: that proves nothing, so it
 * can't be added. The server re-runs this check when the rule is saved, so the browser can't skip it.
 */
import { z } from "zod";
import { stableStringify } from "../storage/store";
import { asText, checkDefinitions, getPath, hasPath, parsedOutput, runCheck } from "./checks";
import { parseAgentConfig } from "./config";
import { EditError } from "./edit";
import { CUSTOM_CHECKS } from "./registry";
import { getAgentTrace, listAgentRuns } from "./repo";
import { CaseId, type AgentTrace, type CheckConfig, type LoadedAgent } from "./schemas";
import type { LockState } from "./ingest";

export const Probe = z.object({
  /** A bad answer the rule should catch: plain text (put in the field the rule reads) or the agent's whole JSON answer. */
  answer: z.string().trim().min(1, "write a bad answer the rule should catch").max(20_000),
  /** The test case it answers (matters for "matches the reference answer"). Default: the first visible case. */
  case_id: CaseId.optional(),
});
export type Probe = z.infer<typeof Probe>;

type Outcome = "PASS" | "FAIL" | "NOT_APPLICABLE" | "ERROR";

export interface RulePreview {
  /** The test whose answers it ran on (the latest completed one unless another was picked). */
  run: { run_id: string; agent_version: string; created_at: string } | null;
  results: Array<{ case_id: string; outcome: Outcome; summary: string; answer: string }>;
  counts: { pass: number; fail: number; not_applicable: number; error: number };
  /** counts_as_proof: it FAILED, on a field real answers have (or there are no real answers yet to compare with). */
  probe: { case_id: string; outcome: Outcome; summary: string; counts_as_proof: boolean } | null;
  /** It failed at least once, and not merely because it reads a field no answer has, so it can catch something. */
  proven: boolean;
  proven_by: { kind: "answer"; case_id: string; run_id: string } | { kind: "probe"; case_id: string } | null;
  warnings: string[];
}

/** Where a rule reads its answer from (the field a probe's text goes in). */
const ruleField = (r: CheckConfig): string => ("field" in r ? r.field : r.type === "cites_evidence" ? r.citations_field : "");

/** { a: { b: text } } for "a.b". */
function nest(path: string, value: unknown): unknown {
  return path.split(".").reduceRight<unknown>((v, key) => ({ [key]: v }), value);
}

/** A typed time or cost: "9000", "9000 ms", "9 s" → ms; "0.5", "$0.50", "0.5 USD" → dollars. Null if it isn't one. */
export function measureOf(rule: CheckConfig, text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (rule.type === "max_latency_ms") {
    const m = /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)?$/i.exec(t);
    return m ? Number(m[1]) * (m[2] && /^s/i.test(m[2]) ? 1000 : 1) : null;
  }
  if (rule.type === "max_cost_usd") {
    const m = /^\$?\s*(\d+(?:\.\d+)?)\s*(usd|dollars?)?$/i.exec(t);
    return m ? Number(m[1]) : null;
  }
  return null;
}

/**
 * The probe as a trace. Text goes in the field the rule reads (so "must not contain" sees it where real answers have
 * it); text that is JSON is used as the whole answer. For time and cost limits, the text is the measurement; for "no
 * tool errors", it's a failed tool call's error. For "must fill in a field", the field is left blank.
 */
export function probeTrace(agent: LoadedAgent, rule: CheckConfig, caseId: string, text: string): AgentTrace {
  const testCase = agent.cases.find((c) => c.case_id === caseId);
  const trimmed = text.trim();
  const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const notAnswer = rule.type === "max_latency_ms" || rule.type === "max_cost_usd" || rule.type === "no_tool_errors";
  const path = ruleField(rule);
  return {
    trace_id: "probe",
    agent_id: agent.agent_id,
    run_id: "probe",
    case_id: caseId,
    timestamp: new Date().toISOString(),
    agent_version: "probe",
    input: testCase?.input ?? null,
    output: notAnswer
      ? "(probe)"
      : rule.type === "non_empty"
        ? // The bad answer for "must fill in a field": that field blank while the rest has text (a wholly empty answer
          // is already an error on every rule, before any rule runs).
          { ...(nest(path, "") as Record<string, unknown>), other_text: text }
        : isJson || !path
          ? text
          : nest(path, text),
    evidence: [],
    tool_calls: rule.type === "no_tool_errors" ? [{ name: "tool", error: trimmed }] : [],
    model_id: null,
    latency_ms: rule.type === "max_latency_ms" ? measureOf(rule, text) : null,
    cost_usd: rule.type === "max_cost_usd" ? measureOf(rule, text) : null,
    execution_mode: "imported",
    execution_error: null,
    data_origin: "real",
    metadata: {},
  };
}

/** The answer fields a rule reads. */
function fieldsRead(r: CheckConfig): string[] {
  if (r.type === "json_output") return r.required_fields;
  if (r.type === "cites_evidence") return [r.citations_field];
  return "field" in r && r.field ? [r.field] : [];
}

/**
 * Types that FAIL outright on an answer without a field they read. If no answer has the field (a typo), such a rule
 * fails everything for that reason alone, so neither those failures nor a bad answer built around the field prove
 * anything. "Must not contain" and length rules read the whole answer instead.
 */
const failsWhenMissing = (r: CheckConfig) =>
  ["non_empty", "matches_expected", "cites_evidence", "json_output"].includes(r.type) || (r.type === "regex" && r.must === "match");

const isObject = (v: unknown) => v !== null && typeof v === "object";

/** Problems with the rule on its own (an invalid pattern, a length rule without a limit), in the loader's words. */
export function ruleProblems(agent: LoadedAgent, rule: CheckConfig): string[] {
  if (rule.type === "custom") return ["Custom rules run your own code, so they're added in agents/custom-checks.ts, not in the app."];
  return parseAgentConfig({ name: agent.config.name, checks: [rule] }, agent.agent_id).problems;
}

const excerpt = (v: unknown) => {
  const s = asText(v).replace(/\s+/g, " ").trim();
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
};

export async function previewRule(agent: LoadedAgent, lock: LockState, rule: CheckConfig, opts: { run_id?: string | null; probe?: Probe | null } = {}): Promise<RulePreview> {
  const problems = ruleProblems(agent, rule);
  if (problems.length) throw new EditError(problems.join("; "));
  const def = checkDefinitions({ config: { ...agent.config, checks: [rule] } })[0];
  const allowEmpty = agent.config.allow_empty_output;
  const visible = agent.cases.filter((c) => !lock.locked.has(c.case_id));
  const warnings: string[] = [];

  // The latest finished test, skipping scratch tests (trial runs) unless one is picked.
  const runs = (await listAgentRuns(agent.agent_id)).filter((r) => r.status === "completed").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const run = opts.run_id ? runs.find((r) => r.run_id === opts.run_id) : runs.find((r) => !r.agent_version.trim().toLowerCase().startsWith("scratch-")) ?? runs[0];
  if (opts.run_id && !run) throw new EditError("That test doesn't exist or hasn't finished.", 404);

  const results: RulePreview["results"] = [];
  const answered: AgentTrace[] = [];
  let stale = 0;
  if (run) {
    for (const c of visible) {
      const tid = run.trace_ids[c.case_id];
      const trace = tid ? await getAgentTrace(agent.agent_id, tid) : null;
      if (!trace) continue;
      // An answer to an older wording of the question says nothing about this case now.
      if (stableStringify(trace.input) !== stableStringify(c.input)) {
        stale++;
        continue;
      }
      if (!trace.execution_error) answered.push(trace);
      const r = runCheck(rule, def, trace, c, CUSTOM_CHECKS, allowEmpty);
      // Show what the rule read: its field when the answer has it, else the whole answer.
      const out = parsedOutput(trace.output);
      const field = ruleField(rule);
      results.push({ case_id: c.case_id, outcome: r.outcome, summary: r.summary, answer: excerpt(field && hasPath(out, field) ? getPath(out, field) : out) });
    }
  } else {
    warnings.push("There are no test results yet, so the rule can only be tried on a bad answer you write.");
  }
  if (stale) warnings.push(`${stale} answer(s) in this test were to an older wording of their question, so they were left out.`);

  // A field no answer has: probably a typo.
  const unseen = answered.length ? fieldsRead(rule).filter((f) => !answered.some((t) => hasPath(parsedOutput(t.output), f))) : [];
  let blocked = false;
  if (unseen.length) {
    const names = unseen.map((f) => `“${f}”`).join(", ");
    if (failsWhenMissing(rule)) {
      blocked = true;
      warnings.push(`None of the answers has ${names}, so this rule would fail every answer for that reason alone. Check the field name: it can't be added like this.`);
    } else {
      warnings.push(`None of the answers has ${names}, so it reads the whole answer instead. Check the field name.`);
    }
  }
  // A reference that is an object compared with an answer that is text can never match: every case would fail.
  if (rule.type === "matches_expected" && answered.length) {
    const refs = visible.map((c) => (c.expected !== undefined && hasPath(c.expected, rule.expected_field) ? getPath(c.expected, rule.expected_field) : undefined)).filter((v) => v !== undefined);
    const reads = answered.map((t) => getPath(parsedOutput(t.output), rule.field));
    if (refs.length && refs.every(isObject) && reads.every((v) => typeof v === "string")) {
      blocked = true;
      const keys = [...new Set(refs.flatMap((r) => (r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r) : [])))];
      warnings.push(`The reference answers are structured (${keys.slice(0, 3).join(", ") || "lists"}) but the answers are text, so they could never match. Pick which part of the reference answer to compare${keys.length ? `, e.g. “${keys[0]}”` : ""}.`);
    }
  }

  const counts = {
    pass: results.filter((r) => r.outcome === "PASS").length,
    fail: results.filter((r) => r.outcome === "FAIL").length,
    not_applicable: results.filter((r) => r.outcome === "NOT_APPLICABLE").length,
    error: results.filter((r) => r.outcome === "ERROR").length,
  };
  if (results.length > 1 && counts.fail === results.length && !blocked) warnings.push(`It fails on every answer (${counts.fail} of ${results.length}). Check it isn't stricter than you meant.`);
  if (counts.error) warnings.push(`It couldn't check ${counts.error} answer(s): the reason is next to each one. Those count as not passing.`);
  if (results.length && counts.not_applicable === results.length) warnings.push("It didn't apply to any answer, so it would never catch anything on these test cases.");
  if (rule.type === "matches_expected" && !visible.some((c) => c.expected !== undefined && hasPath(c.expected, rule.expected_field))) {
    warnings.push("No test case has this reference answer, so the rule would never apply. Add reference answers to your test cases first.");
  }

  let probe: RulePreview["probe"] = null;
  if (opts.probe) {
    const caseId =
      opts.probe.case_id ??
      (rule.type === "matches_expected" ? visible.find((c) => c.expected !== undefined)?.case_id : undefined) ??
      visible[0]?.case_id;
    const testCase = visible.find((c) => c.case_id === caseId);
    if (!testCase) throw new EditError(opts.probe.case_id ? `"${opts.probe.case_id}" isn't a test case you can use here.` : "There is no test case to try the bad answer on.");
    if ((rule.type === "max_latency_ms" || rule.type === "max_cost_usd") && measureOf(rule, opts.probe.answer) === null) {
      throw new EditError(rule.type === "max_latency_ms" ? "Write how long the slow answer took, e.g. 9000 ms or 9 s." : "Write what the expensive answer cost, e.g. $0.50.");
    }
    const r = runCheck(rule, def, probeTrace(agent, rule, testCase.case_id, opts.probe.answer), testCase, CUSTOM_CHECKS, allowEmpty);
    probe = { case_id: testCase.case_id, outcome: r.outcome, summary: r.summary, counts_as_proof: r.outcome === "FAIL" && !blocked };
  }

  const failed = results.find((r) => r.outcome === "FAIL");
  const proven_by: RulePreview["proven_by"] = blocked
    ? null
    : failed && run
      ? { kind: "answer", case_id: failed.case_id, run_id: run.run_id }
      : probe?.counts_as_proof
        ? { kind: "probe", case_id: probe.case_id }
        : null;
  return { run: run ? { run_id: run.run_id, agent_version: run.agent_version, created_at: run.created_at } : null, results, counts, probe, proven: proven_by !== null, proven_by, warnings };
}

export class NotProvenError extends EditError {
  constructor(readonly preview: RulePreview) {
    super(
      "This rule hasn't failed on anything yet, so there's no proof it can catch a problem. Write a bad answer it should catch under “Try it on a bad answer”, then add it.",
      422,
    );
  }
}
