/**
 * Evalxiety's worries: every reason the current evaluation evidence should not
 * (yet) be trusted, most serious first. Derived only from /api/overview data.
 */
import type { OverviewData } from "./types";

export type WorryLevel = "blocker" | "evidence" | "caveat";
export interface Worry {
  level: WorryLevel;
  text: string;
  href: string;
}

const HEADLINES: Record<string, string> = {
  NO_SHIP: "Absolutely not shipping this.",
  INSUFFICIENT_EVIDENCE: "I can't tell yet — and that makes me nervous.",
  ELIGIBLE_FOR_DEMO_APPROVAL: "It looks okay… but a human still has to sign off.",
  APPROVED_FOR_DEMO: "A human approved it. Okay. Breathing.",
};

export function headline(status: string): string {
  return HEADLINES[status] ?? "Checking…";
}

const list = (ids: string[]) => (ids.length <= 3 ? ids.join(", ") : `${ids.slice(0, 3).join(", ")} +${ids.length - 3}`);

export function worries(o: OverviewData): Worry[] {
  const out: Worry[] = [];
  const reason = (code: string) => o.release_reasons.find((r) => r.code === code);

  const regress = o.trend.new_critical_regressions.map((r) => r.case_id);
  if (regress.length) {
    out.push({ level: "blocker", text: `${list(regress)} passed before the fix and fails now. That's a new critical regression.`, href: "/experiments" });
  }
  const critical = reason("critical_policy_violation");
  if (critical && critical.case_ids.length) {
    out.push({ level: "blocker", text: `${list(critical.case_ids)} break${critical.case_ids.length === 1 ? "s" : ""} a policy rule in the version we'd ship.`, href: "/release" });
  }
  const below = reason("pass_all_below_threshold");
  if (below) out.push({ level: "blocker", text: "Pass-all is under the 90% bar.", href: "/experiments" });

  if (o.executions.total === 0) out.push({ level: "evidence", text: "Nothing has been run. I have no evidence at all.", href: "/review" });
  if (o.executions.live === 0 && o.executions.total > 0) {
    out.push({ level: "evidence", text: "Every result is MOCK. None of it says anything about the real model.", href: "/" });
  }
  const reviewed = o.review.reviewed_traces;
  if (reviewed < o.review.target_min) {
    out.push({
      level: "evidence",
      text: `Only ${reviewed} human review${reviewed === 1 ? "" : "s"}. Without your labels I can't trust any of these numbers.`,
      href: "/review",
    });
  }
  const unresolved = reason("unresolved_required_reviews");
  if (unresolved && unresolved.case_ids.length) {
    out.push({ level: "evidence", text: `${unresolved.case_ids.length} answers in the version we'd ship haven't been checked by a human.`, href: "/review" });
  }
  if (!o.judge || o.judge.n === 0) {
    out.push({ level: "evidence", text: "The AI judge has never been compared with you. Its PASSes could be lucky guesses.", href: "/evaluators#calibration" });
  } else if ((o.judge.tpr !== null && o.judge.tpr < 0.8) || (o.judge.tnr !== null && o.judge.tnr < 0.8)) {
    out.push({ level: "evidence", text: "The AI judge disagrees with you too often to be trusted.", href: "/evaluators#calibration" });
  }
  if (!o.candidate_run) {
    out.push({ level: "evidence", text: "The 8 held-out cases haven't been run, so I've only seen cases we tuned on.", href: "/experiments" });
  }

  const corrected = o.trend.points.find((p) => p.role === "corrected");
  if (corrected && corrected.pass_all_rate !== null && corrected.pass_all_rate >= 0.9 && corrected.pass_all_rate < 0.95 && !below) {
    out.push({ level: "caveat", text: `Pass-all is ${Math.round(corrected.pass_all_rate * 1000) / 10}% — right on the 90% bar. One more failure and we're under.`, href: "/experiments" });
  }
  out.push({ level: "caveat", text: `It's ${o.scenario_count} synthetic cases. A rehearsal, not production.`, href: "/start" });
  return out;
}
