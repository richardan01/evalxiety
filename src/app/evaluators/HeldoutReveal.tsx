"use client";

import { useState } from "react";
import { getReviewer, setReviewer } from "@/lib/client/api";
import { Button, InfoTip } from "@/components/ui";
import type { HeldoutState } from "./types";

const MIN_REASON = 10;

/**
 * POST the audited reveal. A 409 means someone already revealed it (irreversible), so return the current
 * revealed state instead of failing — the caller then shows unlocked calibration and the revealed banner.
 */
export async function postReveal(actor: string, reason: string, fetcher: typeof fetch = fetch): Promise<HeldoutState> {
  const res = await fetcher("/api/heldout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: actor.trim(), reason: reason.trim() }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body as HeldoutState;
  if (res.status === 409) {
    const state = await fetcher("/api/heldout", { cache: "no-store" });
    if (state.ok) return (await state.json()) as HeldoutState;
  }
  const details = Array.isArray(body?.details) ? `: ${body.details.join("; ")}` : "";
  throw new Error((body?.error ?? `Reveal failed (${res.status})`) + details);
}

/** Locked held-out panel with an audited, irreversible reveal (actor + reason + explicit confirmation). */
export function HeldoutReveal({ onRevealed }: { onRevealed: (state: HeldoutState) => void }) {
  const [formOpen, setFormOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-violet-300 bg-violet-50/40 px-4 py-3">
        <LockIcon />
        <span className="text-sm text-slate-700">
          <b className="text-slate-900">Held-out is locked</b> — saved for one final check of the judge.
        </span>
        <InfoTip label="Why it is locked">
          Iterate on dev. Reveal held-out once, after the judge prompt is frozen: tuning after seeing it leaks the test set
          into the prompt and makes the final number meaningless. The reveal is audited (name, time, reason) and cannot be
          undone.
        </InfoTip>
        {!formOpen && (
          <span className="ml-auto">
            <Button variant="secondary" onClick={() => setFormOpen(true)}>
              Reveal held-out (final check)
            </Button>
          </span>
        )}
      </div>
      {formOpen && <RevealForm onCancel={() => setFormOpen(false)} onRevealed={onRevealed} />}
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
      onRevealed(await postReveal(actor, reason));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-lg border border-rose-200 bg-white px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <label className="block text-xs font-medium text-slate-600">
        Your name
        <input
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder="Full name (audit log)"
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Reason{" "}
        <span className={reasonLen >= MIN_REASON ? "text-emerald-700" : "text-slate-400"}>
          ({reasonLen}/{MIN_REASON} min)
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Judge prompt frozen after dev iteration"
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-800 sm:col-span-2">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        Audited and irreversible — I won&apos;t tune prompts after seeing held-out results.
      </label>
      {error && <div className="text-sm text-rose-700 sm:col-span-2">{error}</div>}
      <div className="flex gap-2 sm:col-span-2">
        <Button variant="danger" onClick={submit} disabled={!valid || busy}>
          {busy ? "Revealing…" : "Reveal (irreversible)"}
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
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-violet-700" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}
