"use client";

import { useState } from "react";
import { getReviewer, postJSON, setReviewer } from "@/lib/client/api";
import { Button, Callout } from "@/components/ui";
import type { HeldoutState } from "./types";

const MIN_REASON = 10;

/** Locked held-out panel with an audited, irreversible reveal (actor + reason + explicit confirmation). */
export function HeldoutReveal({ onRevealed }: { onRevealed: (state: HeldoutState) => void }) {
  const [formOpen, setFormOpen] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border-2 border-dashed border-violet-300 bg-violet-50/40 px-5 py-5">
      <div className="flex items-start gap-3">
        <LockIcon />
        <div className="space-y-1 text-sm text-slate-700">
          <p className="text-base font-semibold text-slate-900">Held-out calibration is locked</p>
          <p>
            The held-out split is reserved for <b>one final check</b> of the judge after its prompt is frozen. Iterate on the
            dev split only. Looking at held-out results and then changing the judge prompt would leak the test set into the
            prompt and make the final number meaningless.
          </p>
        </div>
      </div>
      {formOpen ? (
        <RevealForm onCancel={() => setFormOpen(false)} onRevealed={onRevealed} />
      ) : (
        <Button variant="secondary" onClick={() => setFormOpen(true)}>
          Reveal held-out for FINAL check
        </Button>
      )}
    </div>
  );
}

function RevealForm({ onCancel, onRevealed }: { onCancel: () => void; onRevealed: (state: HeldoutState) => void }) {
  // Mounted only after a click, so reading localStorage here cannot cause a hydration mismatch.
  const [actor, setActor] = useState(() => getReviewer());
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonLen = reason.trim().length;
  const valid = actor.trim().length > 0 && reasonLen >= MIN_REASON && ack;

  const submit = async () => {
    if (!valid || busy) return;
    const confirmed = window.confirm(
      `Reveal the held-out split as "${actor.trim()}"?\n\nThis is audited and irreversible. Do not tune the judge prompt after seeing held-out results.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      setReviewer(actor);
      const state = await postJSON<HeldoutState>("/api/heldout", { actor: actor.trim(), reason: reason.trim() });
      onRevealed(state);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-4">
      <Callout tone="red" title="Audited and irreversible">
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Your name, the time and your reason are written to the audit log.</li>
          <li>The reveal cannot be undone: held-out calibration stays visible to everyone from now on.</li>
          <li>
            <b>Do not tune the judge prompt (or the agent prompts) after seeing held-out results.</b> Any change after this
            point needs a new, untouched held-out set before its numbers mean anything.
          </li>
        </ul>
      </Callout>
      <label className="block text-sm">
        <span className="font-medium text-slate-800">1. Your name</span>
        <span className="ml-2 text-xs text-slate-500">recorded in the audit log</span>
        <input
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder="Your full name"
          className="mt-1 block w-full max-w-sm rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-800">2. Why are you revealing it now?</span>
        <span className="ml-2 text-xs text-slate-500">
          at least {MIN_REASON} characters ({reasonLen}/{MIN_REASON})
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="e.g. Judge prompt is frozen after dev iteration; running the final held-out check."
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span>
          3. I understand this is audited and irreversible, and I will not tune prompts after seeing held-out results.
        </span>
      </label>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <Button variant="danger" onClick={submit} disabled={!valid || busy}>
          {busy ? "Revealing…" : "Reveal held-out (irreversible)"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 h-6 w-6 shrink-0 text-violet-700" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}
