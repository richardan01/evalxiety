"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button, MockBadge, cx, fmtUsd } from "@/components/ui";
import type { CaseChange, RunSummary } from "@/lib/metrics/experiments";
import type { BatchEstimate } from "./types";
import { saveReviewer, useReviewer } from "./reviewer";

export const shortHash = (h: string) => h.slice(0, 12);

export const fmtMs = (ms: number | null | undefined) =>
  ms === null || ms === undefined || !Number.isFinite(ms) ? "—" : `${Math.round(ms).toLocaleString()} ms`;

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

export const humanize = (id: string) => id.replace(/_/g, " ");

/** Estimated agent spend of a run; mock runs never spend. */
export const agentCost = (s: RunSummary, mode: "live" | "mock") => (mode === "mock" ? "$0 (mock)" : fmtUsd(s.total_cost_usd, 4));

/** Where the audited held-out reveal lives (the held-out view of the calibration panel). */
export const HELDOUT_REVEAL_HREF = "/evaluators?split=heldout#calibration";

/** Short, positively phrased check names for table headers; the full question is in the tooltip. */
const CHECK_LABELS: Record<string, string> = {
  margin_calculation_error: "Margin math",
  stale_policy_used: "Right policy",
  missing_mandatory_approval: "Approvals",
  margin_guardrail_violation: "Margin floor",
};
export const checkLabel = (id: string) => CHECK_LABELS[id] ?? humanize(id);

// ---------------------------------------------------------------------------
// Outcome dots — icon + colour, never colour alone
// ---------------------------------------------------------------------------

const DOT: Record<string, { icon: string; label: string; cls: string }> = {
  PASS: { icon: "✓", label: "pass", cls: "bg-emerald-500 text-white" },
  FAIL: { icon: "✕", label: "fail", cls: "bg-rose-600 text-white" },
  NOT_APPLICABLE: { icon: "–", label: "not applicable", cls: "bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200" },
  ERROR: { icon: "!", label: "error (counts as not passing)", cls: "bg-violet-600 text-white" },
  REQUIRES_REVIEW: { icon: "?", label: "needs human review (not a pass)", cls: "bg-amber-400 text-amber-950" },
};

export function Dot({ outcome, side }: { outcome: string | null | undefined; side?: string }) {
  const m = outcome ? DOT[outcome] : undefined;
  const label = m?.label ?? (outcome ? humanize(outcome).toLowerCase() : "no result");
  const text = side ? `${side}: ${label}` : label;
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={cx(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] leading-none font-bold",
        m?.cls ?? "border border-dashed border-slate-300 text-slate-400",
      )}
    >
      {m?.icon ?? "·"}
    </span>
  );
}

/** Baseline dot → candidate dot. */
export function DotPair({ from, to }: { from: string | null | undefined; to: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Dot outcome={from} side="Baseline" />
      <span aria-hidden className="text-[10px] text-slate-300">
        →
      </span>
      <Dot outcome={to} side="Corrected" />
    </span>
  );
}

export function DotLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
      {(["PASS", "FAIL", "NOT_APPLICABLE", "ERROR", "REQUIRES_REVIEW"] as const).map((o) => (
        <span key={o} className="inline-flex items-center gap-1">
          <Dot outcome={o} /> {DOT[o].label.replace(/ \(.*\)$/, "")}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <Dot outcome={null} /> no trace
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case change
// ---------------------------------------------------------------------------

const CHANGE_META: Record<CaseChange, { label: string; icon: string; tone: "green" | "red" | "amber" | "neutral" | "purple"; help: string }> = {
  fixed: { label: "Fixed", icon: "↑", tone: "green", help: "Failed pass-all before, passes now" },
  regressed: { label: "Regressed", icon: "↓", tone: "red", help: "Passed pass-all before, fails now" },
  still_failing: { label: "Still failing", icon: "✕", tone: "amber", help: "Fails pass-all in both runs" },
  still_passing: { label: "Same", icon: "=", tone: "neutral", help: "Passes pass-all in both runs" },
  incomplete: { label: "Incomplete", icon: "?", tone: "purple", help: "Missing trace or an error in either run — not classified" },
};

export function ChangeBadge({ change }: { change: CaseChange }) {
  const m = CHANGE_META[change];
  return (
    <Badge tone={m.tone} title={m.help}>
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Collapsed-by-default secondary section. Pass `open` + `onOpenChange` to control it. */
export function Disclosure({
  id,
  title,
  meta,
  open,
  onOpenChange,
  children,
}: {
  id?: string;
  title: string;
  meta?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      open={open}
      onToggle={onOpenChange ? (e) => onOpenChange(e.currentTarget.open) : undefined}
      className="group scroll-mt-6 rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-xs text-slate-400 transition-transform group-open:rotate-90">
          ▶
        </span>
        <span className="font-medium text-slate-900">{title}</span>
        {meta && <span className="truncate text-xs text-slate-500">{meta}</span>}
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Reviewer + spend confirmation
// ---------------------------------------------------------------------------

/**
 * Who is acting. Runs and judge batches are written to the audit log with this
 * name; actions stay disabled until a name is saved.
 */
export function ReviewerInline() {
  const reviewer = useReviewer();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  if (reviewer && !editing) {
    return (
      <span className="text-xs text-slate-500" title="Recorded in the audit log with the run">
        as <b className="font-medium text-slate-800">{reviewer}</b>{" "}
        <button
          type="button"
          className="underline hover:text-slate-800"
          onClick={() => {
            setDraft(reviewer);
            setEditing(true);
          }}
        >
          change
        </button>
      </span>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        saveReviewer(draft);
        setEditing(false);
      }}
    >
      <input
        aria-label="Your name (required, recorded in the audit log)"
        className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
        placeholder="Your name (required)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={!draft.trim()}>
        Save
      </Button>
    </form>
  );
}

/** Modal shown when the API answers 409: the user must explicitly accept the estimated spend. */
export function PaidBatchDialog({
  title,
  estimate,
  message,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  estimate: BatchEstimate;
  message: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="paid-batch-title">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-3">
          <h3 id="paid-batch-title" className="text-sm font-semibold text-slate-900">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">Real Claude API calls — this spends API credits.</p>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-slate-500">Mode</dt>
            <dd>
              <MockBadge mode={estimate.mode} />
            </dd>
            <dt className="text-slate-500">Agent calls</dt>
            <dd className="tabular-nums">{estimate.agent_calls}</dd>
            <dt className="text-slate-500">Judge calls</dt>
            <dd className="tabular-nums">{estimate.judge_calls}</dd>
            <dt className="text-slate-500">Rough estimate</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">{fmtUsd(estimate.estimated_max_usd)}</dd>
          </dl>
          <p className="text-xs text-slate-600">{estimate.note}</p>
          <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Server message: {message}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel — don&apos;t spend
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Starting…" : `Confirm — roughly ${fmtUsd(estimate.estimated_max_usd)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
