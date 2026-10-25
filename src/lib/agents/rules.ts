/**
 * Trying a rule before it counts: run it on the agent's real answers, and on a bad answer the person writes (the
 * "probe"), and show what it would say.
 *
 * A rule is added only once it has FAILED at least once, on a real answer or on the probe. A rule that can never fail
 * (a typo in a phrase, a limit nothing reaches, the wrong field) would make every version look good; making it fail
 * first proves it can catch something. The server re-runs this check when the rule is saved, so the browser can't skip it.
 */
import { z } from "zod";
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
  /** counts_as_proof: it FAILED, and not merely because the answer lacks the field the rule reads. */
  probe: { case_id: string; outcome: Outcome; summary: string; counts_as_proof: boolean } | null;
  /** It failed at least once on an answer that has the field it reads, so it can catch something. */
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

/**
 * The probe as a trace. Text goes in the field the rule reads (so "must not contain" sees it where real answers have
 * it); text that is JSON is used as the whole answer. For time and cost limits, the text is the number. For "must give
 * an answer", the field is left blank.
 */
export function probeTrace(agent: LoadedAgent, rule: CheckConfig, caseId: string, text: string): AgentTrace {
  const testCase = agent.cases.find((c) => c.case_id === caseId);
  const trimmed = text.trim();
  const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const number = Number(trimmed);
  const measured = rule.type === "max_latency_ms" || rule.type === "max_cost_usd";
  const path = ruleField(rule);
  return {
    trace_id: "probe",
    agent_id: agent.agent_id,
    run_id: "probe",
    case_id: caseId,
    timestamp: new Date().toISOString(),
    agent_version: "probe",
    input: testCase?.input ?? null,
    output: measured
      ? "(probe)"
      : rule.type === "non_empty"
        ? // The bad answer for "must give an answer": that field blank while the rest has text (a wholly empty answer is
          // already an error on every rule, before any rule runs).
          { ...(nest(path, "") as Record<string, unknown>), other_text: text }
        : isJson || !path
          ? text
          : nest(path, text),
    evidence: [],
    tool_calls: [],
    model_id: null,
    latency_ms: rule.type === "max_latency_ms" && Number.isFinite(number) ? number : null,
    cost_usd: rule.type === "max_cost_usd" && Number.isFinite(number) ? number : null,
    execution_mode: "imported",
    execution_error: null,
    data_origin: "real",
    metadata: {},
  };
}

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

  const runs = (await listAgentRuns(agent.agent_id)).filter((r) => r.status === "completed").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const run = opts.run_id ? runs.find((r) => r.run_id === opts.run_id) : runs[0];
  if (opts.run_id && !run) throw new EditError("That test doesn't exist or hasn't finished.", 404);

  const results: RulePreview["results"] = [];
  const field = ruleField(rule);
  const hasField = (t: AgentTrace) => !field || Boolean(t.execution_error) || hasPath(parsedOutput(t.output), field);
  // These types FAIL outright when the field is missing; such a FAIL (a typo in the field name) proves nothing about the
  // rule. "Must not contain" and length rules read the whole answer instead, so their FAIL still means something.
  const failsWhenMissing = ["non_empty", "matches_expected", "cites_evidence"].includes(rule.type) || (rule.type === "regex" && rule.must === "match");
  const lacksField = (t: AgentTrace) => failsWhenMissing && !hasField(t);
  const failedWithField: string[] = [];
  let missingField = 0;
  if (run) {
    for (const c of visible) {
      const tid = run.trace_ids[c.case_id];
      const trace = tid ? await getAgentTrace(agent.agent_id, tid) : null;
      if (!trace) continue;
      const r = runCheck(rule, def, trace, c, CUSTOM_CHECKS, allowEmpty);
      // Show what the rule read: its field when the answer has it, else the whole answer.
      const out = parsedOutput(trace.output);
      if (!hasField(trace)) missingField++;
      if (r.outcome === "FAIL" && !lacksField(trace)) failedWithField.push(c.case_id);
      results.push({ case_id: c.case_id, outcome: r.outcome, summary: r.summary, answer: excerpt(field && hasPath(out, field) ? getPath(out, field) : out) });
    }
  } else {
    warnings.push("There are no test results yet, so the rule can only be tried on a bad answer you write.");
  }
  const counts = {
    pass: results.filter((r) => r.outcome === "PASS").length,
    fail: results.filter((r) => r.outcome === "FAIL").length,
    not_applicable: results.filter((r) => r.outcome === "NOT_APPLICABLE").length,
    error: results.filter((r) => r.outcome === "ERROR").length,
  };
  if (results.length && missingField === results.length) {
    warnings.push(`None of the answers has a field called “${field}”, so this rule isn't reading what you think. Check the field name.`);
  }
  if (results.length > 1 && counts.fail === results.length) warnings.push(`It fails on every answer (${counts.fail} of ${results.length}). Check it isn't stricter than you meant.`);
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
    const trace = probeTrace(agent, rule, testCase.case_id, opts.probe.answer);
    const r = runCheck(rule, def, trace, testCase, CUSTOM_CHECKS, allowEmpty);
    probe = { case_id: testCase.case_id, outcome: r.outcome, summary: r.summary, counts_as_proof: r.outcome === "FAIL" && !lacksField(trace) };
  }

  const proven_by: RulePreview["proven_by"] =
    failedWithField.length && run
      ? { kind: "answer", case_id: failedWithField[0], run_id: run.run_id }
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
