/**
 * Code checks for any agent.
 *
 * Built-in check types are configured in agent.json and covered by unit tests (checks.test.ts). Custom checks
 * are TypeScript functions registered in agents/custom-checks.ts; they are the agent owner's code, so they are
 * labelled "custom" and their owner is responsible for forcing each one to FAIL at least once.
 *
 * Every check answers one yes/no question with PASS / FAIL, NOT_APPLICABLE (nothing to check on this trace) or
 * ERROR (the check could not run — never counted as a pass). Checks fail closed: an empty answer, an errored call,
 * a changed output shape, text a pattern could not fully read, or a pattern that runs too long never yields PASS.
 */
import vm from "node:vm";
import type { DeterministicResult, EvalOutcome } from "../domain/schemas";
import { sha256, stableStringify } from "../storage/store";
import type { AgentCase, AgentTrace, CheckConfig, LoadedAgent } from "./schemas";

export interface CustomCheckContext {
  trace: AgentTrace;
  testCase: AgentCase | null;
  /** The trace output, with a JSON string parsed into a value. */
  output: unknown;
}

export interface CustomCheckOutcome {
  outcome: "PASS" | "FAIL" | "NOT_APPLICABLE";
  summary: string;
  details?: Record<string, unknown>;
}

export type CustomCheckFn = (ctx: CustomCheckContext) => CustomCheckOutcome;

/** agent_id → function name → check. Filled from agents/custom-checks.ts. */
export type CustomCheckRegistry = Record<string, Record<string, CustomCheckFn>>;

export interface AgentCheckDefinition {
  evaluator_id: string;
  type: CheckConfig["type"];
  version: string;
  question: string;
  rule: string;
  severity: CheckConfig["severity"];
  blocking: boolean;
  fix_hint: string | null;
  validation: "built_in_tested" | "custom";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a JSON string output into a value; leave plain text as text. */
export function parsedOutput(output: unknown): unknown {
  if (typeof output !== "string") return output;
  const t = output.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return output;
  try {
    return JSON.parse(t);
  } catch {
    return output;
  }
}

const MISSING = Symbol("missing");

/** Read a dot path ("a.b.0"). "" returns the value itself. Own properties only, so "__proto__" is never followed. */
export function getPath(value: unknown, path: string): unknown | typeof MISSING {
  if (path === "") return value;
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return MISSING;
    if (Array.isArray(cur)) {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return MISSING;
      cur = cur[i];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, key)) return MISSING;
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

/** True when the dot path exists (even if its value is null). */
export function hasPath(value: unknown, path: string): boolean {
  return getPath(value, path) !== MISSING;
}

export function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Every string, number and boolean inside a value, in document order — the text a reader would see, without JSON
 * punctuation. Iterative, so deeply nested output can't overflow the stack.
 */
export function textLeaves(value: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || v === undefined) continue;
    if (typeof v === "string") out.push(v);
    else if (typeof v === "number" || typeof v === "boolean") out.push(String(v));
    else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    else if (typeof v === "object") {
      const vals = Object.values(v as Record<string, unknown>);
      for (let i = vals.length - 1; i >= 0; i--) stack.push(vals[i]);
    }
  }
  return out;
}

/** Blank = only whitespace or invisible format characters (zero-width space/joiner, word joiner, BOM, soft hyphen). */
export const isBlank = (s: string) => s.replace(/[\s\u200B-\u200D\u2060\uFEFF\u00AD]/g, "") === "";

/** No answer at all: null, a blank string, or a JSON value with no non-blank text in it ({} / [] / {"answer": ""}). */
export function isEmptyOutput(output: unknown): boolean {
  return textLeaves(parsedOutput(output)).every(isBlank);
}

/** Text longer than this can't be scanned in full, so a regex check on longer text reports ERROR, never PASS. */
export const MAX_REGEX_INPUT = 100_000;
/** A pattern that backtracks longer than this is stopped and reported as ERROR, so it can't stall the server. */
export const REGEX_TIMEOUT_MS = 250;

const regexSandbox = vm.createContext({ re: null as RegExp | null, s: "" });

/** Run a regex with a hard time limit. Returns the match, null, or "timeout". */
export function matchWithTimeout(re: RegExp, text: string, timeoutMs = REGEX_TIMEOUT_MS): RegExpMatchArray | null | "timeout" {
  regexSandbox.re = re;
  regexSandbox.s = text;
  try {
    return vm.runInContext("s.match(re)", regexSandbox, { timeout: timeoutMs }) as RegExpMatchArray | null;
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return "timeout";
    throw e;
  } finally {
    regexSandbox.re = null;
    regexSandbox.s = "";
  }
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : stableStringify(v));

function describeRule(c: CheckConfig): string {
  const f = (p: string) => (p ? `\`${p}\`` : "the output");
  switch (c.type) {
    case "json_output":
      return c.required_fields.length
        ? `Output is a JSON object or array with ${c.required_fields.map((x) => `\`${x}\``).join(", ")} present and not null.`
        : "Output is a JSON object or array.";
    case "matches_expected":
      return `${f(c.field)} ${c.mode === "contains" ? "contains (case-insensitive)" : c.mode === "case_insensitive" ? "equals (ignoring case and surrounding spaces)" : "equals"} the case's expected${c.expected_field ? `.${c.expected_field}` : ""}. Not applicable when the case has no expected value.`;
    case "regex":
      return `${f(c.field)} ${c.must === "match" ? "matches" : "does not match"} /${c.pattern}/${c.flags}.`;
    case "max_length":
      return `${f(c.field)} is at most ${[c.max_chars && `${c.max_chars} characters`, c.max_words && `${c.max_words} words`].filter(Boolean).join(" and ")}.`;
    case "non_empty":
      return `${f(c.field)} contains some non-blank text.`;
    case "cites_evidence":
      return `Every id cited in \`${c.citations_field}\` exists in the trace's evidence${c.require_at_least_one ? ", and at least one is cited" : ""}. Fails if the field is missing.`;
    case "no_tool_errors":
      return "No tool call in the trace reports an error.";
    case "max_latency_ms":
      return `Latency is at most ${c.max} ms.`;
    case "max_cost_usd":
      return `Cost is at most $${c.max}.`;
    case "custom":
      return `Custom function \`${c.function}\` (agents/custom-checks.ts).`;
  }
}

export function checkDefinitions(agent: Pick<LoadedAgent, "config">): AgentCheckDefinition[] {
  return agent.config.checks.map((c) => ({
    evaluator_id: c.id,
    type: c.type,
    version: sha256(c).slice(0, 8),
    question: c.question,
    rule: describeRule(c),
    severity: c.severity,
    blocking: c.blocking,
    fix_hint: c.fix_hint ?? null,
    validation: c.type === "custom" ? "custom" : "built_in_tested",
  }));
}

// ---------------------------------------------------------------------------
// Built-in check implementations
// ---------------------------------------------------------------------------

type Verdict = { outcome: EvalOutcome; summary: string; details?: Record<string, unknown> };

/**
 * The text a "must not" or length check reads. When the configured field is missing (the output changed shape), it
 * reads every text value in the whole output instead, so the check can't be switched off. When the field is there but
 * empty, the answer itself is empty: that's an ERROR, never a pass (unless the agent allows empty output).
 */
function scopedText(out: unknown, path: string, allowEmpty: boolean): { text: string; note: string } | { empty: string } {
  const v = getPath(out, path);
  if (path && v === MISSING) {
    return { text: textLeaves(out).join("\n"), note: ` (\`${path}\` is missing, so the whole output was checked)` };
  }
  const text = typeof v === "string" ? v : textLeaves(v).join("\n");
  if (path && !allowEmpty && isBlank(text)) return { empty: `\`${path}\` is empty, so there is no answer to check.` };
  return { text, note: "" };
}

/** Check versions whose pattern ran out of time once: further traces get ERROR without running it again. */
const slowPatterns = new Set<string>();

function runBuiltIn(c: Exclude<CheckConfig, { type: "custom" }>, trace: AgentTrace, testCase: AgentCase | null, allowEmpty: boolean, slowKey: string): Verdict {
  const out = parsedOutput(trace.output);
  const field = (path: string) => getPath(out, path);
  switch (c.type) {
    case "json_output": {
      if (out === null || typeof out !== "object") {
        return { outcome: "FAIL", summary: "Output is not JSON (an object or array was expected).", details: { output_type: typeof out } };
      }
      const missing = c.required_fields.filter((p) => {
        const v = field(p);
        return v === MISSING || v === null || v === undefined;
      });
      return missing.length
        ? { outcome: "FAIL", summary: `Missing or null field(s): ${missing.join(", ")}.`, details: { missing } }
        : { outcome: "PASS", summary: c.required_fields.length ? "All required fields present." : "Output is JSON." };
    }
    case "matches_expected": {
      if (!testCase || testCase.expected === undefined) return { outcome: "NOT_APPLICABLE", summary: "This case has no expected value." };
      const expected = getPath(testCase.expected, c.expected_field);
      if (expected === MISSING) return { outcome: "NOT_APPLICABLE", summary: `The case's expected value has no \`${c.expected_field}\`.` };
      const actual = field(c.field);
      if (actual === MISSING) return { outcome: "FAIL", summary: `Output has no \`${c.field}\` to compare.`, details: { expected } };
      const okay =
        c.mode === "exact"
          ? stableStringify(actual) === stableStringify(expected)
          : c.mode === "case_insensitive"
            ? norm(actual) === norm(expected)
            : asText(actual).toLowerCase().includes(asText(expected).toLowerCase());
      return okay
        ? { outcome: "PASS", summary: "Matches the expected value.", details: { expected, actual } }
        : { outcome: "FAIL", summary: "Does not match the expected value.", details: { expected, actual } };
    }
    case "regex": {
      let re: RegExp;
      try {
        re = new RegExp(c.pattern, c.flags);
      } catch (e) {
        return { outcome: "ERROR", summary: `Invalid pattern: ${e instanceof Error ? e.message : String(e)}` };
      }
      const slow = { outcome: "ERROR" as const, summary: `The pattern ran longer than ${REGEX_TIMEOUT_MS} ms (catastrophic backtracking?) and was stopped; it isn't run again until the app restarts. Simplify it.` };
      if (slowPatterns.has(slowKey)) return slow;
      const tooLong = (n: number) => ({ outcome: "ERROR" as const, summary: `Text is ${n} characters; a pattern can only scan ${MAX_REGEX_INPUT}, so the result would be a guess.` });
      if (c.must === "match") {
        const v = field(c.field);
        if (v === MISSING) return { outcome: "FAIL", summary: `Output has no \`${c.field}\`.` };
        const text = typeof v === "string" ? v : textLeaves(v).join("\n");
        if (text.length > MAX_REGEX_INPUT) return tooLong(text.length);
        const m = matchWithTimeout(re, text);
        if (m === "timeout") {
          slowPatterns.add(slowKey);
          return slow;
        }
        return m ? { outcome: "PASS", summary: "Pattern found." } : { outcome: "FAIL", summary: `Pattern /${c.pattern}/ not found.` };
      }
      const scoped = scopedText(out, c.field, allowEmpty);
      if ("empty" in scoped) return { outcome: "ERROR", summary: scoped.empty };
      const { text, note } = scoped;
      if (text.length > MAX_REGEX_INPUT) return tooLong(text.length);
      const m = matchWithTimeout(re, text);
      if (m === "timeout") {
        slowPatterns.add(slowKey);
        return slow;
      }
      return m
        ? { outcome: "FAIL", summary: `Forbidden pattern found: "${m[0].slice(0, 80)}"${note}.`, details: { match: m[0].slice(0, 200) } }
        : { outcome: "PASS", summary: `Forbidden pattern absent${note}.` };
    }
    case "max_length": {
      const scoped = scopedText(out, c.field, allowEmpty);
      if ("empty" in scoped) return { outcome: "ERROR", summary: scoped.empty };
      const { text, note } = scoped;
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const over = [
        c.max_chars !== undefined && chars > c.max_chars ? `${chars} chars > ${c.max_chars}` : null,
        c.max_words !== undefined && words > c.max_words ? `${words} words > ${c.max_words}` : null,
      ].filter((x): x is string => x !== null);
      return over.length
        ? { outcome: "FAIL", summary: `Too long: ${over.join(", ")}${note}.`, details: { chars, words } }
        : { outcome: "PASS", summary: `${words} words, ${chars} chars${note}.`, details: { chars, words } };
    }
    case "non_empty": {
      const v = field(c.field);
      if (v === MISSING) return { outcome: "FAIL", summary: `Output has no \`${c.field}\`.` };
      return textLeaves(v).some((t) => !isBlank(t))
        ? { outcome: "PASS", summary: "Has an answer." }
        : { outcome: "FAIL", summary: `${c.field ? `\`${c.field}\`` : "The output"} has no text in it.` };
    }
    case "cites_evidence": {
      const raw = field(c.citations_field);
      // Fail closed: if the field disappears (renamed, plain-text output) the citations can't be checked at all.
      if (raw === MISSING) return { outcome: "FAIL", summary: `Output has no \`${c.citations_field}\`, so its citations can't be checked.` };
      const cited = raw === null ? [] : Array.isArray(raw) ? raw : [raw];
      const ids: string[] = [];
      for (const x of cited) {
        if (typeof x === "string") ids.push(x);
        else if (x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") ids.push((x as { id: string }).id);
        else return { outcome: "ERROR", summary: `\`${c.citations_field}\` must be a list of ids or of objects with an id.` };
      }
      if (ids.length === 0) {
        return c.require_at_least_one
          ? { outcome: "FAIL", summary: "The answer cites no evidence." }
          : { outcome: "NOT_APPLICABLE", summary: "The answer cites no evidence." };
      }
      const known = new Set(trace.evidence.map((e) => e.id));
      const unknown = ids.filter((id) => !known.has(id));
      return unknown.length
        ? { outcome: "FAIL", summary: `Cites evidence the agent was not given: ${unknown.join(", ")}.`, details: { unknown, cited: ids } }
        : { outcome: "PASS", summary: `All ${ids.length} citation(s) exist in the evidence.`, details: { cited: ids } };
    }
    case "no_tool_errors": {
      if (trace.tool_calls.length === 0) return { outcome: "NOT_APPLICABLE", summary: "No tool calls." };
      const bad = trace.tool_calls.filter((t) => t.error);
      return bad.length
        ? { outcome: "FAIL", summary: `${bad.length} tool call(s) errored: ${bad.map((t) => t.name).join(", ")}.`, details: { errors: bad.map((t) => ({ name: t.name, error: t.error })) } }
        : { outcome: "PASS", summary: `${trace.tool_calls.length} tool call(s), none errored.` };
    }
    case "max_latency_ms":
      if (trace.latency_ms === null) return { outcome: "NOT_APPLICABLE", summary: "No latency recorded." };
      return trace.latency_ms <= c.max
        ? { outcome: "PASS", summary: `${Math.round(trace.latency_ms)} ms ≤ ${c.max} ms.` }
        : { outcome: "FAIL", summary: `${Math.round(trace.latency_ms)} ms > ${c.max} ms.` };
    case "max_cost_usd":
      if (trace.cost_usd === null) return { outcome: "NOT_APPLICABLE", summary: "No cost recorded." };
      return trace.cost_usd <= c.max
        ? { outcome: "PASS", summary: `$${trace.cost_usd} ≤ $${c.max}.` }
        : { outcome: "FAIL", summary: `$${trace.cost_usd} > $${c.max}.` };
  }
}

/** Run one configured check on one trace. Never throws. */
/** Own-property lookup, so names like "toString" or "constructor" never resolve to something inherited. */
export function lookupCustom(registry: CustomCheckRegistry, agentId: string, fn: string): CustomCheckFn | null {
  if (!Object.prototype.hasOwnProperty.call(registry, agentId)) return null;
  const forAgent = registry[agentId];
  if (!Object.prototype.hasOwnProperty.call(forAgent, fn)) return null;
  return typeof forAgent[fn] === "function" ? forAgent[fn] : null;
}

export function runCheck(
  c: CheckConfig,
  def: AgentCheckDefinition,
  trace: AgentTrace,
  testCase: AgentCase | null,
  registry: CustomCheckRegistry,
  allowEmpty = false,
): DeterministicResult {
  const base = {
    evaluator_id: c.id,
    evaluator_version: def.version,
    trace_id: trace.trace_id,
    case_id: trace.case_id,
    severity: c.severity,
  };
  // An errored call or an empty answer is not an answer: never grade it (a blank string would pass "must not" checks).
  if (trace.execution_error) {
    return { ...base, outcome: "ERROR", summary: `The agent call failed: ${trace.execution_error}`, details: {} };
  }
  if (!allowEmpty && isEmptyOutput(trace.output)) {
    return { ...base, outcome: "ERROR", summary: "The agent returned no answer (empty output).", details: {} };
  }
  let v: Verdict;
  try {
    if (c.type === "custom") {
      const fn = lookupCustom(registry, trace.agent_id, c.function);
      if (!fn) {
        v = { outcome: "ERROR", summary: `No custom check \`${c.function}\` registered for ${trace.agent_id} in agents/custom-checks.ts.` };
      } else {
        const r = fn({ trace, testCase, output: parsedOutput(trace.output) });
        v = ["PASS", "FAIL", "NOT_APPLICABLE"].includes(r?.outcome)
          ? r
          : { outcome: "ERROR", summary: "Custom check returned an invalid outcome (expected PASS, FAIL or NOT_APPLICABLE)." };
      }
    } else {
      v = runBuiltIn(c, trace, testCase, allowEmpty, `${trace.agent_id}|${behaviourVersion(c)}`);
    }
  } catch (e) {
    v = { outcome: "ERROR", summary: `Check threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ...base, outcome: v.outcome, summary: v.summary, details: v.details ?? {} };
}

/** Hash of what a check does (everything but its question and fix_hint), so wording edits don't re-run it. */
function behaviourVersion(c: CheckConfig): string {
  const { question: _q, fix_hint: _h, ...behaviour } = c;
  void _q;
  void _h;
  return sha256(behaviour).slice(0, 12);
}

/**
 * Results per (trace, check behaviour, case expectation). Traces never change after they are saved, so a result can be
 * reused: each check runs once per trace per process, not on every page load or poll. Least-recently-used entries
 * are evicted one at a time. Custom checks are not cached (their code can change without the config changing).
 */
const resultCache = new Map<string, DeterministicResult>();
const CACHE_LIMIT = 200_000;

function cacheGet(key: string): DeterministicResult | undefined {
  const hit = resultCache.get(key);
  if (hit) {
    resultCache.delete(key);
    resultCache.set(key, hit); // most recently used goes last
  }
  return hit;
}

function cacheSet(key: string, r: DeterministicResult) {
  if (resultCache.size >= CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value!);
  resultCache.set(key, r);
}

/** Run every configured check on one trace. */
export function runChecks(agent: LoadedAgent, trace: AgentTrace, registry: CustomCheckRegistry): DeterministicResult[] {
  const defs = checkDefinitions(agent);
  const testCase = agent.cases.find((x) => x.case_id === trace.case_id) ?? null;
  const allowEmpty = agent.config.allow_empty_output;
  const caseKey = testCase ? sha256({ has: testCase.expected !== undefined, expected: testCase.expected ?? null }).slice(0, 12) : "none";
  return agent.config.checks.map((c, i) => {
    if (c.type === "custom") return runCheck(c, defs[i], trace, testCase, registry, allowEmpty);
    // Wording edits (question, fix_hint) don't change the result, so they don't re-run the check: only the label moves.
    const key = `${agent.agent_id}|${trace.trace_id}|${behaviourVersion(c)}|${c.severity}|${caseKey}|${allowEmpty}`;
    const hit = cacheGet(key);
    if (hit) return hit.evaluator_version === defs[i].version ? hit : { ...hit, evaluator_version: defs[i].version };
    const r = runCheck(c, defs[i], trace, testCase, registry, allowEmpty);
    cacheSet(key, r);
    return r;
  });
}
