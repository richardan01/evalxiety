"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getJSON, postJSON } from "@/lib/client/api";
import type { Severity } from "@/lib/domain/schemas";
import { Badge, Button, InfoTip, MockBadge, PageHeader, fmtDateTime } from "@/components/ui";
import { ChangeForm, Field, Select, TextArea, TextInput } from "./_shared/forms";
import { FailureModeCard } from "./FailureModeCard";
import { NoteRow } from "./NotesToCategorise";
import { assignableModes, categorisedNotes, firstFailureTraces, modeSplit, uncategorisedNotes } from "./derive";
import type { TaxonomyApiResponse, TaxonomyOp } from "./types";

const SEVERITIES: Severity[] = ["critical", "major", "minor"];

const INFO = (
  <>
    Reviewers first describe what went wrong in their own words (open coding). Here those notes are grouped into failure types
    (axial coding). The starting types are hypotheses written before any trace was read. Counts come only from human labels —
    never from automated checks or the AI judge — and each trace counts once per type.
  </>
);

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{children}</h2>;
}

export function TaxonomyWorkbench() {
  const [data, setData] = useState<TaxonomyApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    getJSON<TaxonomyApiResponse>("/api/taxonomy")
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [tick]);

  const derived = useMemo(() => {
    if (!data) return null;
    const modes = data.failure_modes;
    const freqOf = (id: string) => data.frequencies.find((f) => f.failure_mode_id === id);
    const count = (id: string) => freqOf(id)?.any_count ?? 0;
    const active = modes
      .filter((m) => m.status !== "merged" && m.status !== "retired")
      // Seen most often first; unseen types (greyed "not seen yet") last, in their original order.
      .map((m, i) => ({ m, i }))
      .sort((a, b) => count(b.m.failure_mode_id) - count(a.m.failure_mode_id) || a.i - b.i)
      .map(({ m }) => m);
    const reviewedIds = [...new Set(data.annotations.map((a) => a.trace_id))];
    return {
      modes,
      freqOf,
      assignable: assignableModes(modes),
      active,
      inactive: modes.filter((m) => m.status === "merged" || m.status === "retired"),
      uncategorised: uncategorisedNotes(data.annotations),
      categorised: categorisedNotes(data.annotations),
      firstTraces: firstFailureTraces(modes, data.annotations),
      reviewedMix: modeSplit(reviewedIds, data.trace_modes),
      traceCases: Object.fromEntries(data.annotations.map((a) => [a.trace_id, a.case_id])),
    };
  }, [data]);

  if (!data || !derived) {
    return (
      <div>
        <PageHeader title="Failure types" question="What kinds of mistakes did reviewers actually see?" info={INFO} />
        {error ? (
          <p className="text-sm text-rose-700">Couldn&apos;t load failure types: {error}</p>
        ) : (
          <p className="text-sm text-slate-500">Loading failure types…</p>
        )}
      </div>
    );
  }

  const reviewed = data.reviewed_trace_count;
  const card = (m: (typeof derived.modes)[number]) => (
    <FailureModeCard
      key={m.failure_mode_id}
      mode={m}
      modes={derived.modes}
      freq={derived.freqOf(m.failure_mode_id)}
      firstFailureTraceIds={derived.firstTraces.get(m.failure_mode_id) ?? []}
      reviewed={reviewed}
      traceModes={data.trace_modes}
      traceCases={derived.traceCases}
      evaluators={data.evaluator_options}
      reload={reload}
    />
  );
  const noteRow = (a: (typeof derived.uncategorised)[number]) => (
    <NoteRow
      key={a.annotation_id}
      note={a}
      modes={derived.modes}
      assignable={derived.assignable}
      traceMode={data.trace_modes[a.trace_id]}
      reload={reload}
    />
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Failure types"
        question="What kinds of mistakes did reviewers actually see?"
        info={INFO}
        action={
          !adding && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              + Add type
            </Button>
          )
        }
      />
      {error && <p className="text-xs text-rose-700">Refresh failed — showing the last loaded data: {error}</p>}

      {adding && (
        <AddCategoryForm
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <SectionLabel>
            Out of {reviewed} human-reviewed trace{reviewed === 1 ? "" : "s"}
          </SectionLabel>
          {derived.reviewedMix.live > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
              <MockBadge mode="live" /> {derived.reviewedMix.live}
            </span>
          )}
          {derived.reviewedMix.mock > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-slate-500" title="Failures seen on mock traces describe the mock agent, not Claude">
              <MockBadge mode="mock" /> {derived.reviewedMix.mock}
            </span>
          )}
          {reviewed === 0 && (
            <span className="text-xs text-slate-500">
              · nothing reviewed yet —{" "}
              <Link href="/review" className="text-sky-700 hover:underline">
                start reviewing
              </Link>
            </span>
          )}
        </div>
        <ul className="mt-1 divide-y divide-slate-100">{derived.active.map(card)}</ul>
        {derived.active.length === 0 && <p className="py-2 text-sm text-slate-500">No active types. Add one.</p>}
      </section>

      {derived.uncategorised.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <SectionLabel>Notes without a type ({derived.uncategorised.length})</SectionLabel>
            <InfoTip>Failed traces whose first failure has no type yet. They are not counted above until you assign one.</InfoTip>
          </div>
          <ul className="mt-1 divide-y divide-slate-100">{derived.uncategorised.map(noteRow)}</ul>
        </section>
      )}

      <div className="space-y-2">
        {derived.categorised.length > 0 && (
          <Collapsible summary={`Re-assign typed notes (${derived.categorised.length})`}>
            <ul className="divide-y divide-slate-100">{derived.categorised.map(noteRow)}</ul>
          </Collapsible>
        )}
        {derived.inactive.length > 0 && (
          <Collapsible summary={`Merged & retired (${derived.inactive.length})`}>
            <ul className="divide-y divide-slate-100">{derived.inactive.map(card)}</ul>
          </Collapsible>
        )}
        <Collapsible summary={`History · v${data.version} (${data.versions.length} version${data.versions.length === 1 ? "" : "s"})`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3">Version</th>
                <th className="pr-3">Date</th>
                <th className="pr-3">Author</th>
                <th className="pr-3">Why</th>
                <th className="text-right">Types</th>
              </tr>
            </thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={v.version} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">v{v.version}</span>{" "}
                    {v.version === data.version && <Badge tone="green">current</Badge>}
                  </td>
                  <td className="pr-3 text-xs text-slate-600">{fmtDateTime(v.created_at)}</td>
                  <td className="pr-3">{v.author}</td>
                  <td className="pr-3 text-slate-700">{v.change_note}</td>
                  <td className="text-right tabular-nums">{v.mode_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Collapsible>
      </div>
    </div>
  );
}

function Collapsible({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-2 text-sm text-slate-600 hover:text-slate-900">{summary}</summary>
      <div className="border-t border-slate-100 px-4 py-2">{children}</div>
    </details>
  );
}

function AddCategoryForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [severity, setSeverity] = useState<Severity>("major");
  return (
    <ChangeForm
      title="New failure type"
      help="Starts at 0 — it only counts once a reviewer's note is assigned to it."
      submitLabel="Add type"
      onCancel={onCancel}
      onSubmit={async ({ author, note }) => {
        if (!name.trim() || !definition.trim()) return "Name and definition are required";
        try {
          const op: TaxonomyOp = { type: "add", name, definition, severity };
          await postJSON("/api/taxonomy", { author, change_note: note, op });
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
        onDone();
        return null;
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label="Name">
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label="Severity">
          <Select value={severity} onChange={setSeverity} options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
        </Field>
      </div>
      <Field label="Definition (one observable sentence)">
        <TextArea value={definition} onChange={setDefinition} rows={2} />
      </Field>
    </ChangeForm>
  );
}
