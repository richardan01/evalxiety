"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { postJSON } from "@/lib/client/api";
import { Badge, Button, MockBadge, SeverityBadge, SplitBadge, fmtDateTime } from "@/components/ui";
import { ErrorText, TextArea, TextInput, attempt, useAuthor } from "../taxonomy/_shared/forms";
import { DetailRow, ExpandToggle, thCls } from "./GoldTable";
import { HumanLabelBadge, ModeNames, UnsupportedLabelBadge } from "./labels";
import type { GoldCandidate, GoldPostRequest } from "./types";

/** One candidate per row with a Promote button; the editable expected behaviour sits in the expanded row. */
function CandidateRow({
  c,
  names,
  sameTraceCount,
  reload,
}: {
  c: GoldCandidate;
  names: Record<string, string>;
  sameTraceCount: number;
  reload: () => void;
}) {
  const a = c.annotation;
  const preview = c.expected_behavior?.text ?? "";
  const [open, setOpen] = useState(false);
  const [expected, setExpected] = useState(preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Name field visibility follows the SAVED name so it doesn't unmount mid-typing.
  const { author, saved, setAuthor, remember } = useAuthor();
  const firstId = a.first_failure?.failure_mode_id ?? null;
  const modeIds = [...new Set([firstId, ...a.additional_failure_mode_ids].filter((x): x is string => Boolean(x)))];
  const edited = expected.trim() !== preview.trim();
  const updated = c.reason === "annotation_updated_since_promotion";
  const blocked = !author.trim() ? "Enter your name first" : c.expected_behavior_error ? "Expected behaviour could not be derived" : edited && !expected.trim() ? "Expected behaviour is empty" : null;

  const promote = async () => {
    setBusy(true);
    setError(null);
    remember();
    const payload: GoldPostRequest = {
      action: "promote",
      annotation_id: a.annotation_id,
      promoted_by: author.trim(),
      expected_behavior: edited ? expected : undefined,
    };
    const err = await attempt(() => postJSON("/api/gold", payload));
    setBusy(false);
    if (err) setError(err);
    else reload();
  };

  return (
    <Fragment>
      <tr className="border-t border-slate-100 align-middle">
        <td className="py-2 pl-4 pr-3 font-semibold text-slate-900">
          <Link href={`/review/${c.trace_id}`} className="hover:underline" title={c.trace_id}>
            {c.case_id}
          </Link>
        </td>
        <td className="pr-3">
          <HumanLabelBadge label={a.task_outcome} />
        </td>
        <td className="pr-3">
          {a.first_failure && !firstId ? (
            <Link href="/review/taxonomy" title="First failure has no type yet — assign one first">
              <Badge tone="amber">no type yet</Badge>
            </Link>
          ) : (
            <ModeNames ids={modeIds} names={names} firstId={firstId} />
          )}
        </td>
        <td className="pr-3 text-slate-700">
          {a.reviewer}
          {sameTraceCount > 1 && (
            <span className="ml-1 text-xs text-slate-400" title="Several reviewers labelled this trace; only one label per trace becomes gold">
              +{sameTraceCount - 1}
            </span>
          )}
        </td>
        <td className="pr-3">
          <SplitBadge split={c.split} />
        </td>
        <td className="pr-3">
          <MockBadge mode={c.execution_mode} />
        </td>
        <td className="py-1.5 pr-3">
          <span className="flex items-center justify-end gap-1.5">
            {updated && (
              <Badge tone="amber" title={`Label changed after promotion (gold ${c.existing_gold_id}); re-promote to update`}>
                changed
              </Badge>
            )}
            {!saved && <TextInput ariaLabel="Promoted by" className="w-32" value={author} onChange={setAuthor} placeholder="Your name" />}
            <Button onClick={promote} disabled={busy || blocked !== null} title={blocked ?? undefined}>
              {busy ? "Promoting…" : updated ? "Re-promote" : "Promote"}
            </Button>
            <ExpandToggle open={open} onClick={() => setOpen((o) => !o)} label="Review before promoting" />
          </span>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-4 pb-2 text-right">
            <ErrorText error={error} />
          </td>
        </tr>
      )}
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={7} className="px-4 pb-3 pt-1">
            <DetailRow label="Labelled">
              <span className="flex flex-wrap items-center gap-1.5">
                {a.reviewer} · {fmtDateTime(a.updated_at)}
                <SeverityBadge severity={a.severity} />
                <UnsupportedLabelBadge label={a.unsupported_justification_label} />
              </span>
            </DetailRow>
            {a.first_failure && <DetailRow label="First failure">“{a.first_failure.description}”</DetailRow>}
            {a.open_coding_notes.trim() && (
              <DetailRow label="Notes">
                <p className="whitespace-pre-wrap">{a.open_coding_notes}</p>
              </DetailRow>
            )}
            <DetailRow label="Expected">
              {c.expected_behavior_error ? (
                <span className="text-rose-700">Couldn&apos;t derive expected behaviour: {c.expected_behavior_error}</span>
              ) : (
                <div className="space-y-1">
                  <TextArea value={expected} onChange={setExpected} rows={6} mono />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span title="Derived from the synthetic policy rules — not written by Claude">Preview from policy rules · edit if needed</span>
                    {edited && (
                      <>
                        <Badge tone="blue">edited</Badge>
                        <button type="button" className="text-sky-700 underline" onClick={() => setExpected(preview)}>
                          reset
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </DetailRow>
            <DetailRow label="Policies">
              {c.expected_behavior?.reference_policy_ids.length ? (
                c.expected_behavior.reference_policy_ids.join(", ")
              ) : (
                <span className="text-slate-400">none effective on the decision date</span>
              )}
            </DetailRow>
            <DetailRow label="Promoted by">
              <TextInput ariaLabel="Promoted by" className="max-w-xs" value={author} onChange={setAuthor} placeholder="Your name (required)" />
            </DetailRow>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function PromotionQueue({
  candidates,
  names,
  reload,
}: {
  candidates: GoldCandidate[];
  names: Record<string, string>;
  reload: () => void;
}) {
  const traceCounts = new Map<string, number>();
  for (const c of candidates) traceCounts.set(c.trace_id, (traceCounts.get(c.trace_id) ?? 0) + 1);
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
        {candidates.map((c) => (
          <CandidateRow
            key={c.annotation.annotation_id}
            c={c}
            names={names}
            sameTraceCount={traceCounts.get(c.trace_id) ?? 1}
            reload={reload}
          />
        ))}
      </tbody>
    </table>
  );
}
