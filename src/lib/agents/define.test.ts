import { describe, expect, it } from "vitest";
import {
  expectedFromText,
  expectedShape,
  inputFromText,
  inputShape,
  nextCaseIds,
  patternToPhrases,
  phrasesToPattern,
  ruleIdFrom,
  textFromExpected,
  textFromInput,
} from "./define";

describe("case inputs", () => {
  it("recognises plain text, one text field, and anything else", () => {
    expect(inputShape([])).toEqual({ kind: "text" });
    expect(inputShape(["a", "b"])).toEqual({ kind: "text" });
    expect(inputShape([{ question: "a" }, { question: "b" }])).toEqual({ kind: "field", key: "question" });
    expect(inputShape([{ question: "a" }, { query: "b" }])).toEqual({ kind: "json" });
    expect(inputShape([{ question: "a", user: "x" }])).toEqual({ kind: "json" });
    expect(inputShape([{ question: 1 }])).toEqual({ kind: "json" });
  });

  it("turns typed text into an input of that shape and back", () => {
    const field = { kind: "field", key: "question" } as const;
    expect(inputFromText(field, "Can I pay monthly?")).toEqual({ question: "Can I pay monthly?" });
    expect(textFromInput(field, { question: "Can I pay monthly?" })).toBe("Can I pay monthly?");
    expect(inputFromText({ kind: "text" }, "hi")).toBe("hi");
    expect(inputFromText({ kind: "json" }, '{"q": 1}')).toEqual({ q: 1 });
    expect(() => inputFromText({ kind: "json" }, "not json")).toThrow(/write the input as JSON/);
    expect(textFromInput({ kind: "json" }, { q: 1 })).toBe('{\n  "q": 1\n}');
  });

  it("continues the existing numbering and never reuses an id", () => {
    expect(nextCaseIds(["q01", "q02", "q07"], 2)).toEqual(["q08", "q09"]);
    expect(nextCaseIds(["c01", "c02", "h01"], 1)).toEqual(["c03"]);
    expect(nextCaseIds([], 2)).toEqual(["c01", "c02"]);
    expect(nextCaseIds(["refund-a"], 1)).toEqual(["c01"]);
    expect(nextCaseIds(["q9", "q10"], 1)).toEqual(["q11"]);
  });
});

describe("reference answers", () => {
  it("keeps the shape the other cases use", () => {
    expect(expectedShape([undefined, null])).toBe("answer");
    expect(expectedShape([{ answer: "30 days" }])).toBe("answer");
    expect(expectedShape(["30 days"])).toBe("text");
    expect(expectedShape([{ escalate: true }])).toBe("json");
    expect(expectedFromText("answer", "30 days")).toEqual({ answer: "30 days" });
    expect(expectedFromText("answer", "  ")).toBeUndefined();
    expect(expectedFromText("json", '{"escalate": true}')).toEqual({ escalate: true });
    expect(() => expectedFromText("json", "yes")).toThrow(/as JSON/);
    expect(textFromExpected("answer", { answer: "30 days" })).toBe("30 days");
    expect(textFromExpected("json", null)).toBe("");
  });
});

describe("rule helpers", () => {
  it("names a rule after its question, without clashing", () => {
    expect(ruleIdFrom("Does the answer avoid promising refunds?", [])).toBe("answer_avoid_promising_refunds");
    expect(ruleIdFrom("Does the answer avoid promising refunds?", ["answer_avoid_promising_refunds"])).toBe("answer_avoid_promising_refunds_2");
    expect(ruleIdFrom("???", [])).toBe("rule");
    expect(ruleIdFrom("x".repeat(80), []).length).toBeLessThanOrEqual(64);
  });

  it("builds a whole-word pattern from phrases, escaping what regexes treat as special", () => {
    const p = phrasesToPattern("guarantee\nno questions asked\n\n");
    expect(p).toBe("\\b(guarantee|no\\s+questions\\s+asked)\\b");
    const re = new RegExp(p, "i");
    expect(re.test("We GUARANTEE it")).toBe(true);
    expect(re.test("no  questions\nasked")).toBe(true);
    expect(re.test("guaranteed")).toBe(false);
    // Phrases that start or end with a symbol are still found (no \b next to a non-word character).
    const money = new RegExp(phrasesToPattern("$100\n100%"));
    expect(money.test("it costs $100 a month")).toBe(true);
    expect(money.test("100% sure")).toBe(true);
    expect(new RegExp(phrasesToPattern("a.b")).test("axb")).toBe(false);
    expect(phrasesToPattern(" \n ")).toBe("");
  });

  it("reads phrases back from a pattern it built, and leaves hand-written patterns alone", () => {
    for (const phrases of ["guarantee\nno questions asked", "refund", "$100\n100%", "a.b (c)"]) {
      expect(patternToPhrases(phrasesToPattern(phrases))).toBe(phrases);
    }
    expect(patternToPhrases("\\b(guarantee|always refund)\\b")).toBe("guarantee\nalways refund");
    expect(patternToPhrases("^\\d{3}-\\d{4}$")).toBeNull();
    expect(patternToPhrases("sk-[A-Za-z0-9]+")).toBeNull();
  });
});
