import { describe, expect, it } from "vitest";
import { JudgeResult } from "../domain/schemas";
import { judgeUserPrompt, judgeVersion, mockJudge, runJudge, verdictFromOutput } from "./judge";
import { makeTrace } from "../testing/fixtures";
import { buildEvidencePack } from "../agent/evidence";
import { getScenario } from "../domain/scenarios";
import { selectEffectivePolicy } from "../domain/policies";

const withEvidence = (caseId: string, mutate?: Parameters<typeof makeTrace>[1]) => {
  const s = getScenario(caseId)!;
  return makeTrace(caseId, mutate, { evidence_pack: buildEvidencePack(s, [selectEffectivePolicy(s.decision_date)!]), execution_mode: "mock" });
};

describe("judge verdict mapping", () => {
  const out = { relevant_claims: [], evidence_ids: [], explanation: "", uncertainty_reason: null, failure_detected: false };
  it("maps failure_detected to FAIL / PASS", () => {
    expect(verdictFromOutput({ ...out, failure_detected: true }, null)).toBe("FAIL");
    expect(verdictFromOutput(out, null)).toBe("PASS");
  });
  it("treats an inconclusive judgment as REQUIRES_REVIEW, never PASS", () => {
    expect(verdictFromOutput({ ...out, uncertainty_reason: "Evidence is ambiguous" }, null)).toBe("REQUIRES_REVIEW");
    expect(verdictFromOutput({ ...out, failure_detected: true, uncertainty_reason: "unclear" }, null)).toBe("REQUIRES_REVIEW");
  });
  it("maps errors and missing output to ERROR", () => {
    expect(verdictFromOutput(null, null)).toBe("ERROR");
    expect(verdictFromOutput(out, "boom")).toBe("ERROR");
  });
});

describe("judge inputs", () => {
  it("gives the judge only the explanation, claims, structured summary and supplied evidence", () => {
    const t = withEvidence("C02");
    const prompt = judgeUserPrompt(t);
    expect(prompt).toContain("<agent_explanation>");
    expect(prompt).toContain("[FACT-request]");
    expect(prompt).toContain("PRC-2026.2§3");
    expect(prompt).not.toContain("PRC-2025.1"); // policy not supplied to this trace
  });
  it("judge version encodes mode and changes with the prompt/model basis", () => {
    expect(judgeVersion("mock")).toMatch(/^upj-prompt-v1\+mock\+[0-9a-f]{8}$/);
    expect(judgeVersion("live")).toMatch(/^upj-prompt-v1\+claude-opus-5-5\+[0-9a-f]{8}$/);
  });
});

describe("mock judge (labelled, UI development only)", () => {
  it("flags uncited market claims and passes fully cited explanations", () => {
    const clean = withEvidence("C02");
    expect(mockJudge(clean).failure_detected).toBe(false);
    const dirty = withEvidence("C02", (r) => ({
      ...r,
      claims: [...r.claims, { claim: "Competitor pricing averages 2.2%", evidence_ids: [] }],
    }));
    const out = mockJudge(dirty);
    expect(out.failure_detected).toBe(true);
    expect(out.explanation).toContain("[MOCK JUDGE]");
  });

  it("runJudge on a mock trace never calls the API and stores label_source llm_judge", async () => {
    const res = await runJudge(withEvidence("C02"));
    JudgeResult.parse(res);
    expect(res.execution_mode).toBe("mock");
    expect(res.label_source).toBe("llm_judge");
    expect(res.verdict).toBe("PASS");
  });

  it("returns ERROR for a trace without structured output", async () => {
    const res = await runJudge(makeTrace("C02", () => null, { execution_mode: "mock" }));
    expect(res.verdict).toBe("ERROR");
  });
});

describe("mode safety", () => {
  it("refuses to mock-judge a live trace (its verdict would look like evidence about the real judge)", async () => {
    process.env.MOCK_MODE = "true";
    const { LiveTraceNeedsLiveJudgeError } = await import("./judge");
    const live = makeTrace("C02", undefined, { execution_mode: "live" });
    await expect(runJudge(live)).rejects.toBeInstanceOf(LiveTraceNeedsLiveJudgeError);
  });
});
