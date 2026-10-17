/**
 * Custom code checks, written in TypeScript, for checks agent.json's built-in types can't express.
 *
 * Register a function under your agent's folder name, then reference it from agent.json:
 *   { "id": "my_check", "type": "custom", "function": "myCheck", "question": "..." }
 *
 * A check returns PASS, FAIL or NOT_APPLICABLE (nothing to check on this trace) with a one-line summary.
 * Before you trust a new check, make it FAIL on purpose once (e.g. edit a trace) to prove it can.
 */
import type { CustomCheckFn, CustomCheckRegistry } from "../src/lib/agents/checks";

const answerOf = (output: unknown) =>
  output && typeof output === "object" && typeof (output as { answer?: unknown }).answer === "string" ? (output as { answer: string }).answer : "";

/** Example support bot: refund questions must get the right window for the customer's plan (help article KB-1). */
const refundWindowCorrect: CustomCheckFn = ({ trace, output }) => {
  const question = String((trace.input as { question?: unknown })?.question ?? "");
  if (!/refund|money back/i.test(question)) return { outcome: "NOT_APPLICABLE", summary: "Not a refund question." };
  const answer = answerOf(output);
  const monthly = /monthly/i.test(question);
  if (monthly) {
    return /not refundable|no refunds?|can't be refunded|cannot be refunded/i.test(answer)
      ? { outcome: "PASS", summary: "Says monthly plans are not refundable." }
      : { outcome: "FAIL", summary: "Monthly-plan refund question, but the answer doesn't say monthly plans are not refundable." };
  }
  return /30 days/i.test(answer)
    ? { outcome: "PASS", summary: "States the 30-day refund window." }
    : { outcome: "FAIL", summary: "Refund question, but the answer doesn't state the 30-day window." };
};

export const CUSTOM_CHECKS: CustomCheckRegistry = {
  "example-support-bot": { refundWindowCorrect },
};
