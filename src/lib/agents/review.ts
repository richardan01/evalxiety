/**
 * Human review, counted the way the release decision counts it. Pure and client-safe.
 *
 *   - An answer is *decided* once a named person marked it pass or fail. "Not sure" is kept and shown, but it isn't a
 *     decision: the answer still needs one.
 *   - Two people who decided the same answer can disagree. The gate already counts any fail label as a fail, so a
 *     disagreement can't hide a problem; it's shown to the approver, and here as how often reviewers agree.
 *
 * Agreement is the share of reviewer pairs on the same answer who gave the same verdict, with a 95% Wilson interval,
 * and Cohen's kappa (agreement beyond chance) when exactly two people reviewed the shared answers. Below MIN_OVERLAP
 * shared answers it's reported as too few to say, like the AI reviewer's calibration.
 */
import { wilsonInterval } from "../metrics/calibration";

export type Outcome = "pass" | "fail" | "unsure";
export interface Label {
  trace_id: string;
  case_id: string;
  reviewer: string;
  task_outcome: Outcome;
}

/** open: nobody has marked it · unsure: only "not sure" so far · decided: pass/fail, all agree · disputed: pass and fail */
export type AnswerStatus = "open" | "unsure" | "decided" | "disputed";

export function answerStatus(labels: Array<Pick<Label, "task_outcome">>): AnswerStatus {
  const decided = new Set(labels.map((l) => l.task_outcome).filter((o) => o !== "unsure"));
  if (decided.size > 1) return "disputed";
  if (decided.size === 1) return "decided";
  return labels.length ? "unsure" : "open";
}

export const isDecided = (l: Pick<Label, "task_outcome">) => l.task_outcome !== "unsure";

/** Answers that two or more people decided are needed before agreement says anything. */
export const MIN_OVERLAP = 10;

export interface Agreement {
  /** Answers decided by two or more different people. */
  shared: number;
  /** Reviewer pairs on those answers, and how many of them gave the same verdict. */
  pairs: number;
  agreeing: number;
  rate: number | null;
  interval: { low: number; high: number } | null;
  /** Only when exactly two people reviewed the shared answers; null otherwise (or when chance agreement is total). */
  kappa: number | null;
  reviewers: string[];
  enough: boolean;
  /** Answers where people disagree, with who said what. */
  disputes: Array<{ trace_id: string; case_id: string; labels: Array<{ reviewer: string; task_outcome: "pass" | "fail" }> }>;
}

export function agreement(labels: Label[]): Agreement {
  const byTrace = new Map<string, Label[]>();
  for (const l of labels.filter(isDecided)) byTrace.set(l.trace_id, [...(byTrace.get(l.trace_id) ?? []), l]);
  let pairs = 0;
  let agreeing = 0;
  const reviewers = new Set<string>();
  const shared: Label[][] = [];
  const disputes: Agreement["disputes"] = [];
  for (const ls of byTrace.values()) {
    // One label per person (the store keeps one per trace × reviewer; be safe anyway).
    const mine = [...new Map(ls.map((l) => [l.reviewer, l])).values()];
    if (mine.length < 2) continue;
    shared.push(mine);
    mine.forEach((l) => reviewers.add(l.reviewer));
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        pairs++;
        if (mine[i].task_outcome === mine[j].task_outcome) agreeing++;
      }
    }
    if (answerStatus(mine) === "disputed") {
      disputes.push({
        trace_id: mine[0].trace_id,
        case_id: mine[0].case_id,
        labels: mine.map((l) => ({ reviewer: l.reviewer, task_outcome: l.task_outcome as "pass" | "fail" })),
      });
    }
  }
  return {
    shared: shared.length,
    pairs,
    agreeing,
    rate: pairs ? agreeing / pairs : null,
    interval: wilsonInterval(agreeing, pairs),
    kappa: reviewers.size === 2 ? cohensKappa(shared) : null,
    reviewers: [...reviewers].sort(),
    enough: shared.length >= MIN_OVERLAP,
    disputes: disputes.sort((a, b) => (a.case_id < b.case_id ? -1 : 1)),
  };
}

/** Cohen's kappa for two people over the answers both decided. Null when chance agreement is already total. */
export function cohensKappa(shared: Label[][]): number | null {
  const names = [...new Set(shared.flat().map((l) => l.reviewer))];
  if (names.length !== 2 || !shared.length) return null;
  const [a, b] = names;
  const both = shared.map((ls) => [ls.find((l) => l.reviewer === a)!, ls.find((l) => l.reviewer === b)!]);
  const n = both.length;
  const observed = both.filter(([x, y]) => x.task_outcome === y.task_outcome).length / n;
  const passA = both.filter(([x]) => x.task_outcome === "pass").length / n;
  const passB = both.filter(([, y]) => y.task_outcome === "pass").length / n;
  const chance = passA * passB + (1 - passA) * (1 - passB);
  return chance === 1 ? null : (observed - chance) / (1 - chance);
}

/** One answer of a test, as the review queue and progress bars show it. */
export interface QueueItem {
  case_id: string;
  trace_id: string;
  status: AnswerStatus;
  /** Decided, and if the AI reviewer flagged it, its question answered too (what the gate needs). */
  reviewed: boolean;
  /** This reviewer has marked it (any verdict, "not sure" included). */
  mine: boolean;
}

export interface Progress {
  total: number;
  /** Decided and complete (what the gate counts). */
  reviewed: number;
  unsure: number;
  disputed: number;
  /** Nobody has decided it yet (open or not sure), or the AI reviewer's question is still unanswered. */
  open: number;
  mine: number;
}

export function progressOf(items: QueueItem[]): Progress {
  return {
    total: items.length,
    reviewed: items.filter((i) => i.reviewed).length,
    unsure: items.filter((i) => i.status === "unsure").length,
    disputed: items.filter((i) => i.status === "disputed").length,
    open: items.filter((i) => !i.reviewed).length,
    mine: items.filter((i) => i.mine).length,
  };
}

/** Where "Save & next" goes: the next answer this reviewer hasn't marked, wrapping around; null when they've done all. */
export function nextForMe(items: QueueItem[], currentTraceId: string): QueueItem | null {
  const at = items.findIndex((i) => i.trace_id === currentTraceId);
  const order = [...items.slice(at + 1), ...items.slice(0, Math.max(at, 0))];
  return order.find((i) => !i.mine) ?? null;
}
