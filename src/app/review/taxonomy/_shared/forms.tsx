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

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const inputCls = "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none";
export const labelCls = "mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-slate-400";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string; className?: string }) {
  return (
    <input
      value={props.value}
      aria-label={props.ariaLabel}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className={cx(inputCls, props.className ?? "w-full")}
    />
  );
}

export function TextArea(props: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  return (
    <textarea
      value={props.value}
      rows={props.rows ?? 3}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className={cx(inputCls, "w-full", props.mono && "font-mono text-xs leading-relaxed")}
    />
  );
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <select
      value={props.value}
      aria-label={props.ariaLabel}
      onChange={(e) => props.onChange(e.target.value as T)}
      className={cx(inputCls, props.className ?? "w-full")}
    >
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
  return <p className="text-xs text-rose-700">{error}</p>;
}

/**
 * Author for an audited change. Prefilled with the saved reviewer name; editing it here does not
 * change the saved name unless no name has been saved yet. `saved` is the committed name — use it
 * (not `author`) to decide whether to show a name field, so the field doesn't vanish mid-typing.
 */
export function useAuthor(): {
  author: string;
  saved: string;
  setAuthor: (v: string) => void;
  remember: () => void;
} {
  const [reviewer, saveReviewer] = useReviewer();
  const [draft, setDraft] = useState<string | null>(null);
  const author = draft ?? reviewer;
  return {
    author,
    saved: reviewer,
    setAuthor: setDraft,
    remember: () => {
      if (!reviewer && author.trim()) saveReviewer(author);
    },
  };
}

/** An audited change: optional fields, then the author's name and a one-line reason. */
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
  const missing = !author.trim() ? "Enter your name" : requireNote && !note.trim() ? "Say why" : null;
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      {help && <div className="text-xs text-slate-500">{help}</div>}
      {children}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <Field label="Your name">
          <TextInput value={author} onChange={setAuthor} placeholder="Required" />
        </Field>
        {requireNote && (
          <Field label="Why?">
            <TextInput value={note} onChange={setNote} placeholder="e.g. three notes describe the same cause" />
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
        {missing && <span className="text-xs text-slate-400">{missing}</span>}
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
