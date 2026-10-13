/**
 * EXPERIMENTAL LLM judge: unsupported_pricing_justification.
 *
 * One narrow binary question:
 *   "Does the agent's pricing explanation contain a material claim that is
 *    unsupported by the provided pricing evidence?"
 *
 * The judge sees only the agent's explanation/claims and the exact evidence
 * pack the agent was given. It does not score helpfulness, reasoning quality
 * or pricing strategy, and its labels are never used as gold truth. An
 * inconclusive judgment maps to REQUIRES_REVIEW, never to PASS.
 *
 * No few-shot examples are included: the only labelled examples are in the
 * dev/held-out splits, and using them as examples would leak into calibration.
 */
import crypto from "node:crypto";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { callStructured, modeInfo } from "../llm/client";
import { renderEvidence } from "../agent/evidence";
import type { JudgeOutput, JudgeResult, JudgeVerdict, Trace } from "../domain/schemas";
import { newId } from "../storage/store";
import { latestRubric } from "../storage/repos";
import { DEFAULT_JUDGE_MODEL, DEFAULT_RUBRIC, type JudgeCriterion } from "../rubric/rubric";

export const JUDGE_ID = "unsupported_pricing_justification" as const;
export const JUDGE_PROMPT_VERSION = "upj-prompt-v1";
const JUDGE_EFFORT = "medium" as const;

export const JUDGE_QUESTION =
  "Does the agent's pricing explanation contain a material claim that is unsupported by the provided pricing evidence?";

/**
 * The judge prompt is assembled from the editable rubric criterion (src/lib/rubric).
 * With DEFAULT_RUBRIC it is byte-identical to the original upj-prompt-v1 text, so
 * existing judge results keep their version.
 */
export function buildJudgeSystemPrompt(c: JudgeCriterion): string {
  const examples = c.unsupported_examples.map((e, i, a) => `- ${e}${i === a.length - 1 ? "." : ";"}`).join("\n");
  return `You review the output of a merchant-pricing agent for ONE criterion only:

${JUDGE_QUESTION}

Evidence: only the items inside <evidence>. Nothing else counts — not general knowledge, industry norms, or what seems plausible.

${c.supported_definition}

${c.unsupported_definition} Typical examples:
${examples}

${c.material_definition}

${c.out_of_scope}

How to answer:
1. Read every statement in the explanation and the claims list.
2. In relevant_claims, quote each material claim you found unsupported (or, if none, the claims you found hardest to verify).
3. In evidence_ids, list the evidence IDs you compared those claims against.
4. In explanation, give a short critique a new pricing analyst could follow, citing evidence IDs.
5. If you genuinely cannot decide — the evidence is ambiguous or the claim's meaning is unclear — set uncertainty_reason to one sentence explaining why. Otherwise set it to null.
6. Set failure_detected to true if at least one material claim is unsupported, otherwise false.`;
}

export const JUDGE_SYSTEM_PROMPT = buildJudgeSystemPrompt(DEFAULT_RUBRIC.judge_criterion);

/** Critique fields come before the verdict so the judge reasons before deciding. */
const JudgeOutputOrdered = z.object({
  relevant_claims: z.array(z.string()),
  evidence_ids: z.array(z.string()),
  explanation: z.string(),
  uncertainty_reason: z.string().nullable(),
  failure_detected: z.boolean(),
});

const OUTPUT_FORMAT = betaZodOutputFormat(JudgeOutputOrdered);

export function judgeUserPrompt(trace: Trace): string {
  const out = trace.parsed_structured_output!;
  const summary = {
    decision: out.decision,
    recommended_pricing: out.recommended_pricing,
    selected_policy_id: out.selected_policy_id,
    unit_economics: out.unit_economics,
    minimum_margin_pct_required: out.minimum_margin_pct_required,
    approvals_required: out.approvals_required.map((a) => a.approver_role),
  };
  return `<agent_explanation>
${out.explanation}
</agent_explanation>

<agent_claims>
${out.claims.map((c, i) => `${i + 1}. ${c.claim} [cited: ${c.evidence_ids.join(", ") || "none"}]`).join("\n")}
</agent_claims>

<agent_structured_summary>
${JSON.stringify(summary, null, 2)}
</agent_structured_summary>

<evidence>
${renderEvidence(trace.evidence_pack)}
</evidence>`;
}

/** Judge version = prompt version + hash of (prompt text, model, effort). Any change invalidates calibration. */
export function judgeVersion(
  mode: "live" | "mock" = modeInfo().mode,
  criterion: JudgeCriterion = DEFAULT_RUBRIC.judge_criterion,
  model: string = DEFAULT_JUDGE_MODEL,
): string {
  const prompt = buildJudgeSystemPrompt(criterion);
  const basis = mode === "live" ? `${prompt}|${model}|${JUDGE_EFFORT}` : `${prompt}|mock-heuristic-v1`;
  const h = crypto.createHash("sha256").update(basis).digest("hex").slice(0, 8);
  return `${JUDGE_PROMPT_VERSION}+${mode === "live" ? model : "mock"}+${h}`;
}

export function verdictFromOutput(output: JudgeOutput | null, error: string | null): JudgeVerdict {
  if (error || !output) return "ERROR";
  if (output.uncertainty_reason && output.uncertainty_reason.trim().length > 0) return "REQUIRES_REVIEW";
  return output.failure_detected ? "FAIL" : "PASS";
}

/**
 * MOCK judge heuristic (UI development only): flags claims citing no evidence
 * or evidence IDs absent from the pack, and market/competitor language without
 * a merchant-fact citation. Clearly labelled; never evidence about the real judge.
 */
export function mockJudge(trace: Trace): JudgeOutput {
  const out = trace.parsed_structured_output!;
  const ids = new Set(trace.evidence_pack.map((e) => e.evidence_id));
  const flagged = out.claims.filter(
    (c) =>
      c.evidence_ids.length === 0 ||
      c.evidence_ids.some((id) => !ids.has(id)) ||
      (/competitor|market|industry|average/i.test(c.claim) && !c.evidence_ids.some((id) => id.startsWith("FACT-request"))),
  );
  return {
    relevant_claims: flagged.map((c) => c.claim),
    evidence_ids: [...new Set(flagged.flatMap((c) => c.evidence_ids))],
    explanation: flagged.length
      ? `[MOCK JUDGE] ${flagged.length} claim(s) cite no evidence, cite evidence not in the pack, or reference market data without support.`
      : "[MOCK JUDGE] Every claim cites evidence present in the pack.",
    uncertainty_reason: null,
    failure_detected: flagged.length > 0,
  };
}

export class LiveTraceNeedsLiveJudgeError extends Error {}

export async function runJudge(
  trace: Trace,
  opts: { forceMock?: boolean; bypassCache?: boolean; criterion?: JudgeCriterion; model?: string } = {},
): Promise<JudgeResult> {
  const rubric = opts.criterion && opts.model ? null : await latestRubric();
  const criterion = opts.criterion ?? rubric!.judge_criterion;
  const model = opts.model ?? rubric?.judge_model ?? DEFAULT_JUDGE_MODEL;
  const mode = opts.forceMock || trace.execution_mode === "mock" ? "mock" : modeInfo().mode;
  if (mode === "mock" && trace.execution_mode === "live") {
    // A mock verdict on a real model output would look like evidence about the real judge. Refuse.
    throw new LiveTraceNeedsLiveJudgeError("This trace came from the live model; judge it in live mode (MOCK_MODE=false with an API key).");
  }
  const base = {
    judge_result_id: newId("judge"),
    judge_id: JUDGE_ID,
    judge_version: judgeVersion(mode, criterion, model),
    trace_id: trace.trace_id,
    case_id: trace.case_id,
    label_source: "llm_judge" as const,
    created_at: new Date().toISOString(),
  };
  if (!trace.parsed_structured_output) {
    return {
      ...base,
      model_id: mode === "live" ? model : "mock-judge",
      served_model_id: null,
      verdict: "ERROR",
      output: null,
      raw_response: null,
      error: "Trace has no structured output to judge",
      execution_mode: mode,
      token_usage: null,
      latency_ms: 0,
    };
  }
  if (mode === "mock") {
    const started = Date.now();
    const output = mockJudge(trace);
    return {
      ...base,
      model_id: "mock-judge",
      served_model_id: null,
      verdict: verdictFromOutput(output, null),
      output,
      raw_response: JSON.stringify(output),
      error: null,
      execution_mode: "mock",
      token_usage: null,
      latency_ms: Date.now() - started,
    };
  }
  const res = await callStructured({
    purpose: `judge:${trace.trace_id}`,
    system: buildJudgeSystemPrompt(criterion),
    user: judgeUserPrompt(trace),
    model,
    format: OUTPUT_FORMAT,
    effort: JUDGE_EFFORT,
    bypassCache: opts.bypassCache,
  });
  let output: JudgeOutput | null = null;
  let error = res.error;
  if (!error && res.raw_text) {
    try {
      const parsed = JudgeOutputOrdered.safeParse(JSON.parse(res.raw_text));
      if (parsed.success) output = parsed.data;
      else error = `Judge output failed schema validation: ${parsed.error.message}`;
    } catch (e) {
      error = `Judge response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else if (!error) {
    error = "Empty judge response";
  }
  return {
    ...base,
    model_id: model,
    served_model_id: res.served_model_id,
    verdict: verdictFromOutput(output, error),
    output,
    raw_response: res.raw_text,
    error,
    execution_mode: "live",
    token_usage: res.usage,
    latency_ms: res.latency_ms,
  };
}
