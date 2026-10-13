"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { postJSON } from "@/lib/client/api";
import type { GoldExample } from "@/lib/domain/schemas";
import { Button, JsonDetails, MockBadge, SplitBadge, cx, fmtDateTime } from "@/components/ui";
import { ErrorText, TextInput, attempt, useAuthor } from "../taxonomy/_shared/forms";
import { HumanLabelBadge, ModeNames, UnsupportedLabelBadge } from "./labels";
import type { GoldPostRequest } from "./types";

export const thCls = "text-left text-[11px] font-medium uppercase tracking-wide text-slate-400";

/** Label/value row in an expanded record (same look as the per-trace review card). */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="min-w-0 text-sm text-slate-800">{children}</div>
    </div>
  );
}

export function ExpandToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded px-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-800"
    >
      <span aria-hidden className={cx("inline-block transition-transform", open && "rotate-90")}>
        ▶
      </span>
    </button>
  );
}

function RemoveControl({ g, reload }: { g: GoldExample; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { author, setAuthor, remember } = useAuthor();
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Remove from gold…
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-950">
      <span>Remove? Trace and label are kept; removal is audited.</span>
      <TextInput ariaLabel="Your name" className="w-40" value={author} onChange={setAuthor} placeholder="Your name (required)" />
      <Button
        variant="danger"
        disabled={busy || !author.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          remember();
          const payload: GoldPostRequest = { action: "remove", gold_id: g.gold_id, actor: author.trim() };
          const err = await attempt(() => postJSON("/api/gold", payload));
          setBusy(false);
          if (err) setError(err);
          else reload();
        }}
      >
        {busy ? "Removing…" : "Confirm remove"}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

function GoldRow({ g, names, reload }: { g: GoldExample; names: Record<string, string>; reload: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr onClick={() => setOpen((o) => !o)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
        <td className="py-2 pl-4 pr-3 font-semibold text-slate-900">{g.case_id}</td>
        <td className="pr-3">
          <HumanLabelBadge label={g.human_label} />
        </td>
        <td className="pr-3">
          <ModeNames ids={g.failure_mode_ids} names={names} />
        </td>
        <td className="pr-3 text-slate-700">{g.reviewer}</td>
        <td className="pr-3">
          <SplitBadge split={g.dataset_split} />
        </td>
        <td className="pr-3">
          <MockBadge mode={g.trace_execution_mode} />
        </td>
        <td className="pr-3 text-right">
          <ExpandToggle open={open} onClick={() => setOpen((o) => !o)} label="Show full record" />
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={7} className="px-4 pb-3 pt-1">
            <DetailRow label="Trace">
              <Link href={`/review/${g.trace_id}`} className="font-mono text-xs text-sky-700 hover:underline">
                {g.trace_id}
              </Link>
            </DetailRow>
            <DetailRow label="Unsupported claim">
              <UnsupportedLabelBadge label={g.unsupported_justification_label} />
            </DetailRow>
            <DetailRow label="Expected">
              <p className="whitespace-pre-wrap">{g.expected_behavior || "—"}</p>
            </DetailRow>
            <DetailRow label="Evidence">
              <p className="whitespace-pre-wrap">{g.supporting_evidence || "—"}</p>
            </DetailRow>
            <DetailRow label="Policies">
              {g.reference_policy_ids.length ? g.reference_policy_ids.join(", ") : <span className="text-slate-400">none</span>}
            </DetailRow>
            <DetailRow label="Rules">
              {g.applicable_objective_rules.length ? (
                <span className="flex flex-wrap gap-x-3 font-mono text-xs">
                  {g.applicable_objective_rules.map((r) => (
                    <code key={r}>{r}</code>
                  ))}
                </span>
              ) : (
                <span className="text-slate-400">none</span>
              )}
            </DetailRow>
            <DetailRow label="Reviewed">
              {g.reviewer} ({g.label_source}) · {fmtDateTime(g.review_timestamp)} · label v{g.label_version}
            </DetailRow>
            <DetailRow label="Promoted">
              {g.promoted_by} · {fmtDateTime(g.promoted_at)}
            </DetailRow>
            <DetailRow label="IDs">
              <span className="font-mono text-xs text-slate-500">
                {g.gold_id} · {g.annotation_id}
              </span>
            </DetailRow>
            <div className="mt-2 space-y-2">
              <JsonDetails summary="Input scenario" value={g.input_scenario} />
              <RemoveControl g={g} reload={reload} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Gold examples: key columns only; full provenance in the expandable row. */
export function GoldTable({ gold, names, reload }: { gold: GoldExample[]; names: Record<string, string>; reload: () => void }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={thCls}>
          <th className="py-2 pl-4 pr-3">Case</th>
          <th className="pr-3">Verdict</th>
          <th className="pr-3">Failure type</th>
          <th className="pr-3">Reviewer</th>
          <th className="pr-3">Set</th>
          <th className="pr-3">Mode</th>
          <th className="pr-3" />
        </tr>
      </thead>
      <tbody>
        {gold.map((g) => (
          <GoldRow key={g.gold_id} g={g} names={names} reload={reload} />
        ))}
      </tbody>
    </table>
  );
}
