import { describe, expect, it } from "vitest";
import { casesFromTable, detectDelimiter, guessColumn, looksLikeTable, parseTable, QUESTION_WORDS, tracesFromTable } from "./csv";

describe("parseTable", () => {
  it("reads CSV with quoted commas, escaped quotes, line breaks inside a cell, CRLF and a BOM", () => {
    const t = parseTable('﻿question,answer\r\n"Hi, can I get a refund?","Yes, within ""30 days"""\r\n"Two\nlines",ok\r\n');
    expect(t.delimiter).toBe(",");
    expect(t.header).toEqual(["question", "answer"]);
    expect(t.rows).toEqual([
      ["Hi, can I get a refund?", 'Yes, within "30 days"'],
      ["Two\nlines", "ok"],
    ]);
  });

  it("reads cells copied from a spreadsheet (tab-separated), even when they contain commas", () => {
    const t = parseTable("Question\tExpected answer\nCan I pay monthly, or yearly?\tBoth\n");
    expect(t.delimiter).toBe("\t");
    expect(t.rows).toEqual([["Can I pay monthly, or yearly?", "Both"]]);
  });

  it("pads short rows, names blank headers and skips empty rows", () => {
    const t = parseTable("question,,notes\nq1\n,,\nq2,x,n\n");
    expect(t.header).toEqual(["question", "Column 2", "notes"]);
    expect(t.rows).toEqual([
      ["q1", "", ""],
      ["q2", "x", "n"],
    ]);
  });

  it("explains what's wrong instead of guessing", () => {
    expect(() => parseTable("question\n")).toThrow(/header row and at least one row/);
    expect(() => parseTable('question\n"never closed\n')).toThrow(/never closed/);
  });

  it("detects semicolons (Excel in many locales)", () => {
    expect(detectDelimiter("question;answer\na;b")).toBe(";");
  });
});

describe("casesFromTable", () => {
  const t = parseTable(["Question,Notes,Expected", ...Array.from({ length: 10 }, (_, i) => `Q${i + 1},note ${i + 1},${i === 0 ? "A1" : ""}`), ",,"].join("\n"));
  it("turns a column of questions into cases, holding out every 5th", () => {
    const res = casesFromTable(t, { question: 0, notes: 1, expected: 2, input_key: "question", holdout: true });
    const lines = res.jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(res.count).toBe(10);
    expect(res.heldout).toBe(2);
    expect(lines[0]).toEqual({ case_id: "q01", input: { question: "Q1" }, expected: { answer: "A1" }, notes: "note 1" });
    expect(lines[4]).toMatchObject({ case_id: "q05", split: "heldout" });
    expect(lines[9]).toMatchObject({ case_id: "q10", split: "heldout" });
    expect(lines[1]).not.toHaveProperty("expected");
  });
  it("sends the bare question when the agent takes plain text", () => {
    const res = casesFromTable(t, { question: 0, input_key: null, holdout: false });
    expect(JSON.parse(res.jsonl.split("\n")[0])).toEqual({ case_id: "q01", input: "Q1" });
    expect(res.heldout).toBe(0);
  });
});

describe("tracesFromTable", () => {
  const cases = [
    { case_id: "c01", input: { question: "How do I reset my password?" } },
    { case_id: "c02", input: { question: "Can I get a refund?" } },
    { case_id: "h01", input: { question: "My lawyer will call." } },
    { case_id: "dup1", input: "Same question" },
    { case_id: "dup2", input: "same   question" },
  ];
  it("matches rows by question text (ignoring case and spacing) and leaves locked final-exam cases out", () => {
    const t = parseTable("Question\tAnswer\n  how do I reset my PASSWORD? \tGo to Settings.\nCan I get a refund?\t\nMy lawyer will call.\tI'll hand you over.\n");
    const res = tracesFromTable(t, cases, new Set(["h01"]), { answer: 1, question: 0 });
    expect(res.problems).toEqual([]);
    expect(res.jsonl.split("\n").map((l) => JSON.parse(l))).toEqual([
      { case_id: "c01", output: "Go to Settings." },
      // An empty answer is imported as empty: the import marks it as an errored case.
      { case_id: "c02", output: "" },
    ]);
    expect(res.skipped_locked).toEqual(["h01"]);
  });
  it("reports unknown and ambiguous questions with their line numbers", () => {
    const t = parseTable("question,answer\nWhat is this?,x\nSame question,y\n");
    const res = tracesFromTable(t, cases, new Set(), { answer: 1, question: 0 });
    expect(res.problems.map((p) => p.line)).toEqual([2, 3]);
    expect(res.problems[0].message).toMatch(/No test case has the question “What is this\?”/);
    expect(res.problems[1].message).toMatch(/More than one test case has this question \(dup1, dup2\)/);
  });
  it("can store each answer in the field the agent's rules read", () => {
    const t = parseTable("case_id,answer\nc01,Go to Settings.\n");
    const res = tracesFromTable(t, cases, new Set(), { answer: 1, case_id: 0, answer_field: "answer" });
    expect(JSON.parse(res.jsonl)).toEqual({ case_id: "c01", output: { answer: "Go to Settings." } });
  });

  it("matches by case id when given one", () => {
    const t = parseTable("case_id,answer\nc02,Within 30 days.\nnope,x\n");
    const res = tracesFromTable(t, cases, new Set(), { answer: 1, case_id: 0 });
    expect(res.jsonl).toBe('{"case_id":"c02","output":"Within 30 days."}');
    expect(res.problems).toEqual([{ line: 3, message: "No test case has the id “nope”." }]);
  });
  it("asks for a way to match", () => {
    const t = parseTable("a,b\nx,y\n");
    expect(tracesFromTable(t, cases, new Set(), { answer: 1 }).problems[0].message).toMatch(/Pick how to match/);
  });
});

describe("helpers", () => {
  it("guesses columns and tells sheets from JSONL", () => {
    expect(guessColumn(["Case", "User question", "Bot reply"], QUESTION_WORDS)).toBe(1);
    expect(looksLikeTable('{"case_id":"c1","output":"x"}\n')).toBe(false);
    expect(looksLikeTable("question,answer\nq,a")).toBe(true);
  });
});
