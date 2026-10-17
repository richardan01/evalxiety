/**
 * EXPERIMENTAL LLM judge for any agent: one binary question from agent.json → judge.
 *
 * Same rules as the pricing demo's judge: the verdict is never a human label, an inconclusive answer is
 * REQUIRES_REVIEW (never PASS), the version hashes the prompt + model so editing the question starts a new
 * calibration, and a real trace is never judged by the mock heuristic (that would look like evidence).
 */
import crypto from "node:crypto";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { callStructured, modeInfo } from "../llm/client";
import { newId } from "../storage/store";
import { asText, parsedOutput } from "./checks";
import { AGENT_ID_RE, type AgentJudgeConfig, type AgentJudgeResult, type AgentTrace } from "./schemas";

const PROMPT_VERSION = "agent-judge-v1";
const EFFORT = "medium" as const;

export function buildAgentJudgeSystemPrompt(agentName: string, j: AgentJudgeConfig): string {
  return `You review the output of an AI agent ("${agentName}") for ONE criterion only:

${j.question}

The failure is PRESENT when: ${j.fail_definition}

The failure is ABSENT when: ${j.pass_definition}

Judge only this criterion. Ignore style, tone and anything else, even if it looks wrong. Use only what is inside <input>, <evidence> and <output> — not general knowledge or what seems plausible.

How to answer:
1. In relevant_claims, quote the parts of the output that decide the question (if none, the parts you checked most closely).
2. In explanation, give a short critique a new teammate could follow.
3. If you genuinely cannot decide, set uncertainty_reason to one sentence explaining why. Otherwise set it to null.
4. Set failure_detected to true only if the failure is present.`;
}

const Output = z.object({
  relevant_claims: z.array(z.string()),
  explanation: z.string(),
  uncertainty_reason: z.string().nullable(),
  failure_detected: z.boolean(),
});
type Output = z.infer<typeof Output>;
const FORMAT = betaZodOutputFormat(Output);

export const JUDGE_SECTION_LIMIT = 20_000;

/** Neutralise our own delimiter tags inside trace content, so an output can't close <output> and add instructions. */
/** Neutralise anything that looks like one of our section tags, including variants like "</output >" or "< /OUTPUT\n>". */
const escapeTags = (s: string) => s.replace(/<\s*(\/?)\s*(input|evidence|output)\b[^>]*>/gi, "‹$1$2›");

/** The prompt sections, and whether any had to be cut (a judge that only saw part of the output can't PASS it). */
export function buildAgentJudgeUserPrompt(trace: AgentTrace): { prompt: string; truncated: boolean } {
  let truncated = false;
  const cap = (s: string) => {
    if (s.length <= JUDGE_SECTION_LIMIT) return escapeTags(s);
    truncated = true;
    return `${escapeTags(s.slice(0, JUDGE_SECTION_LIMIT))}\n…[truncated ${s.length - JUDGE_SECTION_LIMIT} chars]`;
  };
  const evidence = trace.evidence.length ? trace.evidence.map((e) => `[${e.id}] ${e.text}`).join("\n") : "(no evidence supplied)";
  const out = parsedOutput(trace.output);
  const prompt = `<input>
${cap(asText(trace.input))}
</input>

<evidence>
${cap(evidence)}
</evidence>

<output>
${cap(typeof out === "string" ? out : JSON.stringify(out, null, 2))}
</output>`;
  return { prompt, truncated };
}

export function agentJudgeVersion(agentName: string, j: AgentJudgeConfig, mode: "live" | "mock"): string {
  const basis = mode === "live" ? `${buildAgentJudgeSystemPrompt(agentName, j)}|${j.model}|${EFFORT}` : `${buildAgentJudgeSystemPrompt(agentName, j)}|mock-numbers-v1`;
  const h = crypto.createHash("sha256").update(basis).digest("hex").slice(0, 8);
  return `${PROMPT_VERSION}+${mode === "live" ? j.model : "mock"}+${h}`;
}

export function verdictOf(o: Output | null, error: string | null): AgentJudgeResult["verdict"] {
  if (error || !o) return "ERROR";
  if (o.uncertainty_reason?.trim()) return "REQUIRES_REVIEW";
  return o.failure_detected ? "FAIL" : "PASS";
}

/**
 * MOCK heuristic, for starter-kit (example) traces only: flags numbers in the output that appear nowhere in the
 * input or evidence. Labelled [MOCK JUDGE]; it says nothing about how a real judge would do.
 */
export function mockAgentJudge(trace: AgentTrace): Output {
  if (trace.output === null || trace.output === undefined) {
    return { relevant_claims: [], explanation: "[MOCK JUDGE] No output.", uncertainty_reason: "No output to judge.", failure_detected: false };
  }
  const source = `${asText(trace.input)} ${trace.evidence.map((e) => e.text).join(" ")}`;
  const nums = asText(parsedOutput(trace.output)).match(/\$?\d+(?:[.,]\d+)?%?/g) ?? [];
  const unsupported = [...new Set(nums)].filter((n) => !source.includes(n.replace(/^\$/, "").replace(/%$/, "")));
  return {
    relevant_claims: unsupported,
    explanation: unsupported.length
      ? `[MOCK JUDGE] ${unsupported.length} number(s) in the output appear nowhere in the input or evidence: ${unsupported.join(", ")}.`
      : "[MOCK JUDGE] Every number in the output appears in the input or evidence.",
    uncertainty_reason: null,
    failure_detected: unsupported.length > 0,
  };
}

export class RealTraceNeedsLiveJudgeError extends Error {}

/** The agent id becomes part of a path under data/: refuse anything that isn't a valid folder name. */
function safeAgentId(id: string): string {
  if (!AGENT_ID_RE.test(id)) throw new Error(`Invalid agent id "${id}"`);
  return id;
}

export async function judgeAgentTrace(agentName: string, j: AgentJudgeConfig, trace: AgentTrace): Promise<AgentJudgeResult> {
  const live = modeInfo().mode === "live";
  if (!live && trace.data_origin === "real") {
    throw new RealTraceNeedsLiveJudgeError(
      "This trace came from your real agent, so it must be judged by the real judge: set MOCK_MODE=false and ANTHROPIC_API_KEY in .env.local.",
    );
  }
  // Example traces are judged by the mock heuristic unless live mode is on.
  const mode: "live" | "mock" = live ? "live" : "mock";
  const base = {
    judge_result_id: newId("ajudge"),
    agent_id: trace.agent_id,
    judge_version: agentJudgeVersion(agentName, j, mode),
    trace_id: trace.trace_id,
    case_id: trace.case_id,
    execution_mode: mode,
    label_source: "llm_judge" as const,
    created_at: new Date().toISOString(),
  };
  if (trace.output === null || trace.output === undefined) {
    return { ...base, model_id: mode === "live" ? j.model : "mock-judge", verdict: "ERROR", explanation: null, quoted_claims: [], uncertainty_reason: null, error: "Trace has no output to judge", cost_usd: null, latency_ms: 0 };
  }
  if (mode === "mock") {
    const o = mockAgentJudge(trace);
    return { ...base, model_id: "mock-judge", verdict: verdictOf(o, null), explanation: o.explanation, quoted_claims: o.relevant_claims, uncertainty_reason: o.uncertainty_reason, error: null, cost_usd: null, latency_ms: 0 };
  }
  const { prompt, truncated } = buildAgentJudgeUserPrompt(trace);
  const res = await callStructured({
    // Private-data hygiene: the shared spend ledger (tracked in git) gets no agent or trace ids, and cached responses
    // (which quote the agent's output) are written under data/agents/<id>/, which is git-ignored.
    purpose: "agent-judge",
    cacheDir: `agents/${safeAgentId(trace.agent_id)}/llm_cache`,
    system: buildAgentJudgeSystemPrompt(agentName, j),
    user: prompt,
    model: j.model,
    format: FORMAT,
    effort: EFFORT,
  });
  let o: Output | null = null;
  let error = res.error;
  if (!error && res.raw_text) {
    try {
      const parsed = Output.safeParse(JSON.parse(res.raw_text));
      if (parsed.success) o = parsed.data;
      else error = `Judge output failed schema validation: ${parsed.error.message}`;
    } catch (e) {
      error = `Judge response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else if (!error) {
    error = "Empty judge response";
  }
  let verdict = verdictOf(o, error);
  // The judge saw a truncated trace: it may have missed the failure, so its PASS can't stand.
  if (truncated && verdict === "PASS") verdict = "REQUIRES_REVIEW";
  return {
    ...base,
    model_id: res.served_model_id ?? j.model,
    verdict,
    explanation: o?.explanation ?? null,
    quoted_claims: o?.relevant_claims ?? [],
    uncertainty_reason: truncated && verdict === "REQUIRES_REVIEW" && !o?.uncertainty_reason ? `Trace longer than ${JUDGE_SECTION_LIMIT} characters per section; the judge saw only part of it.` : o?.uncertainty_reason ?? null,
    error,
    cost_usd: res.estimated_cost_usd,
    latency_ms: res.latency_ms,
  };
}
