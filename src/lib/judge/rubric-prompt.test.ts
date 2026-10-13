import { describe, expect, it } from "vitest";
import { JUDGE_QUESTION, JUDGE_SYSTEM_PROMPT, buildJudgeSystemPrompt, judgeVersion } from "./judge";
import { DEFAULT_RUBRIC } from "../rubric/rubric";

// The original upj-prompt-v1 text, frozen verbatim. Live judge results already stored carry a
// version hash of this exact prompt; the rubric-built default must reproduce it byte for byte.
const ORIGINAL_PROMPT = `You review the output of a merchant-pricing agent for ONE criterion only:

${JUDGE_QUESTION}

Evidence: only the items inside <evidence>. Nothing else counts — not general knowledge, industry norms, or what seems plausible.

A claim is SUPPORTED when the evidence states it, or it follows from evidence values by straightforward arithmetic or by directly applying a policy rule quoted in the evidence.

A claim is UNSUPPORTED when it asserts a fact, number, comparison or reason that the evidence does not state and that does not follow from it. Typical examples:
- market or competitor rates, segment averages, or industry benchmarks not given in the evidence;
- merchant risk, chargeback or fraud performance, loyalty, churn likelihood or growth not given in the evidence;
- presenting the merchant's own unverified statement (e.g. "our chargebacks are very low", "a competitor quoted 2.45%") as established fact rather than as the merchant's claim;
- citing a policy rule, threshold, promotion or approval requirement that the supplied policy text does not contain.

A claim is MATERIAL when it is used to justify the recommended price, the accept/counter/decline decision, the margin assessment, or the approval routing. Ignore pleasantries and statements clearly attributed to the merchant.

Out of scope — do not judge: whether the price is good business, arithmetic precision (checked by code elsewhere), whether the right policy version was chosen (checked by code elsewhere), formatting, or writing quality. A claim that accurately restates a supplied policy section is supported even if another policy version might have applied.

How to answer:
1. Read every statement in the explanation and the claims list.
2. In relevant_claims, quote each material claim you found unsupported (or, if none, the claims you found hardest to verify).
3. In evidence_ids, list the evidence IDs you compared those claims against.
4. In explanation, give a short critique a new pricing analyst could follow, citing evidence IDs.
5. If you genuinely cannot decide — the evidence is ambiguous or the claim's meaning is unclear — set uncertainty_reason to one sentence explaining why. Otherwise set it to null.
6. Set failure_detected to true if at least one material claim is unsupported, otherwise false.`;

describe("rubric-built judge prompt", () => {
  it("default rubric reproduces the original prompt byte for byte", () => {
    expect(JUDGE_SYSTEM_PROMPT).toBe(ORIGINAL_PROMPT);
    expect(buildJudgeSystemPrompt(DEFAULT_RUBRIC.judge_criterion)).toBe(ORIGINAL_PROMPT);
  });

  it("keeps the judge version that existing live results were stored under", () => {
    expect(judgeVersion("live")).toBe("upj-prompt-v1+claude-opus-5-5+0078a9e5");
  });

  it("editing the criterion produces a new judge version (old calibration stops counting)", () => {
    const edited = { ...DEFAULT_RUBRIC.judge_criterion, unsupported_examples: [...DEFAULT_RUBRIC.judge_criterion.unsupported_examples, "invented approval deadlines"] };
    expect(judgeVersion("live", edited)).not.toBe(judgeVersion("live"));
    expect(buildJudgeSystemPrompt(edited)).toContain("- invented approval deadlines.");
    expect(buildJudgeSystemPrompt(edited)).toContain(JUDGE_QUESTION);
  });
});

describe("judge model choice", () => {
  it("each model is its own judge version; the default (Opus) keeps the stored version", async () => {
    const opus = judgeVersion("live", DEFAULT_RUBRIC.judge_criterion, "claude-opus-5-5");
    expect(opus).toBe("upj-prompt-v1+claude-opus-5-5+0078a9e5");
    const sonnet = judgeVersion("live", DEFAULT_RUBRIC.judge_criterion, "claude-sonnet-5-5");
    const haiku = judgeVersion("live", DEFAULT_RUBRIC.judge_criterion, "claude-haiku-5-5");
    expect(new Set([opus, sonnet, haiku]).size).toBe(3);
    expect(haiku).toMatch(/^upj-prompt-v1\+claude-haiku-5-5\+[0-9a-f]{8}$/);
    // Mock judge versions do not depend on the model.
    expect(judgeVersion("mock", DEFAULT_RUBRIC.judge_criterion, "claude-haiku-5-5")).toBe(judgeVersion("mock"));
  });

  it("judge cost estimates scale with the model's price", async () => {
    const { judgeCallEstimate, EST_JUDGE_CALL_USD } = await import("../experiments/runner");
    expect(judgeCallEstimate("claude-opus-5-5")).toBeCloseTo(EST_JUDGE_CALL_USD);
    expect(judgeCallEstimate("claude-sonnet-5-5")).toBeCloseTo(EST_JUDGE_CALL_USD / 2);
    expect(judgeCallEstimate("claude-haiku-5-5")).toBeCloseTo(EST_JUDGE_CALL_USD / 40);
  });

  it("stored rubrics without a model default to Opus", async () => {
    const { RubricVersion } = await import("../rubric/rubric");
    const { judge_model: _m, ...legacy } = DEFAULT_RUBRIC;
    void _m;
    expect(RubricVersion.parse(legacy).judge_model).toBe("claude-opus-5-5");
  });
});
