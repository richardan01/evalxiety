"use client";

import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import { Badge, Button, Callout, EmptyState, cx, fmtDateTime } from "@/components/ui";
import { APPROVAL_STATE_HELP, APPROVAL_STATE_LABEL, STATUS_META, approveBlockedReason, shortHash } from "./status";
import { SnapshotHash } from "./sections";
import type { ReleaseDecisionResponse, ReleaseView } from "./types";
import { useApprover } from "./useApprover";

/**
 * (f) Human approval. Approval is a separate act from evaluation: it records a
 * named person's decision against the exact evidence snapshot shown here.
 */
export function ApprovalPanel({ view, onRecorded }: { view: ReleaseView; onRecorded: (v: ReleaseDecisionResponse) => void }) {
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

  async function decide(decision: "approved" | "rejected") {
    if (!candidate) return;
    const who = approver.commit();
    if (!who) {
      setError("Enter your name first — every release decision must carry a named human.");
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
      setSaved(
        `${decision === "approved" ? "Approval" : "Rejection"} recorded by ${who} against evidence snapshot ${shortHash(res.recorded_approval.evidence_snapshot_hash)}.`,
      );
      onRecorded(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p>
              Your decision is bound to evidence snapshot <SnapshotHash hash={view.evidence_snapshot_hash} /> — a hash of the candidate and
              baseline runs, every check result, judge verdicts, human annotations on the candidate, evaluator/judge versions and the frozen-set
              hash.
            </p>
            <p className="mt-1">
              If any of that evidence changes later (a new run, annotation or judge result), the decision becomes <b>stale</b> and someone must
              decide again.
            </p>
            <p className="mt-1">
              Current human approval: <b>{APPROVAL_STATE_LABEL[gate.approval_state]}</b> — {APPROVAL_STATE_HELP[gate.approval_state]}
            </p>
          </div>

          {!candidate ? (
            <EmptyState title="Nothing to approve yet">
              A decision needs a candidate run. Run the corrected configuration on {view.required_set.frozen_set_id} from the Experiments tab.
            </EmptyState>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Step A · Your name <span className="text-rose-700">*</span> — recorded with the decision and in the audit log
                </span>
                <input
                  className={cx(
                    "w-full max-w-sm rounded-md border bg-white px-2 py-1.5 text-sm",
                    name ? "border-slate-300" : "border-amber-400 ring-1 ring-amber-200",
                  )}
                  placeholder="e.g. Rich (pricing lead)"
                  value={approver.value}
                  onChange={(e) => approver.setValue(e.target.value)}
                  onBlur={() => approver.commit()}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Step B · Notes — <b>required when rejecting</b>; recommended when approving (what you checked, residual risks)
                </span>
                <textarea
                  className="h-20 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What did you review? Why approve or reject?"
                />
              </label>
              <label className={cx("flex items-start gap-2 text-sm", blocked && "opacity-60")}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={reviewed}
                  disabled={Boolean(blocked)}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>
                  Step C · I reviewed the recommendation, every reason and checklist item, and the limitations above, and I understand this is a demo
                  decision for a synthetic prototype set.
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => decide("approved")}
                  disabled={Boolean(blocked) || !name || !reviewed || busy !== null}
                  title={blocked ?? (!name ? "Enter your name" : !reviewed ? "Confirm you reviewed the evidence" : "Approve for demo")}
                >
                  {busy === "approved" ? "Recording…" : "Approve for demo"}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => decide("rejected")}
                  disabled={!name || !notes.trim() || busy !== null}
                  title={!name ? "Enter your name" : !notes.trim() ? "Notes are required to reject" : "Reject this candidate"}
                >
                  {busy === "rejected" ? "Recording…" : "Reject"}
                </Button>
                {!name && <span className="text-xs text-amber-800">Enter your name to enable the decision buttons.</span>}
                {name && !notes.trim() && <span className="text-xs text-slate-500">Reject needs a note.</span>}
              </div>
              {blocked && (
                <Callout tone="slate" title="Why “Approve” is disabled">
                  {blocked} Rejections can always be recorded.
                </Callout>
              )}
              {error && (
                <Callout tone="red" title="Decision not recorded">
                  {error}
                </Callout>
              )}
              {saved && <Callout tone="blue">{saved}</Callout>}
            </>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-800">Decision history for this candidate run</h3>
          <p className="mb-2 text-xs text-slate-500">Newest first. Only the latest decision counts, and only while its snapshot matches the current one.</p>
          {history.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              No human decision has been recorded for {candidate ? <code className="font-mono">{candidate.run_id}</code> : "this candidate"}.
            </p>
          ) : (
            <ol className="space-y-2">
              {history.map((a, i) => {
                const current = a.evidence_snapshot_hash === view.evidence_snapshot_hash;
                return (
                  <li key={a.approval_id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={a.decision === "approved" ? "green" : "red"}>{a.decision.toUpperCase()}</Badge>
                      <b>{a.approver}</b>
                      <span className="text-xs text-slate-500">{fmtDateTime(a.created_at)}</span>
                      {i === 0 && <Badge tone="neutral">latest</Badge>}
                      {current ? (
                        <Badge tone="blue" title="Made on the evidence currently shown">current evidence</Badge>
                      ) : (
                        <Badge tone="amber" title="Evidence has changed since this decision">stale</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Snapshot <SnapshotHash hash={a.evidence_snapshot_hash} /> · evaluation status at the time:{" "}
                      {STATUS_META[a.status_at_approval].label}
                      {a.baseline_run_id && (
                        <>
                          {" "}
                          · baseline <code className="font-mono">{a.baseline_run_id}</code>
                        </>
                      )}
                    </div>
                    {a.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">“{a.notes}”</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
