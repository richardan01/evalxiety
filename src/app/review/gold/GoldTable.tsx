"use client";

import Link from "next/link";
import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import type { GoldExample } from "@/lib/domain/schemas";
import { Badge, Button, JsonDetails, MockBadge, SplitBadge, fmtDateTime } from "@/components/ui";
import { ErrorText, TextInput, attempt, useAuthor } from "../taxonomy/_shared/forms";
import { HumanLabelBadge, ModeNames, UnsupportedLabelBadge } from "./labels";
import type { GoldPostRequest } from "./types";

function Expandable({ summary, text }: { summary: string; text: string }) {
  return (
    <details className="max-w-xs">
      <summary className="cursor-pointer select-none text-xs text-sky-700">{summary}</summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-xs leading-relaxed text-slate-800">
        {text || "—"}
      </pre>
    </details>
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
        Remove…
      </Button>
    );
  }
  return (
    <div className="w-56 space-y-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-950">
      <p>Remove this example from the gold dataset? The trace and the human annotation are kept; the removal is audited.</p>
      <TextInput value={author} onChange={setAuthor} placeholder="Your name (required)" />
      <ErrorText error={error} />
      <div className="flex gap-1">
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
      </div>
    </div>
  );
}

export function GoldTable({ gold, names, reload }: { gold: GoldExample[]; names: Record<string, string>; reload: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1400px] text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Case</th>
            <th className="pr-3">Trace</th>
            <th className="pr-3">Split</th>
            <th className="pr-3">Trace mode</th>
            <th className="pr-3">Human pass/fail</th>
            <th className="pr-3">Failure modes</th>
            <th className="pr-3">Unsupported-justification label</th>
            <th className="pr-3">Reference policies</th>
            <th className="pr-3">Applicable objective rules</th>
            <th className="pr-3">Expected behaviour</th>
            <th className="pr-3">Supporting evidence</th>
            <th className="pr-3">Reviewer</th>
            <th className="pr-3">Reviewed at</th>
            <th className="pr-3">Label v</th>
            <th className="pr-3">Promoted by / at</th>
            <th className="pr-3">Record</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {gold.map((g) => (
            <tr key={g.gold_id} className="border-b border-slate-100 align-top">
              <td className="py-2 pr-3 font-medium text-slate-900">{g.case_id}</td>
              <td className="pr-3">
                <Link href={`/review/${g.trace_id}`} className="font-mono text-sky-700 hover:underline">
                  {g.trace_id}
                </Link>
              </td>
              <td className="pr-3">
                <SplitBadge split={g.dataset_split} />
              </td>
              <td className="pr-3">
                <MockBadge mode={g.trace_execution_mode} />
              </td>
              <td className="pr-3">
                <HumanLabelBadge label={g.human_label} />
              </td>
              <td className="pr-3">
                <ModeNames ids={g.failure_mode_ids} names={names} />
              </td>
              <td className="pr-3">
                <UnsupportedLabelBadge label={g.unsupported_justification_label} />
              </td>
              <td className="pr-3">
                {g.reference_policy_ids.length ? (
                  g.reference_policy_ids.map((p) => (
                    <code key={p} className="block font-mono">
                      {p}
                    </code>
                  ))
                ) : (
                  <span className="text-slate-500">none</span>
                )}
              </td>
              <td className="pr-3">
                {g.applicable_objective_rules.map((r) => (
                  <code key={r} className="block font-mono text-[11px] text-slate-700">
                    {r}
                  </code>
                ))}
              </td>
              <td className="pr-3">
                <Expandable summary="Show expected behaviour" text={g.expected_behavior} />
              </td>
              <td className="pr-3">
                <Expandable summary="Show reviewer evidence" text={g.supporting_evidence} />
              </td>
              <td className="pr-3">
                {g.reviewer} <Badge title="label_source">{g.label_source}</Badge>
              </td>
              <td className="pr-3 whitespace-nowrap text-slate-600">{fmtDateTime(g.review_timestamp)}</td>
              <td className="pr-3 tabular-nums">v{g.label_version}</td>
              <td className="pr-3 text-slate-600">
                <div className="text-slate-900">{g.promoted_by}</div>
                <div className="whitespace-nowrap">{fmtDateTime(g.promoted_at)}</div>
              </td>
              <td className="pr-3">
                <div className="space-y-1">
                  <div className="font-mono text-[10px] text-slate-500" title="gold_id">
                    {g.gold_id}
                  </div>
                  <div className="font-mono text-[10px] text-slate-500" title="annotation_id">
                    {g.annotation_id}
                  </div>
                  <JsonDetails summary="Input scenario" value={g.input_scenario} />
                </div>
              </td>
              <td>
                <RemoveControl g={g} reload={reload} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
