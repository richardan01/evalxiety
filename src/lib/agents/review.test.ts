import { describe, expect, it } from "vitest";
import { agreement, answerStatus, cohensKappa, MIN_OVERLAP, nextForMe, progressOf, type Label, type QueueItem } from "./review";

const l = (trace: string, reviewer: string, task_outcome: Label["task_outcome"]): Label => ({ trace_id: trace, case_id: trace.toUpperCase(), reviewer, task_outcome });

describe("answer status", () => {
  it("separates open, not sure, decided and disputed answers", () => {
    expect(answerStatus([])).toBe("open");
    expect(answerStatus([{ task_outcome: "unsure" }])).toBe("unsure");
    expect(answerStatus([{ task_outcome: "unsure" }, { task_outcome: "fail" }])).toBe("decided");
    expect(answerStatus([{ task_outcome: "pass" }, { task_outcome: "pass" }])).toBe("decided");
    expect(answerStatus([{ task_outcome: "pass" }, { task_outcome: "fail" }])).toBe("disputed");
  });
});

describe("agreement between reviewers", () => {
  it("is not measured until two people decide the same answer", () => {
    const a = agreement([l("t1", "Priya", "pass"), l("t2", "Alex", "fail"), l("t1", "Alex", "unsure")]);
    expect(a).toMatchObject({ shared: 0, pairs: 0, rate: null, interval: null, kappa: null, disputes: [], enough: false });
  });

  it("counts reviewer pairs on shared answers, lists disagreements, and gives kappa for two people", () => {
    // 10 shared answers: they agree on 8 (6 pass, 2 fail) and disagree on 2.
    const labels: Label[] = [];
    for (let i = 0; i < 10; i++) {
      const t = `t${i}`;
      const priya = i < 6 ? "pass" : i < 8 ? "fail" : "pass";
      const alex = i < 6 ? "pass" : "fail";
      labels.push(l(t, "Priya", priya), l(t, "Alex", alex));
    }
    labels.push(l("solo", "Priya", "fail"));
    const a = agreement(labels);
    expect(a).toMatchObject({ shared: 10, pairs: 10, agreeing: 8, rate: 0.8, reviewers: ["Alex", "Priya"], enough: true });
    expect(a.interval!.low).toBeGreaterThan(0.4);
    expect(a.interval!.high).toBeLessThan(1);
    // Chance agreement: Priya passes 8/10, Alex 6/10 → 0.8·0.6 + 0.2·0.4 = 0.56; κ = (0.8 − 0.56) / 0.44.
    expect(a.kappa).toBeCloseTo(0.24 / 0.44, 5);
    expect(a.disputes.map((d) => d.case_id)).toEqual(["T8", "T9"]);
    expect(a.disputes[0].labels).toEqual([
      { reviewer: "Priya", task_outcome: "pass" },
      { reviewer: "Alex", task_outcome: "fail" },
    ]);
    expect(MIN_OVERLAP).toBe(10);
  });

  it("with three people, reports pairwise agreement but no kappa", () => {
    const a = agreement([l("t1", "A", "pass"), l("t1", "B", "pass"), l("t1", "C", "fail")]);
    expect(a).toMatchObject({ shared: 1, pairs: 3, agreeing: 1, kappa: null });
  });

  it("kappa is undefined when chance agreement is total", () => {
    expect(cohensKappa([[l("t1", "A", "pass"), l("t1", "B", "pass")]])).toBeNull();
  });
});

describe("progress and what comes next", () => {
  const items: QueueItem[] = [
    { case_id: "c1", trace_id: "t1", status: "decided", reviewed: true, mine: true },
    { case_id: "c2", trace_id: "t2", status: "unsure", reviewed: false, mine: true },
    { case_id: "c3", trace_id: "t3", status: "disputed", reviewed: true, mine: false },
    { case_id: "c4", trace_id: "t4", status: "open", reviewed: false, mine: false },
  ];

  it("counts what the gate counts", () => {
    expect(progressOf(items)).toEqual({ total: 4, reviewed: 2, unsure: 1, disputed: 1, open: 2, mine: 2 });
  });

  it("goes to the next answer this reviewer hasn't marked, wrapping around", () => {
    expect(nextForMe(items, "t1")?.trace_id).toBe("t3");
    expect(nextForMe(items, "t3")?.trace_id).toBe("t4");
    expect(nextForMe(items, "t4")?.trace_id).toBe("t3");
    expect(nextForMe(items.map((i) => ({ ...i, mine: true })), "t2")).toBeNull();
  });
});
