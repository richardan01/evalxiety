"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button, MockBadge, fmtUsd } from "@/components/ui";
import type { CaseChange } from "@/lib/metrics/experiments";
import type { BatchEstimate } from "./types";
import { saveReviewer, useReviewer } from "./reviewer";

export const shortHash = (h: string) => h.slice(0, 12);

export const fmtMs = (ms: number | null | undefined) =>
  ms === null || ms === undefined || !Number.isFinite(ms) ? "—" : `${Math.round(ms).toLocaleString()} ms`;

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

export const humanize = (id: string) => id.replace(/_/g, " ");

/** Numbered section heading with plain-language helper text. */
export function SectionHeading({ n, id, title, children }: { n: number; id: string; title: string; children?: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
          {n}
        </span>
        {title}
      </h2>
      {children && <div className="mt-1 max-w-4xl text-sm text-slate-600">{children}</div>}
    </div>
  );
}

/** Compact evaluator outcome badge (NOT_APPLICABLE → N/A). */
export function OutcomeChip({ outcome }: { outcome: string | null }) {
  if (outcome === null) return <Badge tone="neutral" title="No result: the case has no trace in this run">—</Badge>;
  const tone = outcome === "PASS" ? "green" : outcome === "FAIL" ? "red" : outcome === "ERROR" ? "purple" : outcome === "REQUIRES_REVIEW" ? "amber" : "neutral";
  const label = outcome === "NOT_APPLICABLE" ? "N/A" : outcome === "REQUIRES_REVIEW" ? "REVIEW" : outcome;
  return (
    <Badge tone={tone} title={outcome.replace(/_/g, " ")}>
      {label}
    </Badge>
  );
}

const CHANGE_META: Record<CaseChange, { label: string; tone: "green" | "red" | "amber" | "neutral" | "purple"; help: string }> = {
  fixed: { label: "FIXED", tone: "green", help: "Failed pass-all in the baseline run, passes in the candidate run" },
  regressed: { label: "REGRESSED", tone: "red", help: "Passed pass-all in the baseline run, fails in the candidate run" },
  still_failing: { label: "STILL FAILING", tone: "amber", help: "Fails pass-all in both runs" },
  still_passing: { label: "STILL PASSING", tone: "neutral", help: "Passes pass-all in both runs" },
  incomplete: {
    label: "INCOMPLETE",
    tone: "purple",
    help: "Missing trace, execution error or evaluator error in either run — cannot be classified",
  },
};

export function ChangeBadge({ change }: { change: CaseChange }) {
  const m = CHANGE_META[change];
  return (
    <Badge tone={m.tone} title={m.help}>
      {m.label}
    </Badge>
  );
}

export const changeHelp = (c: CaseChange) => CHANGE_META[c].help;

export function ModePair({ baseline, candidate }: { baseline: "live" | "mock"; candidate: "live" | "mock" }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      baseline <MockBadge mode={baseline} /> · candidate <MockBadge mode={candidate} />
    </span>
  );
}

/**
 * Who is acting. Runs and judge batches are written to the audit log with this
 * name; actions stay disabled until a name is saved.
 */
export function ReviewerField({ purpose }: { purpose: string }) {
  const reviewer = useReviewer();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  if (reviewer && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        Acting as <b className="text-slate-900">{reviewer}</b>
        <span className="text-xs text-slate-500">({purpose})</span>
        <Button
          variant="ghost"
          onClick={() => {
            setDraft(reviewer);
            setEditing(true);
          }}
        >
          Change
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        saveReviewer(draft);
        setEditing(false);
      }}
    >
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-500">Your name (required — {purpose})</span>
        <input
          className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="e.g. Pricing reviewer name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <Button type="submit" variant="secondary" disabled={!draft.trim()}>
        Save name
      </Button>
      {editing && (
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      )}
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
          <p className="mt-0.5 text-xs text-slate-500">This batch makes real Claude API calls and spends API credits.</p>
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
