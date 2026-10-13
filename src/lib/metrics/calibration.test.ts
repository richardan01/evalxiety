import { describe, expect, it } from "vitest";
import {
  calibrationReport,
  confusionMatrix,
  roganGladen,
  safeRate,
  tnr,
  tpr,
  wilsonInterval,
  type CalibrationPair,
} from "./calibration";
import type { JudgeVerdict } from "../domain/schemas";

const pair = (human_failure: boolean, judge_verdict: JudgeVerdict, i = 0): CalibrationPair => ({
  trace_id: `t${i}`,
  case_id: `C${i}`,
  human_failure,
  judge_verdict,
});

describe("confusion matrix (positive class = actual failure)", () => {
  it("assigns TP / FN / FP / TN from human reference vs judge verdict", () => {
    const m = confusionMatrix([
      pair(true, "FAIL"), // TP
      pair(true, "FAIL"), // TP
      pair(true, "PASS"), // FN
      pair(false, "FAIL"), // FP
      pair(false, "PASS"), // TN
      pair(false, "PASS"), // TN
      pair(false, "PASS"), // TN
    ]);
    expect(m).toMatchObject({ tp: 2, fn: 1, fp: 1, tn: 3, n: 7, positives: 3, negatives: 4 });
  });

  it("excludes REQUIRES_REVIEW and ERROR rather than treating them as PASS", () => {
    const m = confusionMatrix([pair(true, "REQUIRES_REVIEW"), pair(false, "ERROR"), pair(true, "FAIL")]);
    expect(m).toMatchObject({ tp: 1, fn: 0, fp: 0, tn: 0, n: 1, excluded_requires_review: 1, excluded_error: 1 });
  });
});

describe("TPR and TNR", () => {
  it("computes TPR = TP/(TP+FN) and TNR = TN/(TN+FP)", () => {
    const m = confusionMatrix([pair(true, "FAIL"), pair(true, "FAIL"), pair(true, "PASS"), pair(false, "PASS"), pair(false, "FAIL")]);
    expect(tpr(m)).toBeCloseTo(2 / 3);
    expect(tnr(m)).toBeCloseTo(1 / 2);
  });

  it("returns undefined (null), never 0 or 1, when a denominator is zero", () => {
    const onlyNegatives = confusionMatrix([pair(false, "PASS"), pair(false, "PASS")]);
    expect(tpr(onlyNegatives)).toBeNull();
    expect(tnr(onlyNegatives)).toBe(1);
    const onlyPositives = confusionMatrix([pair(true, "FAIL")]);
    expect(tnr(onlyPositives)).toBeNull();
    const empty = confusionMatrix([]);
    expect(tpr(empty)).toBeNull();
    expect(tnr(empty)).toBeNull();
    expect(safeRate(0, 0)).toBeNull();
    expect(safeRate(0, 5)).toBe(0);
  });

  it("a judge that always says PASS has TPR 0 (not undefined) when positives exist", () => {
    const m = confusionMatrix([pair(true, "PASS"), pair(false, "PASS")]);
    expect(tpr(m)).toBe(0);
    expect(tnr(m)).toBe(1);
  });
});

describe("intervals and correction", () => {
  it("Wilson interval is null for n = 0 and brackets the point estimate", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const ci = wilsonInterval(9, 10)!;
    expect(ci.low).toBeLessThan(0.9);
    expect(ci.high).toBeGreaterThan(0.9);
    expect(ci.high).toBeLessThanOrEqual(1);
  });

  it("Wilson interval is wide on tiny samples", () => {
    const ci = wilsonInterval(3, 3)!;
    expect(ci.high - ci.low).toBeGreaterThan(0.4);
  });

  it("Rogan–Gladen matches the reference example and is undefined for chance-level judges", () => {
    expect(roganGladen(0.8, 0.92, 0.88)).toBeCloseTo((0.8 + 0.88 - 1) / (0.92 + 0.88 - 1));
    expect(roganGladen(0.5, 0.5, 0.5)).toBeNull();
    expect(roganGladen(0.5, null, 0.9)).toBeNull();
  });
});

describe("calibration report", () => {
  it("labels small samples as experimental with insufficient data", () => {
    const r = calibrationReport([pair(true, "FAIL", 1), pair(false, "PASS", 2)]);
    expect(r.insufficient).toBe(true);
    expect(r.status_label).toBe("Experimental — insufficient validation data.");
  });

  it("lists disagreements (false positives and false negatives) for human inspection", () => {
    const r = calibrationReport([pair(true, "PASS", 1), pair(false, "FAIL", 2), pair(true, "FAIL", 3), pair(false, "REQUIRES_REVIEW", 4)]);
    expect(r.disagreements.map((d) => d.trace_id).sort()).toEqual(["t1", "t2"]);
  });

  it("explains why a metric is undefined", () => {
    const r = calibrationReport([pair(false, "PASS")]);
    expect(r.tpr).toBeNull();
    expect(r.undefined_reasons.join(" ")).toMatch(/TPR undefined/);
  });
});
