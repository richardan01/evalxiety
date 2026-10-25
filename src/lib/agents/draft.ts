/**
 * Claude drafts, a person decides: turning a plain-English requirement into a rule (or an AI reviewer question), and
 * proposing new test questions.
 *
 * Nothing here saves anything. A drafted rule still has to be tried and fail at least once before it can be added
 * (rules.ts); drafted questions are added only when a named person accepts them, and stay marked as AI-drafted.
 * Claude never labels an answer. Drafting needs live mode (a Claude API key); it's billed and capped like every
 * live call (callStructured reserves spend before calling).
 *
 * What is sent to Claude: the agent's name and description, the field names and types of its answers (not their
 * content), the field names of its reference answers, its rule ids, the person's request, and, for questions, up to 20
 * practice (dev) questions. Final-exam questions are never sent.
 */
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { callStructured, modeInfo } from "../llm/client";
import { asText, parsedOutput } from "./checks";
import { inputFromText, inputShape, ruleIdFrom } from "./define";
import { EditError } from "./edit";
import type { LockState } from "./ingest";
import { ruleProblems } from "./rules";
import { AGENT_ID_RE, AgentJudgeConfig, CheckConfig, type AgentTrace, type LoadedAgent } from "./schemas";

function requireLive() {
  const m = modeInfo();
  if (m.mode !== "live") {
    throw new EditError(`Drafting with Claude needs a Claude API key (${m.reason}). Connect one on the Connect page, or write it yourself below.`);
  }
}

const cacheDir = (agentId: string) => {
  if (!AGENT_ID_RE.test(agentId)) throw new Error(`Invalid agent id "${agentId}"`);
  return `agents/${agentId}/llm_cache`;
};

// ---------------------------------------------------------------------------
// What the answers look like (field names and types only)
// ---------------------------------------------------------------------------

export interface FieldInfo {
  path: string;
  type: string;
}

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "object" ? "object" : typeof v);

/** Field paths (two levels deep) and their types, across these values. Plain text answers give no fields. */
export function fieldsOf(values: unknown[], limit = 40): FieldInfo[] {
  const seen = new Map<string, Set<string>>();
  const add = (p: string, v: unknown) => seen.set(p, (seen.get(p) ?? new Set()).add(typeOf(v)));
  for (const v of values) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    for (const [k, x] of Object.entries(v)) {
      add(k, x);
      if (x && typeof x === "object" && !Array.isArray(x)) for (const [k2, y] of Object.entries(x)) add(`${k}.${k2}`, y);
    }
  }
  return [...seen].slice(0, limit).map(([path, types]) => ({ path, type: [...types].join(" or ") }));
}

/** The agent's answers, parsed: from the given traces that answered (no error, not empty). */
export function answerShape(traces: AgentTrace[]): { kind: "text" | "json" | "unknown"; fields: FieldInfo[] } {
  const outs = traces.filter((t) => !t.execution_error && t.output !== null && t.output !== undefined).map((t) => parsedOutput(t.output));
  if (!outs.length) return { kind: "unknown", fields: [] };
  const fields = fieldsOf(outs);
  return { kind: fields.length ? "json" : "text", fields };
}

const describeFields = (f: FieldInfo[]) => (f.length ? f.map((x) => `- ${x.path} (${x.type})`).join("\n") : "(none)");

// ---------------------------------------------------------------------------
// Rule from a plain-English requirement
// ---------------------------------------------------------------------------

const DraftOutput = z.object({
  kind: z.enum(["rule", "ai_reviewer", "unclear"]),
  explanation: z.string(),
  rule: z
    .object({
      id: z.string(),
      question: z.string(),
      type: z.enum(["non_empty", "regex", "max_length", "matches_expected", "json_output", "cites_evidence", "no_tool_errors", "max_latency_ms", "max_cost_usd"]),
      field: z.string().nullable(),
      pattern: z.string().nullable(),
      flags: z.string().nullable(),
      must: z.enum(["match", "no_match"]).nullable(),
      max_words: z.number().nullable(),
      max_chars: z.number().nullable(),
      mode: z.enum(["exact", "case_insensitive", "contains"]).nullable(),
      expected_field: z.string().nullable(),
      required_fields: z.array(z.string()).nullable(),
      citations_field: z.string().nullable(),
      require_at_least_one: z.boolean().nullable(),
      max: z.number().nullable(),
      severity: z.enum(["critical", "major", "minor"]),
      blocking: z.boolean(),
      fix_hint: z.string().nullable(),
    })
    .nullable(),
  ai_reviewer: z.object({ question: z.string(), fail_definition: z.string(), pass_definition: z.string() }).nullable(),
  bad_example: z.string().nullable(),
});
type DraftOutput = z.infer<typeof DraftOutput>;
const DRAFT_FORMAT = betaZodOutputFormat(DraftOutput);

export const RULE_DRAFT_SYSTEM = `You turn a product manager's plain-English requirement for an AI agent's answers into ONE automatic yes/no rule, or say that it needs judgement and should be an AI reviewer question instead. A person reviews your draft, tries it on real answers and decides; nothing is saved without them.

Rule types (use only these):
- non_empty {field}: the field contains some text.
- regex {field, pattern, flags, must}: a JavaScript regular expression. must "no_match" = the text must NOT contain it (banned promises, leaked data); "match" = it must (a required disclaimer). Prefer simple alternatives of literal phrases with word boundaries, e.g. \\b(guarantee|no questions asked)\\b, with flags "i". Never use nested quantifiers.
- max_length {field, max_words and/or max_chars}.
- matches_expected {field, expected_field, mode: exact | case_insensitive | contains}: compares with each test case's reference value. Only if the reference fields below have it.
- json_output {required_fields}: the answer is JSON with these fields present and not null.
- cites_evidence {citations_field, require_at_least_one}: every cited id is in the evidence the agent was given.
- no_tool_errors {}: no tool call reports an error.
- max_latency_ms {max} and max_cost_usd {max}: per answer.

A field is a dot path into the agent's answer and must be one of the answer fields listed (or "" for the whole answer); never invent one. Set every property a type doesn't use to null.

Choose kind "rule" only when a deterministic check fully captures the requirement. If it needs judgement (tone, helpfulness, whether a fact is right, whether a hand-off was appropriate), choose "ai_reviewer": ONE yes/no question about a failure, what counts as the failure being present, and what counts as it being absent. If the requirement is unclear or asks for several things, choose "unclear" and say in explanation what to clarify (one requirement per rule).

question: the yes/no question the rule answers, in plain words, phrased so that "yes" is good ("Does the answer avoid promising refunds?").
id: lowercase words joined by underscores, at most 40 characters, not one of the existing rule ids.
explanation: at most two short sentences for a non-engineer: what the rule checks, and one thing it can't catch.
bad_example: a short answer this rule must catch (for a rule on a field, just that field's text; for a time or cost limit, just the number), or null.
severity: critical = harms users or breaks policy; major = wrong or unusable; minor = style. blocking: true only if one failure should stop a release on its own.
fix_hint: one sentence on what to change in the agent when the rule fails, or null.`;

export function ruleDraftPrompt(agent: LoadedAgent, request: string, answers: ReturnType<typeof answerShape>): string {
  const expected = fieldsOf(agent.cases.filter((c) => c.split === "dev").map((c) => c.expected));
  const hasTextExpected = agent.cases.some((c) => c.split === "dev" && typeof c.expected === "string");
  return `<agent>
Name: ${agent.config.name}
Description: ${agent.config.description || "(none)"}
</agent>

<answer_fields>
${answers.kind === "text" ? "The agent answers in plain text (use field \"\")." : answers.kind === "unknown" ? "Unknown: no answers yet. Use field \"\" unless the requirement names a field." : describeFields(answers.fields)}
</answer_fields>

<reference_fields>
${hasTextExpected ? "Each test case's reference is plain text (expected_field \"\")." : describeFields(expected)}
</reference_fields>

<existing_rule_ids>
${agent.config.checks.map((c) => c.id).join(", ") || "(none)"}
</existing_rule_ids>

<requirement>
${request}
</requirement>`;
}

/** The draft as a CheckConfig: only the properties its type uses, with a free id. Null if it isn't a valid rule. */
export function ruleFromDraft(d: NonNullable<DraftOutput["rule"]>, takenIds: string[]): { rule: CheckConfig | null; problem: string | null } {
  const pick = <K extends keyof typeof d>(...keys: K[]) => Object.fromEntries(keys.filter((k) => d[k] !== null).map((k) => [k, d[k]]));
  const perType: Record<typeof d.type, Record<string, unknown>> = {
    non_empty: pick("field"),
    regex: pick("field", "pattern", "flags", "must"),
    max_length: pick("field", "max_words", "max_chars"),
    matches_expected: pick("field", "expected_field", "mode"),
    json_output: pick("required_fields"),
    cites_evidence: pick("citations_field", "require_at_least_one"),
    no_tool_errors: {},
    max_latency_ms: pick("max"),
    max_cost_usd: pick("max"),
  };
  const id = /^[a-z0-9_]{1,64}$/.test(d.id) && !takenIds.includes(d.id) ? d.id : ruleIdFrom(d.question, takenIds);
  const parsed = CheckConfig.safeParse({
    id,
    type: d.type,
    question: d.question,
    severity: d.severity,
    blocking: d.blocking,
    ...(d.fix_hint ? { fix_hint: d.fix_hint } : {}),
    ...perType[d.type],
  });
  if (!parsed.success) return { rule: null, problem: parsed.error.issues.map((i) => `${i.path.join(".") || "rule"}: ${i.message}`).join("; ") };
  return { rule: parsed.data, problem: null };
}

export type RuleDraft =
  | { kind: "rule"; rule: CheckConfig; explanation: string; bad_example: string | null }
  | { kind: "ai_reviewer"; judge: { question: string; fail_definition: string; pass_definition: string }; explanation: string }
  | { kind: "unclear"; explanation: string };

export async function draftRule(agent: LoadedAgent, request: string, recentTraces: AgentTrace[], fresh = false): Promise<RuleDraft & { cost_usd: number | null }> {
  requireLive();
  const res = await callStructured({
    // The shared spend ledger gets no agent ids; the cached response is under data/agents/<id>/ (git-ignored).
    purpose: "agent-draft-rule",
    cacheDir: cacheDir(agent.agent_id),
    system: RULE_DRAFT_SYSTEM,
    user: ruleDraftPrompt(agent, request, answerShape(recentTraces)),
    format: DRAFT_FORMAT,
    effort: "medium",
    bypassCache: fresh,
  });
  if (res.error || !res.raw_text) throw new EditError(`Claude couldn't draft this: ${res.error ?? "empty response"}. Try again, or write it yourself below.`, 502);
  let out: DraftOutput;
  try {
    out = DraftOutput.parse(JSON.parse(res.raw_text));
  } catch {
    throw new EditError("Claude's draft came back in an unexpected format. Try again, or write it yourself below.", 502);
  }
  const cost = res.estimated_cost_usd;
  if (out.kind === "rule" && out.rule) {
    const { rule, problem } = ruleFromDraft(out.rule, agent.config.checks.map((c) => c.id));
    const problems = problem ? [problem] : ruleProblems(agent, rule!);
    if (problems.length) {
      return { kind: "unclear", explanation: `Claude's draft wasn't a usable rule (${problems.join("; ")}). Rephrase the requirement, or write it yourself below.`, cost_usd: cost };
    }
    return { kind: "rule", rule: rule!, explanation: out.explanation, bad_example: out.bad_example?.trim() || null, cost_usd: cost };
  }
  if (out.kind === "ai_reviewer" && out.ai_reviewer) {
    const judge = AgentJudgeConfig.safeParse({ ...out.ai_reviewer, model: agent.config.judge?.model ?? "claude-sonnet-5-5" });
    if (judge.success) {
      const { question, fail_definition, pass_definition } = judge.data;
      return { kind: "ai_reviewer", judge: { question, fail_definition, pass_definition }, explanation: out.explanation, cost_usd: cost };
    }
  }
  return { kind: "unclear", explanation: out.explanation || "Claude couldn't turn this into one rule. Say exactly what a bad answer does.", cost_usd: cost };
}

// ---------------------------------------------------------------------------
// New test questions
// ---------------------------------------------------------------------------

const CasesOutput = z.object({ cases: z.array(z.object({ input: z.string(), notes: z.string() })) });
const CASES_FORMAT = betaZodOutputFormat(CasesOutput);

export const CASES_DRAFT_SYSTEM = `You write new test questions for evaluating an AI agent. A person reads each one and decides whether to add it; questions you write are marked as AI-drafted.

Write realistic inputs, as the agent's real users would write them: varied wording, length and difficulty, including hard and edge cases (ambiguous requests, missing details, out-of-scope asks, mistakes in the question). Each must differ from the examples and from each other. Follow the person's request about what to cover. Never include real personal data: invent names, emails and numbers.

For each, notes says in a few words what the question tests (shown to reviewers).`;

export function casesDraftPrompt(agent: LoadedAgent, examples: unknown[], shape: ReturnType<typeof inputShape>, request: string, count: number): string {
  const format =
    shape.kind === "json"
      ? "Each input is a JSON object written as a string, with the same keys as the examples."
      : "Each input is the question text only.";
  return `<agent>
Name: ${agent.config.name}
Description: ${agent.config.description || "(none)"}
</agent>

<examples>
${examples.length ? examples.map((e) => `- ${shape.kind === "field" ? (e as Record<string, string>)[shape.key] : asText(e)}`).join("\n") : "(none yet)"}
</examples>

<request>
${request || "Cover what the examples don't yet: other topics, harder phrasings, edge cases."}
</request>

Write exactly ${count} new test inputs. ${format}`;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export async function draftCases(agent: LoadedAgent, lock: LockState, request: string, count: number, fresh = false) {
  requireLive();
  // Practice questions only: a final-exam question must never be shown to anyone (or anything) before its reveal.
  const dev = agent.cases.filter((c) => c.split === "dev" && !lock.locked.has(c.case_id));
  const shape = inputShape(dev.map((c) => c.input));
  const examples = dev.slice(0, 20).map((c) => c.input);
  const res = await callStructured({
    purpose: "agent-draft-cases",
    cacheDir: cacheDir(agent.agent_id),
    system: CASES_DRAFT_SYSTEM,
    user: casesDraftPrompt(agent, examples, shape, request, count),
    format: CASES_FORMAT,
    effort: "medium",
    bypassCache: fresh,
  });
  if (res.error || !res.raw_text) throw new EditError(`Claude couldn't draft questions: ${res.error ?? "empty response"}. Try again.`, 502);
  let out: z.infer<typeof CasesOutput>;
  try {
    out = CasesOutput.parse(JSON.parse(res.raw_text));
  } catch {
    throw new EditError("Claude's questions came back in an unexpected format. Try again.", 502);
  }
  const known = new Set(agent.cases.map((c) => norm(asText(c.input))));
  const drafts: Array<{ input: unknown; notes: string }> = [];
  for (const d of out.cases.slice(0, count)) {
    let input: unknown;
    try {
      input = inputFromText(shape, d.input.trim());
    } catch {
      continue; // not valid JSON for a JSON-input agent: drop it rather than add a broken case
    }
    const key = norm(asText(input));
    if (!d.input.trim() || known.has(key)) continue;
    known.add(key);
    drafts.push({ input, notes: d.notes.trim().slice(0, 300) });
  }
  return { drafts, shape, cost_usd: res.estimated_cost_usd };
}
