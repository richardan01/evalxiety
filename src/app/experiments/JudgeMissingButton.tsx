"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { apiRequest } from "./request";
import { useReviewer } from "./reviewer";
import { PaidBatchDialog } from "./shared";
import type { BatchEstimate, ExperimentRun, JudgeMissingResult } from "./types";

function resultText(r: JudgeMissingResult): string {
  const parts = [`Judged ${r.judged}`];
  if (r.already_current !== undefined) {
    if (r.already_current > 0) parts.push(`${r.already_current} already current`);
    if (r.skipped_live_in_mock_mode) parts.push(`${r.skipped_live_in_mock_mode} live trace(s) skipped — server is in mock mode`);
  } else if (r.skipped > 0) {
    parts.push(`${r.skipped} skipped`);
  }
  return parts.join(" · ");
}

/**
 * POST /api/experiments/[id]/judge — runs the EXPERIMENTAL judge on traces that
 * lack a result for the current judge version. A 409 opens the paid-batch
 * confirmation dialog; nothing is resubmitted without an explicit click.
 */
export function JudgeMissingButton({
  run,
  missing,
  serverMode,
  label = "Judge missing",
  onDone,
}: {
  run: ExperimentRun;
  /** traces of this run without a current-version judge verdict (from the run summary) */
  missing: number;
  /** execution mode of the server right now */
  serverMode: "live" | "mock";
  label?: string;
  onDone: () => void;
}) {
  const reviewer = useReviewer();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<{ estimate: BatchEstimate; message: string } | null>(null);

  const disabledReason = !reviewer
    ? "Enter your name under New run first (it is written to the audit log)"
    : run.status === "running"
      ? "Wait for the run to finish — the runner judges traces as they are produced"
      : missing === 0
        ? "Every trace already has a judge result for the current judge version"
        : run.execution_mode === "live" && serverMode === "mock"
          ? "These are live traces and the server is in mock mode — a mock verdict would never count"
          : undefined;

  async function submit(confirm: boolean) {
    setBusy(true);
    setMessage(null);
    const res = await apiRequest<JudgeMissingResult>("POST", `/api/experiments/${encodeURIComponent(run.run_id)}/judge`, {
      actor: reviewer,
      ...(confirm ? { confirm_paid_batch: true } : {}),
    });
    setBusy(false);
    if (res.ok) {
      setPending(null);
      setMessage({ tone: "ok", text: resultText(res.data) });
      onDone();
      return;
    }
    if (res.status === 409 && res.estimate) {
      setPending({ estimate: res.estimate, message: res.error });
      return;
    }
    setPending(null);
    setMessage({ tone: "error", text: res.error });
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      <Button variant="ghost" disabled={busy || Boolean(disabledReason)} title={disabledReason} onClick={() => submit(false)}>
        {busy ? "Judging…" : `${label}${missing > 0 ? ` (${missing})` : ""}`}
      </Button>
      {message && <span className={message.tone === "ok" ? "text-xs text-emerald-700" : "text-xs text-rose-700"}>{message.text}</span>}
      {pending && (
        <PaidBatchDialog
          title={`Confirm live judge batch for ${run.run_id}`}
          estimate={pending.estimate}
          message={pending.message}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => submit(true)}
        />
      )}
    </div>
  );
}
