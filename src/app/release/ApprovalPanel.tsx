"use client";

import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import { Badge, Button, Card, InfoTip, cx, fmtDateTime } from "@/components/ui";
import { PLAIN_STATUS, approveBlockedReason, shortHash } from "./status";
import { SnapshotHash } from "./sections";
import type { ReleaseDecisionResponse, ReleaseView } from "./types";
import { useApprover } from "./useApprover";

/**
 * Human approval — a separate act from evaluation. Records a named person's
 * decision against the exact evidence snapshot shown here. The parent keys this
 * component by candidate run + snapshot hash, so the attestation never carries
 * over to different evidence.
 */
export function ApprovalPanel({
  view,
  refreshing,
  onRecorded,
}: {
  view: ReleaseView;
  /** A newer view is loading: decisions are disabled until it arrives. */
  refreshing: boolean;
  onRecorded: (v: ReleaseDecisionResponse) => void;
}) {
  const approver = useApprover();
  const [notes, setNotes] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { gate } = view;
  const candidate = view.candidate_run;
  const name = approver.value.trim();
  const blocked = approveBlockedReason(gate, Boolean(candidate));
  const history = [...view.approvals].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const locked = busy !== null || refreshing || !candidate;

  async function decide(decision: "approved" | "rejected") {
    if (!candidate) return;
    const who = approver.commit();
    if (!who) {
      setError("Enter your name first.");
      return;
    }
    setBusy(decision);
    setError(null);
    setSaved(null);
    try {
      const res = await postJSON<ReleaseDecisionResponse>("/api/release/approve", {
        approver: who,
        decision,
        notes: notes.trim(),
        candidate_run_id: candidate.run_id,
        baseline_run_id: view.baseline_run?.run_id ?? null,
        expected_evidence_snapshot_hash: view.evidence_snapshot_hash,
      });
      setNotes("");
      setReviewed(false);
      setSaved(`${decision === "approved" ? "Approved" : "Rejected"} by ${who} · snapshot ${shortHash(res.recorded_approval.evidence_snapshot_hash)}`);
      onRecorded(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // One status line under the controls, most important first.
  const line: { text: string; cls: string } | null = error
    ? { text: `Not recorded: ${error}`, cls: "text-rose-700" }
    : saved
      ? { text: `✓ ${saved}`, cls: "text-emerald-700" }
      : refreshing
        ? { text: "Re-checking the evidence…", cls: "text-slate-500" }
        : blocked
          ? { text: blocked, cls: "text-slate-500" }
          : !name
            ? { text: "Enter your name to decide.", cls: "text-amber-800" }
            : !reviewed
              ? { text: "Tick “I reviewed the evidence” to enable Approve.", cls: "text-slate-500" }
              : null;

  return (
    <div id="approval" className="scroll-mt-6">
      <Card
        title="Human sign-off"
        subtitle="Approval is separate from evaluation."
        actions={
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            Evidence <SnapshotHash hash={view.evidence_snapshot_hash} />
            <InfoTip label="Evidence snapshot">
              Approval binds to this exact evidence; it goes stale if evidence changes (a new run, annotation or judge result).
            </InfoTip>
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Your name"
            className={cx("w-44 rounded-md border bg-white px-2 py-1.5 text-sm", name ? "border-slate-300" : "border-amber-400")}
            placeholder="Your name *"
            value={approver.value}
            onChange={(e) => approver.setValue(e.target.value)}
            onBlur={() => approver.commit()}
          />
          <input
            aria-label="Notes"
            className="min-w-[16rem] flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            placeholder="Notes (required to reject)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {!blocked && (
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={reviewed} disabled={locked} onChange={(e) => setReviewed(e.target.checked)} />I reviewed the evidence
            </label>
          )}
          <Button
            onClick={() => decide("approved")}
            disabled={Boolean(blocked) || !name || !reviewed || locked}
            title={blocked ?? (!name ? "Enter your name" : !reviewed ? "Confirm you reviewed the evidence" : "Approve for demo")}
          >
            {busy === "approved" ? "Recording…" : "Approve for demo"}
          </Button>
          <Button
            variant="danger"
            onClick={() => decide("rejected")}
            disabled={!name || !notes.trim() || locked}
            title={!candidate ? "No candidate run" : !name ? "Enter your name" : !notes.trim() ? "Notes are required to reject" : "Reject this candidate"}
          >
            {busy === "rejected" ? "Recording…" : "Reject"}
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className={cx("text-xs", line?.cls)}>{line?.text}</p>
          {history.length > 0 && <History view={view} history={history} />}
        </div>
      </Card>
    </div>
  );
}

function History({ view, history }: { view: ReleaseView; history: ReleaseView["approvals"] }) {
  return (
    <details className="w-full text-sm">
      <summary className="cursor-pointer select-none text-xs font-medium text-slate-600">Decision history ({history.length})</summary>
      <ol className="mt-2 space-y-1.5">
        {history.map((a, i) => {
          const current = a.evidence_snapshot_hash === view.evidence_snapshot_hash;
          return (
            <li key={a.approval_id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">
              <Badge tone={a.decision === "approved" ? "green" : "red"}>{a.decision.toUpperCase()}</Badge>
              <b className="text-slate-800">{a.approver}</b>
              <span className="text-slate-500">{fmtDateTime(a.created_at)}</span>
              {i === 0 && <Badge>latest</Badge>}
              {current ? (
                <Badge tone="blue" title="Made on the evidence currently shown">current</Badge>
              ) : (
                <Badge tone="amber" title="Evidence has changed since this decision">stale</Badge>
              )}
              <SnapshotHash hash={a.evidence_snapshot_hash} />
              <span className="text-slate-500">was {PLAIN_STATUS[a.status_at_approval]}</span>
              {a.notes && <span className="min-w-0 basis-full truncate text-slate-700" title={a.notes}>“{a.notes}”</span>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
