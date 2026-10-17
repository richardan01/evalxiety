/**
 * Starter checks for the onboarding wizard, inferred from one reply of the agent. Pure and client-safe (the wizard
 * also uses it for the no-endpoint path).
 */
import { CheckConfig } from "./schemas";

export interface SampleReply {
  output: unknown;
  evidence: Array<{ id: string }>;
  latency_ms: number;
}

const ANSWER_KEYS = ["answer", "response", "reply", "text", "message", "content", "output", "result"];
const CITATION_KEYS = ["citations", "sources", "references", "cited_ids"];

const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * Starter checks inferred from one reply. Deliberately conservative: only checks that would pass on this reply and
 * catch an obvious regression (no answer, broken shape, invented citations, a big slowdown). Content rules
 * ("escalates when…") need the owner's judgement, so they're left for later.
 */
export function suggestChecks(result: SampleReply | null): CheckConfig[] {
  const out = result?.output;
  const checks: unknown[] = [];
  const obj = isPlainObject(out) ? out : null;
  const answerKey = obj ? ANSWER_KEYS.find((k) => typeof obj[k] === "string") : undefined;

  checks.push({
    id: "answers_at_all",
    type: "non_empty",
    field: answerKey ?? "",
    question: "Does the agent give an answer with some text in it?",
    severity: "major",
    blocking: true,
    fix_hint: "An empty answer usually means a failed call or a parsing bug: check the trace's error and your agent's logs.",
  });

  if (obj) {
    const fields = Object.keys(obj)
      .filter((k) => obj[k] !== null && /^[A-Za-z0-9_-]+$/.test(k))
      .slice(0, 8);
    if (fields.length) {
      checks.push({
        id: "valid_response",
        type: "json_output",
        required_fields: fields,
        question: `Does the response still have ${fields.map((f) => `\`${f}\``).join(", ")}?`,
        severity: "major",
        blocking: true,
        fix_hint: "Return structured output (tool use or a JSON schema) so the shape can't drift.",
      });
    }
    const citationKey = CITATION_KEYS.find((k) => Array.isArray(obj[k]));
    if (citationKey && result?.evidence.length) {
      checks.push({
        id: "cites_only_given_evidence",
        type: "cites_evidence",
        citations_field: citationKey,
        question: "Does every citation point to evidence the agent was actually given?",
        severity: "critical",
        fix_hint: "Only let the model cite ids from the retrieved evidence; reject or strip anything else.",
      });
    }
  }

  if (result && Number.isFinite(result.latency_ms)) {
    // 5x the test call, never below 5 s: catches a real slowdown without flagging normal variance.
    const max = Math.max(5000, Math.ceil((result.latency_ms * 5) / 1000) * 1000);
    checks.push({
      id: "fast_enough",
      type: "max_latency_ms",
      max,
      question: `Does the agent answer within ${max / 1000} s?`,
      severity: "minor",
      fix_hint: "Look for an extra model call, a slow tool, or a missing cache.",
    });
  }
  return checks.map((c) => CheckConfig.parse(c));
}

