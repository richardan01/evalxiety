/**
 * Pure presentation helpers for the release gate (shared by /release and the
 * Overview tile). Everything here is derived from the gate result only — no
 * numbers or verdicts are invented in the UI.
 */
import type { GateReason, GateResult, ReasonLevel } from "@/lib/release/gate";
import type { ReleaseStatus } from "@/lib/domain/schemas";

export const DEMO_DISCLAIMER = "Demo release decision for a synthetic prototype set — not a production certification.";

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

export const LEVEL_META: Record<ReasonLevel, { title: string; help: string; tone: "red" | "amber" | "slate" }> = {
  NO_SHIP: {
    title: "Blocking failures (NO SHIP)",
    help: "Confirmed failures. Any one of these blocks the release regardless of other results.",
    tone: "red",
  },
  INSUFFICIENT_EVIDENCE: {
    title: "Missing evidence (INSUFFICIENT EVIDENCE)",
    help: "The gate cannot decide until these are resolved. They are not failures of the agent, but they are not passes either.",
    tone: "amber",
  },
  WARNING: {
    title: "Warnings (shown to the approver)",
    help: "Do not block on their own, but the human approver should read them before deciding.",
    tone: "slate",
  },
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

export interface Recommendation {
  tone: "red" | "amber" | "blue";
  headline: string;
  next_step: string;
}

const join = (rs: GateReason[], n: number) =>
  rs
    .slice(0, n)
    .map((r) => r.message.trim().replace(/\.?$/, "."))
    .join(" ");

const more = (rs: GateReason[], n: number, noun: string) =>
  rs.length > n ? ` (+${rs.length - n} more ${noun}${rs.length - n === 1 ? "" : "s"} below.)` : "";

/**
 * Plain-language recommendation derived ONLY from the gate's reasons.
 * Approval state is reported separately (evaluation ≠ approval).
 */
export function recommendationFromReasons(reasons: GateReason[]): Recommendation {
  const noShip = reasons.filter((r) => r.level === "NO_SHIP");
  const missing = reasons.filter((r) => r.level === "INSUFFICIENT_EVIDENCE");
  const warnings = reasons.filter((r) => r.level === "WARNING");
  if (noShip.length) {
    return {
      tone: "red",
      headline: `Do not ship: ${join(noShip, 2)}${more(noShip, 2, "blocking reason")}`,
      next_step:
        "Fix the agent configuration, rerun the frozen cases, and re-check the gate." +
        (missing.length ? ` ${missing.length} evidence gap(s) also need to be closed.` : ""),
    };
  }
  if (missing.length) {
    return {
      tone: "amber",
      headline: `Do not ship yet — not enough evidence to decide: ${join(missing, 2)}${more(missing, 2, "evidence gap")}`,
      next_step: "Close each evidence gap listed below, then re-check. A gate with missing evidence is not a pass.",
    };
  }
  if (warnings.length) {
    return {
      tone: "blue",
      headline: `No blocking reasons found. Read ${warnings.length} warning(s) before deciding: ${join(warnings, 1)}${more(warnings, 1, "warning")}`,
      next_step: "A named human may approve this candidate for demo use after reviewing the evidence and warnings.",
    };
  }
  return {
    tone: "blue",
    headline: "No blocking reasons found by the gate.",
    next_step: "A named human may approve this candidate for demo use after reviewing the evidence below.",
  };
}

/** Why the Approve button is disabled, or null when approval is allowed. */
export function approveBlockedReason(gate: Pick<GateResult, "evaluation_status" | "reasons">, hasCandidate: boolean): string | null {
  if (!hasCandidate) return "There is no candidate run to approve. Run the corrected configuration on FROZEN-FULL-v1 first.";
  if (gate.evaluation_status === "ELIGIBLE_FOR_DEMO_APPROVAL") return null;
  const top = topReason(gate.reasons);
  return `Approval is only possible when the evaluation status is ELIGIBLE FOR DEMO APPROVAL. It is currently ${STATUS_META[gate.evaluation_status].label}${
    top ? ` — ${top.message.trim()}` : "."
  }`;
}

export const shortHash = (h: string | null | undefined, n = 12) => (h ? h.slice(0, n) : "—");
