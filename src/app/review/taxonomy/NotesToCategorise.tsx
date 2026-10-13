"use client";

import Link from "next/link";
import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import type { Annotation, ExecutionMode, FailureMode, Severity } from "@/lib/domain/schemas";
import { Badge, Button, MockBadge } from "@/components/ui";
import { resolveModeId } from "@/lib/taxonomy/ops";
import { ChangeForm, ErrorText, Field, Select, TextArea, TextInput, attempt, useAuthor } from "./_shared/forms";
import type { CategorizeRequest, TaxonomyOp, TaxonomyPostResponse } from "./types";

const SEVERITIES: Severity[] = ["critical", "major", "minor"];
const NEW_TYPE = "__new";

/** One reviewer note on one line: case, the reviewer's words, and an Assign select. */
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
  const [showExtra, setShowExtra] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Show the name field based on the SAVED name, not the live draft — otherwise it unmounts after one keystroke.
  const { author, saved, setAuthor, remember } = useAuthor();

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
  const words = note.first_failure?.description ?? "";
  const tooltip = [words, note.open_coding_notes.trim()].filter(Boolean).join("\n\n");

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/review/${note.trace_id}`} className="w-10 text-sm font-semibold text-slate-900 hover:underline" title={note.trace_id}>
          {note.case_id}
        </Link>
        {traceMode ? <MockBadge mode={traceMode} /> : <Badge tone="red" title="Trace file not found">missing</Badge>}
        <span className="min-w-0 flex-1 truncate text-sm text-slate-800" title={tooltip}>
          {words ? `“${words}”` : <span className="text-slate-400">no first failure recorded</span>}
        </span>
        <span className="text-xs text-slate-400">{note.reviewer}</span>
        <Select
          ariaLabel="Failure type"
          className="w-56"
          value={choice}
          onChange={(v) => (v === NEW_TYPE ? setCreating(true) : setChoice(v))}
          options={[
            { value: "", label: "— pick a type —" },
            ...assignable.map((m) => ({ value: m.failure_mode_id, label: m.name })),
            { value: NEW_TYPE, label: "+ New type from this note" },
          ]}
        />
        {!saved && <TextInput ariaLabel="Your name" className="w-32" value={author} onChange={setAuthor} placeholder="Your name" />}
        <Button
          onClick={assign}
          disabled={busy || unchanged || !author.trim()}
          title={!author.trim() ? "Enter your name first" : unchanged ? "Nothing changed" : undefined}
        >
          {busy ? "Saving…" : current ? "Re-assign" : "Assign"}
        </Button>
        <button
          type="button"
          aria-expanded={showExtra}
          onClick={() => setShowExtra((s) => !s)}
          className="text-xs text-slate-500 hover:text-slate-800"
          title="Other failure types also present in this trace"
        >
          + also{extra.length ? ` (${extra.length})` : ""}
        </button>
      </div>

      {showExtra && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-12">
          {assignable
            .filter((m) => m.failure_mode_id !== choice)
            .map((m) => (
              <label key={m.failure_mode_id} className="flex items-center gap-1.5 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={extra.includes(m.failure_mode_id)}
                  onChange={(e) =>
                    setExtra((xs) => (e.target.checked ? [...xs, m.failure_mode_id] : xs.filter((x) => x !== m.failure_mode_id)))
                  }
                />
                {m.name}
              </label>
            ))}
        </div>
      )}
      <div className="pl-12">
        <ErrorText error={error} />
      </div>
      {creating && (
        <div className="mt-2 pl-12">
          <CreateFromNote note={note} onDone={reload} onCancel={() => setCreating(false)} categorize={categorize} extra={extra} />
        </div>
      )}
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
      title="New failure type from this note"
      help="Generalise the definition so it applies to other traces."
      submitLabel="Create & assign"
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
        return err2 ? `Type created, but assigning the note failed: ${err2}` : null;
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label="Name">
          <TextInput value={name} onChange={setName} placeholder="e.g. Cites competitor claim as fact" />
        </Field>
        <Field label="Severity">
          <Select value={severity} onChange={setSeverity} options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
        </Field>
      </div>
      <Field label="Definition (one sentence)">
        <TextArea value={definition} onChange={setDefinition} rows={2} />
      </Field>
    </ChangeForm>
  );
}
