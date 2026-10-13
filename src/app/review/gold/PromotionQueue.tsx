"use client";

import Link from "next/link";
import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import { Badge, Button, Callout, MockBadge, SeverityBadge, SplitBadge, fmtDateTime } from "@/components/ui";
import { ErrorText, Field, TextArea, TextInput, attempt, useAuthor } from "../taxonomy/_shared/forms";
import { HumanLabelBadge, ModeNames, UnsupportedLabelBadge } from "./labels";
import type { GoldCandidate, GoldPostRequest } from "./types";

export function CandidateCard({
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
  const [expected, setExpected] = useState(preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { author, setAuthor, remember } = useAuthor();
  const firstId = a.first_failure?.failure_mode_id ?? null;
  const modeIds = [...new Set([firstId, ...a.additional_failure_mode_ids].filter((x): x is string => Boolean(x)))];
  const edited = expected.trim() !== preview.trim();

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
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <Badge tone="slate">case {c.case_id}</Badge>
        <SplitBadge split={c.split} />
        <MockBadge mode={c.execution_mode} />
        <Link href={`/review/${c.trace_id}`} className="font-mono text-sky-700 hover:underline">
          {c.trace_id}
        </Link>
        <span>
          · reviewed by <b className="text-slate-800">{a.reviewer}</b> · {fmtDateTime(a.updated_at)}
        </span>
        {c.reason === "annotation_updated_since_promotion" ? (
          <Badge tone="amber" title={`Gold ${c.existing_gold_id} was promoted from an earlier version of this annotation`}>
            annotation changed since promotion — re-promote to update gold
          </Badge>
        ) : (
          <Badge tone="neutral">not yet gold</Badge>
        )}
      </div>

      {sameTraceCount > 1 && (
        <p className="mt-2 text-xs text-amber-800">
          {sameTraceCount} reviewers labelled this trace. Only one annotation per trace becomes gold; once one is promoted the others leave
          this queue.
        </p>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">What the human reviewer recorded</div>
          <div className="flex flex-wrap items-center gap-2">
            <HumanLabelBadge label={a.task_outcome} />
            <SeverityBadge severity={a.severity} />
            <UnsupportedLabelBadge label={a.unsupported_justification_label} />
          </div>
          <div>
            <div className="text-xs text-slate-500">Failure modes</div>
            <ModeNames ids={modeIds} names={names} firstId={firstId} />
            {a.first_failure && !firstId && (
              <p className="mt-1 text-xs text-amber-800">
                The first failure has no category yet, so this gold example would carry no failure mode for it.{" "}
                <Link href="/review/taxonomy" className="underline">
                  Categorise it first
                </Link>
                .
              </p>
            )}
          </div>
          {a.first_failure && (
            <div>
              <div className="text-xs text-slate-500">First failure</div>
              <blockquote className="border-l-4 border-rose-300 bg-rose-50/60 px-3 py-1.5 text-sm">{a.first_failure.description}</blockquote>
            </div>
          )}
          {a.open_coding_notes.trim() && (
            <div>
              <div className="text-xs text-slate-500">Notes</div>
              <p className="whitespace-pre-wrap text-sm text-slate-800">{a.open_coding_notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expected behaviour (stored with the gold example)</div>
          {c.expected_behavior_error ? (
            <Callout tone="red" title="Expected behaviour could not be derived">
              {c.expected_behavior_error}
            </Callout>
          ) : (
            <>
              <TextArea value={expected} onChange={setExpected} rows={7} mono />
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>
                  Preview derived from the synthetic policy rules (not written by Claude). Edit it if a correct response needs something
                  different.
                </span>
                {edited && (
                  <>
                    <Badge tone="blue">edited</Badge>
                    <button type="button" className="text-sky-700 underline" onClick={() => setExpected(preview)}>
                      reset to preview
                    </button>
                  </>
                )}
              </div>
              <div className="text-xs text-slate-600">
                Reference policies:{" "}
                {c.expected_behavior?.reference_policy_ids.length ? (
                  c.expected_behavior.reference_policy_ids.map((p) => (
                    <code key={p} className="mr-1 font-mono">
                      {p}
                    </code>
                  ))
                ) : (
                  <span className="text-slate-500">none effective on the decision date</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {c.split === "heldout" && (
        <p className="mt-3 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-900">
          Held-out case: once promoted it is reserved for the final check. Do not read it while tuning the agent prompt or the judge.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <div className="w-64">
          <Field label="Promoted by (named human)">
            <TextInput value={author} onChange={setAuthor} placeholder="Your name" />
          </Field>
        </div>
        <Button
          onClick={promote}
          disabled={busy || !author.trim() || Boolean(c.expected_behavior_error) || (edited && !expected.trim())}
          title={!author.trim() ? "Enter your name first" : undefined}
        >
          {busy ? "Promoting…" : c.reason === "annotation_updated_since_promotion" ? "Re-promote to gold" : "Promote to gold"}
        </Button>
        {!author.trim() && <span className="text-xs text-slate-500">A named human must promote every gold example.</span>}
      </div>
      <div className="mt-2">
        <ErrorText error={error} />
      </div>
    </li>
  );
}
