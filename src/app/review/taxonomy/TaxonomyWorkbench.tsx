"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getJSON, postJSON } from "@/lib/client/api";
import type { Severity } from "@/lib/domain/schemas";
import { Badge, Button, Callout, Card, EmptyState, MockBadge, Stat, fmtDateTime } from "@/components/ui";
import { ChangeForm, Field, ReviewerBar, Select, TextArea, TextInput } from "./_shared/forms";
import { FailureModeCard } from "./FailureModeCard";
import { FrequencyTable } from "./FrequencyTable";
import { NoteRow } from "./NotesToCategorise";
import {
  assignableModes,
  categorisedNotes,
  firstFailureTraces,
  frequencyRows,
  modeSplit,
  uncategorisedNotes,
} from "./derive";
import type { TaxonomyApiResponse, TaxonomyOp } from "./types";

const SEVERITIES: Severity[] = ["critical", "major", "minor"];

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{n}</span>
      {children}
    </span>
  );
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
    const uncategorised = uncategorisedNotes(data.annotations);
    const reviewedIds = [...new Set(data.annotations.map((a) => a.trace_id))];
    return {
      modes,
      assignable: assignableModes(modes),
      active: modes.filter((m) => m.status !== "merged" && m.status !== "retired"),
      inactive: modes.filter((m) => m.status === "merged" || m.status === "retired"),
      uncategorised,
      uncategorisedTraces: new Set(uncategorised.map((a) => a.trace_id)).size,
      categorised: categorisedNotes(data.annotations),
      firstTraces: firstFailureTraces(modes, data.annotations),
      rows: frequencyRows(modes, data.frequencies, data.reviewed_trace_count),
      reviewedMix: modeSplit(reviewedIds, data.trace_modes),
      traceCases: Object.fromEntries(data.annotations.map((a) => [a.trace_id, a.case_id])),
    };
  }, [data]);

  if (error && !data) {
    return (
      <Callout tone="red" title="Could not load the failure taxonomy">
        {error}
      </Callout>
    );
  }
  if (!data || !derived) return <p className="text-sm text-slate-500">Loading failure taxonomy…</p>;

  const reviewed = data.reviewed_trace_count;
  const observedActive = derived.active.filter((m) => m.status === "observed").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Failure taxonomy — axial coding</h1>
          <p className="text-sm text-slate-600">
            Group reviewers&apos; first-failure notes into a small set of named failure categories, then count how often each was observed.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>
            <Badge tone="slate">taxonomy v{data.version}</Badge> by {data.author} · {fmtDateTime(data.created_at)}
          </div>
          <div className="mt-0.5 max-w-md truncate" title={data.change_note}>
            “{data.change_note}”
          </div>
        </div>
      </div>

      {error && (
        <Callout tone="red" title="Refresh failed — showing the last loaded data">
          {error}
        </Callout>
      )}

      <Callout tone="blue" title="How this works">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <b>Open coding comes first</b> (in <Link href="/review" className="text-sky-700 underline">Queue &amp; traces</Link>): a
            named reviewer reads one trace, marks it pass or fail, and describes the <i>first</i> thing that went wrong in their own words.
            No categories are needed for that.
          </li>
          <li>
            <b>Axial coding happens here:</b> read those notes and group them into categories — assign each note, create a category when
            none fits, merge duplicates, retire categories that never show up. Every change is saved as a new taxonomy version with an
            author and a reason.
          </li>
          <li>
            <b>Counts come only from human-reviewed traces.</b> Deterministic evaluators and the LLM judge never add to these numbers.
          </li>
        </ol>
      </Callout>

      <Callout tone="amber" title="v1 categories are provisional hypotheses, not observed failures">
        The categories marked <b>seed hypothesis</b> were written from the project brief before any trace was read. They describe what
        <i> might</i> go wrong. A category is labelled <b>OBSERVED</b> only after a human reviewer tags it on a reviewed trace; until then it
        shows “0 observed — hypothesis”.
      </Callout>

      <ReviewerBar purpose="Taxonomy changes and note assignments are recorded under this name in the audit log." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Human-reviewed traces"
          value={reviewed}
          hint={
            <span className="inline-flex flex-wrap items-center gap-1">
              Denominator for every count on this page.
              {derived.reviewedMix.live > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MockBadge mode="live" /> {derived.reviewedMix.live}
                </span>
              )}
              {derived.reviewedMix.mock > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MockBadge mode="mock" /> {derived.reviewedMix.mock}
                </span>
              )}
            </span>
          }
        />
        <Stat
          label="Notes waiting for a category"
          value={derived.uncategorised.length}
          tone={derived.uncategorised.length > 0 ? "amber" : undefined}
          hint="Failed-trace notes whose first failure has no category yet (Step 1)."
        />
        <Stat
          label="Active categories observed"
          value={`${observedActive} of ${derived.active.length}`}
          hint="Tagged on at least one human-reviewed trace. The rest are still hypotheses."
        />
        <Stat
          label="Taxonomy version"
          value={`v${data.version}`}
          hint={`${data.versions.length} version${data.versions.length === 1 ? "" : "s"} — every change creates a new one.`}
        />
      </div>

      {derived.reviewedMix.mock > 0 && (
        <Callout tone="amber" title="Some reviewed traces are MOCK executions">
          {derived.reviewedMix.mock} of the {reviewed} human-reviewed traces were produced by the deterministic mock agent. Failures observed
          on them describe the mock, not Claude. Each count below shows how many of its traces are LIVE vs MOCK.
        </Callout>
      )}

      <Card
        title={<StepTitle n={1}>Categorise reviewer notes</StepTitle>}
        subtitle="Every human annotation whose first failure has no category yet. Pick the category that best fits, or create one from the note."
      >
        {reviewed === 0 ? (
          <EmptyState title="No human-reviewed traces yet">
            Notes appear here after a named reviewer labels a trace in{" "}
            <Link href="/review" className="text-sky-700 underline">
              Queue &amp; traces
            </Link>{" "}
            and describes its first failure.
          </EmptyState>
        ) : derived.uncategorised.length === 0 ? (
          <EmptyState title="No notes waiting for a category">
            Every recorded first failure has a category. New notes appear here when a reviewer marks a trace as failed and describes the first
            failure.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {derived.uncategorised.map((a) => (
              <NoteRow
                key={a.annotation_id}
                note={a}
                modes={derived.modes}
                assignable={derived.assignable}
                traceMode={data.trace_modes[a.trace_id]}
                reload={reload}
              />
            ))}
          </ul>
        )}
        {derived.categorised.length > 0 && (
          <details className="mt-3 rounded-md border border-slate-200">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm text-slate-700">
              Re-assign an already categorised note ({derived.categorised.length})
            </summary>
            <ul className="space-y-3 border-t border-slate-200 p-3">
              {derived.categorised.map((a) => (
                <NoteRow
                  key={a.annotation_id}
                  note={a}
                  modes={derived.modes}
                  assignable={derived.assignable}
                  traceMode={data.trace_modes[a.trace_id]}
                  reload={reload}
                />
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card
        title={<StepTitle n={2}>Refine the failure categories</StepTitle>}
        subtitle="Aim for a handful of distinct, actionable categories, each defined in one observable sentence. Every action asks for your name and a reason."
        actions={
          !adding && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add a category
            </Button>
          )
        }
      >
        {adding && (
          <div className="mb-4">
            <AddCategoryForm
              onCancel={() => setAdding(false)}
              onDone={() => {
                setAdding(false);
                reload();
              }}
            />
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          {derived.active.map((m) => (
            <FailureModeCard
              key={m.failure_mode_id}
              mode={m}
              modes={derived.modes}
              freq={data.frequencies.find((f) => f.failure_mode_id === m.failure_mode_id)}
              firstFailureTraceIds={derived.firstTraces.get(m.failure_mode_id) ?? []}
              reviewed={reviewed}
              traceModes={data.trace_modes}
              traceCases={derived.traceCases}
              evaluators={data.evaluator_options}
              reload={reload}
            />
          ))}
        </div>
        {derived.active.length === 0 && <EmptyState title="No active categories">Add a category, or create one from a reviewer note in Step 1.</EmptyState>}
        {derived.inactive.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer select-none text-sm text-slate-700">Merged and retired categories ({derived.inactive.length})</summary>
            <div className="mt-2 grid gap-3 lg:grid-cols-2">
              {derived.inactive.map((m) => (
                <FailureModeCard
                  key={m.failure_mode_id}
                  mode={m}
                  modes={derived.modes}
                  freq={data.frequencies.find((f) => f.failure_mode_id === m.failure_mode_id)}
                  firstFailureTraceIds={derived.firstTraces.get(m.failure_mode_id) ?? []}
                  reviewed={reviewed}
                  traceModes={data.trace_modes}
                  traceCases={derived.traceCases}
                  evaluators={data.evaluator_options}
                  reload={reload}
                />
              ))}
            </div>
          </details>
        )}
      </Card>

      <Card
        title={<StepTitle n={3}>How often each failure was observed</StepTitle>}
        subtitle={`Sorted by first-failure count. Every number is out of ${reviewed} human-reviewed trace${reviewed === 1 ? "" : "s"}.`}
      >
        {reviewed === 0 ? (
          <EmptyState title="No observations yet">
            Counts appear once a named reviewer labels traces in Queue &amp; traces and their notes are categorised in Step 1. Until then every
            category is an unobserved hypothesis.
          </EmptyState>
        ) : (
          <FrequencyTable
            rows={derived.rows}
            modes={derived.modes}
            reviewed={reviewed}
            uncategorisedTraces={derived.uncategorisedTraces}
            traceModes={data.trace_modes}
          />
        )}
      </Card>

      <Card title="Version history" subtitle="Each taxonomy change is a new, append-only version with its author and reason.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-1.5 pr-3">Version</th>
              <th className="pr-3">Date</th>
              <th className="pr-3">Author</th>
              <th className="pr-3">Change note</th>
              <th className="text-right">Categories</th>
            </tr>
          </thead>
          <tbody>
            {data.versions.map((v) => (
              <tr key={v.version} className="border-b border-slate-100 align-top">
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
      </Card>
    </div>
  );
}

function AddCategoryForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [severity, setSeverity] = useState<Severity>("major");
  return (
    <ChangeForm
      title="Add a failure category"
      help="Prefer creating categories from real reviewer notes (Step 1). A new category starts as PROVISIONAL and shows 0 observations until a note is assigned to it."
      submitLabel="Add category"
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
        <Field label="Category name">
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
