/**
 * Judge calibration against human labels.
 *
 * Positive class = an actual failure (human says the unsupported-justification
 * failure is present). Human labels are the reference; judge labels never
 * become ground truth.
 *
 *   TP = human failure / judge failure      FN = human failure / judge pass
 *   FP = human pass    / judge failure      TN = human pass    / judge pass
 *   TPR = TP / (TP + FN)                    TNR = TN / (TN + FP)
 *
 * Any ratio with a zero denominator is `null` (undefined) — never 0% or 100%.
 * REQUIRES_REVIEW and ERROR verdicts are not forced into PASS/FAIL; they are
 * counted separately and excluded from the matrix.
 */
import type { JudgeVerdict } from "../domain/schemas";

export interface CalibrationPair {
  trace_id: string;
  case_id: string;
  human_failure: boolean; // reference label
  judge_verdict: JudgeVerdict;
}

export interface ConfusionMatrix {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  /** pairs with a binary judge verdict */
  n: number;
  positives: number; // human failures among n
  negatives: number; // human passes among n
  excluded_requires_review: number;
  excluded_error: number;
}

export function confusionMatrix(pairs: CalibrationPair[]): ConfusionMatrix {
  const m: ConfusionMatrix = { tp: 0, fn: 0, fp: 0, tn: 0, n: 0, positives: 0, negatives: 0, excluded_requires_review: 0, excluded_error: 0 };
  for (const p of pairs) {
    if (p.judge_verdict === "REQUIRES_REVIEW") {
      m.excluded_requires_review++;
      continue;
    }
    if (p.judge_verdict === "ERROR") {
      m.excluded_error++;
      continue;
    }
    const judgeFailure = p.judge_verdict === "FAIL";
    if (p.human_failure && judgeFailure) m.tp++;
    else if (p.human_failure && !judgeFailure) m.fn++;
    else if (!p.human_failure && judgeFailure) m.fp++;
    else m.tn++;
  }
  m.n = m.tp + m.fn + m.fp + m.tn;
  m.positives = m.tp + m.fn;
  m.negatives = m.tn + m.fp;
  return m;
}

/** num/den, or null when den is 0 (undefined). */
export function safeRate(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export function tpr(m: ConfusionMatrix): number | null {
  return safeRate(m.tp, m.tp + m.fn);
}

export function tnr(m: ConfusionMatrix): number | null {
  return safeRate(m.tn, m.tn + m.fp);
}

/** Wilson score interval for a binomial proportion; null when n = 0. */
export function wilsonInterval(successes: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/**
 * Rogan–Gladen corrected prevalence: θ = (p_obs + TNR − 1) / (TPR + TNR − 1), clipped to [0, 1].
 * Undefined (null) when TPR or TNR is undefined or the judge is no better than chance
 * (TPR + TNR − 1 ≤ 0).
 */
export function roganGladen(observedFailureRate: number | null, tprV: number | null, tnrV: number | null): number | null {
  if (observedFailureRate === null || tprV === null || tnrV === null) return null;
  const denom = tprV + tnrV - 1;
  if (denom <= 0) return null;
  return Math.min(1, Math.max(0, (observedFailureRate + tnrV - 1) / denom));
}

/**
 * Minimum labelled examples PER CLASS before we stop calling results
 * "insufficient". 30 is the lower end of the 30–50-per-class guidance in the
 * evals FAQ / LLM-judge guide. This is a reporting convention about sample
 * size — NOT a reliability threshold. The judge stays experimental in this
 * build regardless of the numbers.
 */
export const MIN_PER_CLASS = 30;

export interface CalibrationReport {
  matrix: ConfusionMatrix;
  tpr: number | null;
  tnr: number | null;
  tpr_ci: { low: number; high: number } | null;
  tnr_ci: { low: number; high: number } | null;
  status_label: string;
  insufficient: boolean;
  undefined_reasons: string[];
  disagreements: CalibrationPair[];
}

export function calibrationReport(pairs: CalibrationPair[]): CalibrationReport {
  const m = confusionMatrix(pairs);
  const insufficient = m.positives < MIN_PER_CLASS || m.negatives < MIN_PER_CLASS;
  const reasons: string[] = [];
  if (m.positives === 0) reasons.push("TPR undefined: no human-labelled failures with a binary judge verdict");
  if (m.negatives === 0) reasons.push("TNR undefined: no human-labelled passes with a binary judge verdict");
  return {
    matrix: m,
    tpr: tpr(m),
    tnr: tnr(m),
    tpr_ci: wilsonInterval(m.tp, m.positives),
    tnr_ci: wilsonInterval(m.tn, m.negatives),
    status_label: insufficient
      ? "Experimental — insufficient validation data."
      : "Experimental — validated on a small prototype set; not release-grade evidence.",
    insufficient,
    undefined_reasons: reasons,
    disagreements: pairs.filter(
      (p) =>
        (p.judge_verdict === "FAIL" && !p.human_failure) || (p.judge_verdict === "PASS" && p.human_failure),
    ),
  };
}
