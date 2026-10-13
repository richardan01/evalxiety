"use client";

/**
 * Small client-side form helpers shared by the taxonomy and gold screens
 * (lives here because src/components is read-only for this area).
 */
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { getReviewer, setReviewer } from "@/lib/client/api";
import { Button, cx } from "@/components/ui";

// ---------------------------------------------------------------------------
// Reviewer identity (localStorage via src/lib/client/api.ts)
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** The named human acting in this browser. "" until set. */
export function useReviewer(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribe, getReviewer, () => "");
  const update = useCallback((next: string) => {
    setReviewer(next);
    listeners.forEach((l) => l());
  }, []);
  return [name, update];
}

/** "Acting as" bar. Every mutation on these screens records this name. */
export function ReviewerBar({ purpose }: { purpose: string }) {
  const [reviewer, saveReviewer] = useReviewer();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? reviewer;
  const dirty = draft !== null && draft.trim() !== reviewer;
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-sm",
        reviewer ? "border-slate-200 bg-white" : "border-amber-300 bg-amber-50",
      )}
    >
      <label htmlFor="reviewer-name" className="font-medium text-slate-700">
        Your name
      </label>
      <input
        id="reviewer-name"
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. Dana (pricing reviewer)"
        className="w-64 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
      />
      <Button
        variant="secondary"
        disabled={!dirty || !value.trim()}
        onClick={() => {
          saveReviewer(value);
          setDraft(null);
        }}
      >
        Save name
      </Button>
      <span className="text-xs text-slate-500">
        {reviewer ? (
          <>
            Acting as <b className="text-slate-800">{reviewer}</b>. {purpose}
          </>
        ) : (
          <>A named human is required before you can change anything here. {purpose}</>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const inputCls = "w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} className={inputCls} />
  );
}

export function TextArea(props: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  return (
    <textarea
      value={props.value}
      rows={props.rows ?? 3}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className={cx(inputCls, props.mono && "font-mono text-xs leading-relaxed")}
    />
  );
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
}) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)} className={inputCls}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-sm text-rose-700">{error}</p>;
}

/**
 * Author + change-note fields for an audited change. Author is prefilled with
 * the saved reviewer name; editing it here does not change the saved name
 * unless no name has been saved yet.
 */
export function useAuthor(): {
  author: string;
  setAuthor: (v: string) => void;
  remember: () => void;
} {
  const [reviewer, saveReviewer] = useReviewer();
  const [draft, setDraft] = useState<string | null>(null);
  const author = draft ?? reviewer;
  return {
    author,
    setAuthor: setDraft,
    remember: () => {
      if (!reviewer && author.trim()) saveReviewer(author);
    },
  };
}

export function ChangeForm({
  title,
  help,
  children,
  submitLabel,
  submitVariant = "primary",
  onSubmit,
  onCancel,
  requireNote = true,
}: {
  title: string;
  help?: ReactNode;
  children?: ReactNode;
  submitLabel: string;
  submitVariant?: "primary" | "danger";
  /** Return an error message, or null on success. */
  onSubmit: (ctx: { author: string; note: string }) => Promise<string | null>;
  onCancel: () => void;
  requireNote?: boolean;
}) {
  const { author, setAuthor, remember } = useAuthor();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = !author.trim() ? "Enter your name" : requireNote && !note.trim() ? "Enter a change note" : null;
  return (
    <div className="space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      {help && <div className="text-xs text-slate-600">{help}</div>}
      {children}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <Field label="Author (named human)">
          <TextInput value={author} onChange={setAuthor} placeholder="Your name" />
        </Field>
        {requireNote && (
          <Field label="Change note (why?)">
            <TextInput value={note} onChange={setNote} placeholder="e.g. Three reviewer notes describe the same root cause" />
          </Field>
        )}
      </div>
      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button
          variant={submitVariant}
          disabled={busy || missing !== null}
          title={missing ?? undefined}
          onClick={async () => {
            setBusy(true);
            setError(null);
            remember();
            const err = await onSubmit({ author: author.trim(), note: note.trim() });
            setBusy(false);
            if (err) setError(err);
          }}
        >
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {missing && <span className="text-xs text-slate-500">{missing} to continue.</span>}
      </div>
    </div>
  );
}

/** Run an async call and turn a thrown Error into a message. */
export async function attempt(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
