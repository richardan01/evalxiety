"use client";

import Link from "next/link";
import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import type { Annotation, ExecutionMode, FailureMode, Severity } from "@/lib/domain/schemas";
import { Badge, Button, MockBadge, SeverityBadge, fmtDateTime } from "@/components/ui";
import { resolveModeId } from "@/lib/taxonomy/ops";
import { ChangeForm, ErrorText, Field, Select, TextArea, TextInput, attempt, useAuthor } from "./_shared/forms";
import type { CategorizeRequest, TaxonomyOp, TaxonomyPostResponse } from "./types";

const SEVERITIES: Severity[] = ["critical", "major", "minor"];

export function NoteRow({
  note,
  modes,
  assignable,
  traceMode,
  reload,
}: {
  note: Annotation;
  modes: FailureMode[];
  assignable: FailureMode[];
  traceMode: ExecutionMode | undefined;
  reload: () => void;
}) {
  const current = note.first_failure?.failure_mode_id ?? null;
  const currentResolved = current ? resolveModeId(modes, current) : null;
  const [choice, setChoice] = useState<string>(
    currentResolved && assignable.some((m) => m.failure_mode_id === currentResolved) ? currentResolved : "",
  );
  const [extra, setExtra] = useState<string[]>(note.additional_failure_mode_ids);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { author, setAuthor, remember } = useAuthor();
  const nameOf = (id: string) => modes.find((m) => m.failure_mode_id === id)?.name ?? id;

  const categorize = (actor: string, firstId: string | null, additional: string[]) =>
    postJSON("/api/annotations/categorize", {
      annotation_id: note.annotation_id,
      actor,
      first_failure_mode_id: firstId,
      additional_failure_mode_ids: additional.filter((id) => id !== firstId),
    } satisfies CategorizeRequest);

  const assign = async () => {
    setBusy(true);
    setError(null);
    remember();
    const err = await attempt(() => categorize(author.trim(), choice || null, extra));
    setBusy(false);
    if (err) setError(err);
    else reload();
  };

  const unchanged =
    (choice || null) === current &&
    extra.length === note.additional_failure_mode_ids.length &&
    extra.every((id) => note.additional_failure_mode_ids.includes(id));

  return (
    <li className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <Badge tone="slate">case {note.case_id}</Badge>
        {traceMode ? <MockBadge mode={traceMode} /> : <Badge tone="red" title="Trace file not found">trace missing</Badge>}
        <Link href={`/review/${note.trace_id}`} className="font-mono text-sky-700 hover:underline">
          {note.trace_id}
        </Link>
        <span>
          · reviewed by <b className="text-slate-800">{note.reviewer}</b> · {fmtDateTime(note.updated_at)}
        </span>
        <Badge tone={note.task_outcome === "pass" ? "green" : "red"}>task {note.task_outcome.toUpperCase()}</Badge>
        <SeverityBadge severity={note.severity} />
        {current && (
          <Badge tone="blue" title="Current category for the first failure">
            now: {nameOf(current)}
            {currentResolved !== current ? ` → ${nameOf(currentResolved!)}` : ""}
          </Badge>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-slate-500">First failure, in the reviewer&apos;s words</div>
        <blockquote className="mt-0.5 border-l-4 border-rose-300 bg-rose-50/60 px-3 py-1.5 text-sm text-slate-900">
          {note.first_failure?.description ?? <span className="text-slate-500">No first failure recorded</span>}
        </blockquote>
      </div>
      {note.open_coding_notes.trim() && (
        <div>
          <div className="text-xs font-medium text-slate-500">Open-coding notes</div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{note.open_coding_notes}</p>
        </div>
      )}

      {!creating && (
        <div className="space-y-2 rounded-md bg-slate-50 p-2">
          <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="Which category best describes this first failure?">
              <Select
                value={choice}
                onChange={setChoice}
                options={[
                  { value: "", label: "— not categorised yet —" },
                  ...assignable.map((m) => ({
                    value: m.failure_mode_id,
                    label: `${m.name}${m.status === "provisional" ? " (provisional hypothesis)" : ""}`,
                  })),
                ]}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={assign}
                disabled={busy || unchanged || !author.trim()}
                title={!author.trim() ? "Enter your name first" : unchanged ? "Nothing changed" : undefined}
              >
                {busy ? "Saving…" : current ? "Re-assign" : "Assign"}
              </Button>
              <Button variant="secondary" onClick={() => setCreating(true)} disabled={busy}>
                Create new category from this note
              </Button>
            </div>
          </div>
          <details>
            <summary className="cursor-pointer select-none text-xs text-slate-600">
              Other failures also present in this trace (optional{extra.length ? `, ${extra.length} selected` : ""})
            </summary>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {assignable
                .filter((m) => m.failure_mode_id !== choice)
                .map((m) => (
                  <label key={m.failure_mode_id} className="flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={extra.includes(m.failure_mode_id)}
                      onChange={(e) =>
                        setExtra((xs) =>
                          e.target.checked ? [...xs, m.failure_mode_id] : xs.filter((x) => x !== m.failure_mode_id),
                        )
                      }
                    />
                    {m.name}
                  </label>
                ))}
            </div>
          </details>
          {!author.trim() && (
            <div className="max-w-xs">
              <Field label="Your name (required to record this assignment)">
                <TextInput value={author} onChange={setAuthor} placeholder="Your name" />
              </Field>
            </div>
          )}
          <ErrorText error={error} />
        </div>
      )}

      {creating && <CreateFromNote note={note} onDone={reload} onCancel={() => setCreating(false)} categorize={categorize} extra={extra} />}
    </li>
  );
}

function CreateFromNote({
  note,
  extra,
  categorize,
  onDone,
  onCancel,
}: {
  note: Annotation;
  extra: string[];
  categorize: (actor: string, firstId: string | null, additional: string[]) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState(note.first_failure?.description ?? "");
  const [severity, setSeverity] = useState<Severity>(note.severity ?? "major");
  return (
    <ChangeForm
      title="Create a new category from this note, then assign the note to it"
      help={
        <>
          Write the definition as one observable sentence that another reviewer could apply to a different trace. The new
          category starts as <b>PROVISIONAL</b> and becomes <b>OBSERVED</b> once this note is assigned to it.
        </>
      }
      submitLabel="Create category & assign note"
      onCancel={onCancel}
      onSubmit={async ({ author, note: changeNote }) => {
        if (!name.trim() || !definition.trim()) return "Name and definition are required";
        let createdId: string | null = null;
        const err = await attempt(async () => {
          const op: TaxonomyOp = { type: "add", name, definition, severity };
          const res = await postJSON<TaxonomyPostResponse>("/api/taxonomy", { author, change_note: changeNote, op });
          createdId = res.failure_mode_id;
        });
        if (err) return err;
        const err2 = await attempt(() => categorize(author, createdId, extra));
        onDone();
        return err2 ? `Category created, but assigning the note failed: ${err2}` : null;
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label="Category name" hint="Short and specific, e.g. “Cites merchant's competitor claim as fact”">
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label="Severity">
          <Select value={severity} onChange={setSeverity} options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
        </Field>
      </div>
      <Field label="Definition (one sentence)" hint="Prefilled with the reviewer's first-failure description — generalise it.">
        <TextArea value={definition} onChange={setDefinition} rows={2} />
      </Field>
    </ChangeForm>
  );
}
