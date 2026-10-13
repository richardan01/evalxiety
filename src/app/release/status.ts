/**
 * Pure presentation helpers for the release gate (shared by /release and the
 * Overview tile). Everything here is derived from the gate result only — no
 * numbers or verdicts are invented in the UI.
 */
import type { GateCheck, GateReason, GateResult, ReasonLevel } from "@/lib/release/gate";
import type { ReleaseStatus } from "@/lib/domain/schemas";

export const demoDisclaimer = (caseCount: number) =>
  `Demo decision on a synthetic ${caseCount}-case set — not a production certification.`;

export interface StatusMeta {
  label: string;
  tone: "red" | "amber" | "blue" | "green";
  /** Tailwind classes for the large banner. */
  banner: string;
  /** Tailwind classes for inline text (e.g. Overview tile). */
  text: string;
  /** Tailwind classes for a pill. */
  pill: string;
  explanation: string;
}

export const STATUS_META: Record<ReleaseStatus, StatusMeta> = {
  NO_SHIP: {
    label: "NO SHIP",
    tone: "red",
    banner: "border-rose-300 bg-rose-50 text-rose-950",
    text: "text-rose-700",
    pill: "bg-rose-700 text-white",
    explanation: "At least one blocking failure was found. This candidate must not be shipped, even as a demo.",
  },
  INSUFFICIENT_EVIDENCE: {
    label: "INSUFFICIENT EVIDENCE",
    tone: "amber",
    banner: "border-amber-300 bg-amber-50 text-amber-950",
    text: "text-amber-700",
    pill: "bg-amber-500 text-amber-950",
    explanation: "The evidence needed to make a decision is incomplete. Incomplete evidence is not a pass.",
  },
  ELIGIBLE_FOR_DEMO_APPROVAL: {
    label: "ELIGIBLE FOR DEMO APPROVAL",
    tone: "blue",
    banner: "border-sky-300 bg-sky-50 text-sky-950",
    text: "text-sky-700",
    pill: "bg-sky-700 text-white",
    explanation:
      "The automated evaluation found no blocking issues. A named human must still review the evidence and approve it before demo use.",
  },
  APPROVED_FOR_DEMO: {
    label: "APPROVED FOR DEMO",
    tone: "green",
    banner: "border-emerald-300 bg-emerald-50 text-emerald-950",
    text: "text-emerald-700",
    pill: "bg-emerald-700 text-white",
    explanation: "The evaluation found no blocking issues and a named human approved this exact evidence snapshot for demo use.",
  },
};

/** Same words as <StatusPill>, so the caption and the pill never disagree. */
export const PLAIN_STATUS: Record<ReleaseStatus, string> = {
  NO_SHIP: "No ship",
  INSUFFICIENT_EVIDENCE: "Not enough evidence",
  ELIGIBLE_FOR_DEMO_APPROVAL: "Ready for approval",
  APPROVED_FOR_DEMO: "Approved for demo",
};

export const APPROVAL_STATE_LABEL: Record<GateResult["approval_state"], string> = {
  none: "none",
  approved: "approved",
  rejected: "rejected",
  stale: "stale",
};

export const APPROVAL_STATE_HELP: Record<GateResult["approval_state"], string> = {
  none: "No human has recorded a decision for this candidate run yet.",
  approved: "A named human approved this exact evidence snapshot.",
  rejected: "A named human rejected this candidate on the current evidence.",
  stale: "The last human decision was made on different evidence. It no longer applies and a new decision is needed.",
};

export const LEVEL_ORDER: ReasonLevel[] = ["NO_SHIP", "INSUFFICIENT_EVIDENCE", "WARNING"];

export const LEVEL_META: Record<ReasonLevel, { title: string; icon: string; help: string; tone: "red" | "amber" | "slate" }> = {
  NO_SHIP: { title: "Blocking", icon: "✕", help: "Confirmed failures. Any one blocks the release.", tone: "red" },
  INSUFFICIENT_EVIDENCE: {
    title: "Missing evidence",
    icon: "…",
    help: "The gate cannot decide until these are closed. Not a failure — but not a pass either.",
    tone: "amber",
  },
  WARNING: { title: "Warnings", icon: "!", help: "Do not block on their own; the approver should read them.", tone: "slate" },
};

export function groupReasons(reasons: GateReason[]): Array<{ level: ReasonLevel; reasons: GateReason[] }> {
  return LEVEL_ORDER.map((level) => ({ level, reasons: reasons.filter((r) => r.level === level) })).filter((g) => g.reasons.length > 0);
}

/** Most severe reason first (NO_SHIP, then INSUFFICIENT_EVIDENCE, then WARNING), preserving gate order within a level. */
export function topReason(reasons: GateReason[]): GateReason | null {
  for (const level of LEVEL_ORDER) {
    const r = reasons.find((x) => x.level === level);
    if (r) return r;
  }
  return null;
}

/** First clause of a gate message: drops " — …" asides and trailing "(…)" qualifiers. Full text stays in a tooltip. */
export function shortMessage(message: string): string {
  const head = message.trim().split(" — ")[0].replace(/\s*\([^()]*\)\.?$/, "").replace(/\.$/, "");
  return `${head}.`;
}

const lcFirst = (s: string) => (/^[A-Z]([a-z]|\s)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------
// Verdict: one sentence + one next action, derived from the gate's reasons
// ---------------------------------------------------------------------------

export interface NextAction {
  label: string;
  href: string;
}

export interface Verdict {
  sentence: string;
  action: NextAction | null;
}

export interface VerdictInput {
  reasons: GateReason[];
  approval_state: GateResult["approval_state"];
  /** Name on the latest approval record (for approved / rejected wording). */
  approver: string | null;
  /** Number of cases in the required frozen set. */
  case_count: number;
  /** case_id → candidate trace_id, for "inspect the failing case" links. */
  trace_by_case: Map<string, string>;
}

const RUN_FINAL: NextAction = { label: "Run final check", href: "/experiments" };

/** Plain-English reason (no trailing period) and the action that closes it, by gate reason code. */
function explain(r: GateReason, input: VerdictInput): { why: string; action: NextAction } {
  const n = input.case_count;
  const fallbackWhy = lcFirst(shortMessage(r.message).replace(/\.$/, ""));
  switch (r.code) {
    case "no_candidate_run":
      return { why: `run the final check on all ${n} cases`, action: RUN_FINAL };
    case "no_baseline":
      return { why: `run the baseline on the same ${n} cases to compare against`, action: { label: "Run baseline", href: "/experiments" } };
    case "judge_not_run":
      return { why: fallbackWhy, action: { label: "Run the judge", href: "/experiments" } };
    case "insufficient_human_review":
      return { why: fallbackWhy, action: { label: "Review traces", href: "/review" } };
    case "unresolved_required_reviews":
      return { why: fallbackWhy, action: { label: `Review ${plural(r.case_ids.length, "case")}`, href: "/review" } };
    case "candidate_run_incomplete":
    case "candidate_not_on_required_set":
    case "frozen_set_mismatch":
    case "frozen_set_modified":
    case "required_tests_incomplete":
    case "mock_results":
    case "baseline_set_mismatch":
    case "mode_mismatch":
      return { why: fallbackWhy, action: RUN_FINAL };
  }
  if (r.level === "NO_SHIP") {
    const first = r.case_ids.find((id) => input.trace_by_case.has(id));
    return {
      why: fallbackWhy,
      action: first
        ? { label: `Inspect ${first}`, href: `/review/${input.trace_by_case.get(first)}` }
        : { label: "Fix and re-run", href: "/experiments" },
    };
  }
  return { why: fallbackWhy, action: { label: "Open experiments", href: "/experiments" } };
}

/**
 * The one-sentence "why" and single next action for the verdict block.
 * Evaluation comes only from the gate's reasons; approval state is reported
 * separately (evaluation ≠ approval) and only matters once nothing blocks.
 */
export function verdictFor(input: VerdictInput): Verdict {
  const { reasons } = input;
  const blocking = reasons.filter((r) => r.level === "NO_SHIP");
  const missing = reasons.filter((r) => r.level === "INSUFFICIENT_EVIDENCE");
  const warnings = reasons.filter((r) => r.level === "WARNING");

  if (blocking.length) {
    const { why, action } = explain(blocking[0], input);
    const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : "";
    return { sentence: `${plural(blocking.length, "blocking failure")}: ${why}${more}.`, action };
  }
  if (missing.length) {
    const { why, action } = explain(missing[0], input);
    const more = missing.length > 1 ? ` (+${missing.length - 1} more ${missing.length - 1 === 1 ? "gap" : "gaps"})` : "";
    return { sentence: `Not decided yet — ${why}${more}.`, action };
  }

  const approve: NextAction = { label: "Approve below", href: "#approval" };
  const warn = warnings.length ? ` Read ${plural(warnings.length, "warning")} first.` : "";
  const who = input.approver ?? "a named human";
  switch (input.approval_state) {
    case "approved":
      return { sentence: `No blockers — approved for the demo by ${who} on this exact evidence.`, action: null };
    case "rejected":
      return { sentence: `No blockers, but ${who} rejected it on this evidence.`, action: { label: "Decide again", href: "#approval" } };
    case "stale":
      return {
        sentence: `No blockers — the last decision is stale because the evidence changed.${warn}`,
        action: { label: "Decide again", href: "#approval" },
      };
    case "none":
      return { sentence: `No blockers — a named human can now approve it for the demo.${warn}`, action: approve };
  }
}

// ---------------------------------------------------------------------------
// Checklist + approval helpers
// ---------------------------------------------------------------------------

const CHECK_SHORT: Record<string, string> = {
  candidate_complete: "Candidate ran every case",
  frozen_integrity: "Test cases unchanged",
  live_execution: "Live model, not mock",
  baseline_comparison: "Baseline to compare",
  no_critical: "No critical violations",
  no_regression: "No new critical regressions",
  judge_run: "Judge ran on every case",
  reviews_resolved: "Every case human-reviewed",
};

/** Short checklist label; thresholds stay in the gate's own wording (e.g. "Pass-all ≥ 90%"). */
export function checkLabel(c: Pick<GateCheck, "id" | "label">): string {
  return CHECK_SHORT[c.id] ?? c.label.replace(/ on validated checks$/, "");
}

/** Why the Approve button is disabled (one line), or null when approval is allowed. */
export function approveBlockedReason(gate: Pick<GateResult, "evaluation_status">, hasCandidate: boolean): string | null {
  if (!hasCandidate) return "Nothing to approve yet — no candidate run.";
  if (gate.evaluation_status === "ELIGIBLE_FOR_DEMO_APPROVAL") return null;
  return `Approve unlocks at “${PLAIN_STATUS.ELIGIBLE_FOR_DEMO_APPROVAL}” — now “${PLAIN_STATUS[gate.evaluation_status]}”.`;
}

export const shortHash = (h: string | null | undefined, n = 12) => (h ? h.slice(0, n) : "—");
