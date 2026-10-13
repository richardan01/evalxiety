"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { Button, Callout, Card, EmptyState, MockBadge } from "@/components/ui";
import { ApprovalPanel } from "./ApprovalPanel";
import { AuditLog } from "./AuditLog";
import { CandidateSummary, EvidenceChecklist, Limitations, Recommendation, RunSelectors, StatusBanner, StepHeading } from "./sections";
import type { ReleaseView } from "./types";

interface Selection {
  candidate: string; // "" = latest completed corrected run on the release set
  baseline: string; // "" = latest completed baseline run on the release set
}

function query(sel: Selection): string {
  const qs = new URLSearchParams();
  if (sel.candidate) qs.set("candidate", sel.candidate);
  if (sel.baseline) qs.set("baseline", sel.baseline);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function ReleaseGate({ initialCandidate, initialBaseline }: { initialCandidate: string; initialBaseline: string }) {
  const [sel, setSel] = useState<Selection>({ candidate: initialCandidate, baseline: initialBaseline });
  const [nonce, setNonce] = useState(0);
  const [auditToken, setAuditToken] = useState(0);
  const [result, setResult] = useState<{ key: string; view: ReleaseView | null; error: string | null } | null>(null);
  const url = `/api/release${query(sel)}`;
  const key = `${url}#${nonce}`;

  useEffect(() => {
    let alive = true;
    getJSON<ReleaseView>(url)
      .then((view) => alive && setResult({ key, view, error: null }))
      .catch((e: unknown) => alive && setResult({ key, view: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [url, key]);

  const loading = result?.key !== key;
  // `result` keeps the previous view until the new one arrives, so the page doesn't flash while re-checking.
  const view = result?.view ?? null;

  // Results below are derived from the candidate's traces/judge results: label their execution mode.
  const modeBadge = view?.candidate_run ? <MockBadge mode={view.candidate_run.execution_mode} /> : null;

  function select(next: Selection) {
    setSel(next);
    window.history.replaceState(null, "", `/release${query(next)}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Release gate — demo release decision</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Should the pricing agent be released for a <b>demo</b>? The gate combines validated deterministic checks, a baseline comparison, human
            review coverage and the experimental judge&apos;s flags into one status. A named human then approves or rejects that exact evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs text-slate-500">Updating…</span>}
          <Button variant="secondary" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
            Re-check gate
          </Button>
        </div>
      </div>

      {result?.error && !loading && (
        <Callout tone="red" title="Could not load the release gate">
          <p>{result.error}</p>
          {(sel.candidate || sel.baseline) && (
            <div className="mt-2">
              <Button variant="secondary" onClick={() => select({ candidate: "", baseline: "" })}>
                Reset to the latest runs
              </Button>
            </div>
          )}
        </Callout>
      )}

      {!view && loading && <p className="text-sm text-slate-500">Loading the release gate…</p>}

      {view && (
        <>
          <StatusBanner view={view} />

          <Card>
            <StepHeading
              n={1}
              title="Choose what is being evaluated"
              help="The gate evaluates one candidate run against one baseline run. Both must have executed every case of the frozen release set."
            />
            <RunSelectors view={view} candidate={sel.candidate} baseline={sel.baseline} onChange={select} busy={loading} />
            <div className="mt-4">
              {view.candidate_run ? (
                <CandidateSummary view={view} />
              ) : (
                <EmptyState title="No candidate run yet">
                  The gate needs a completed run of the corrected configuration on {view.required_set.frozen_set_id} (all{" "}
                  {view.required_set.case_ids.length} frozen cases). Start one on the{" "}
                  <Link href="/experiments" className="text-sky-700 hover:underline">
                    Experiments tab
                  </Link>
                  , then return here.
                </EmptyState>
              )}
            </div>
          </Card>

          <Card>
            <StepHeading
              n={2}
              title="Read the release recommendation"
              aside={modeBadge}
              help="The recommendation restates the gate's reasons in plain language. Reasons are grouped by how they affect the decision; case chips open the candidate's trace for that case."
            />
            <Recommendation view={view} />
          </Card>

          <Card>
            <StepHeading
              n={3}
              title="Check that the evidence is complete"
              aside={modeBadge}
              help="Each item is computed by the gate from stored runs, traces, judge results and human annotations."
            />
            <EvidenceChecklist checks={view.gate.checks} />
          </Card>

          <Card>
            <StepHeading n={4} title="Understand the limitations" help="What this evidence cannot tell you, even when every check passes." />
            <Limitations items={view.gate.limitations} />
          </Card>

          <Card>
            <StepHeading
              n={5}
              title="Record a human decision"
              help="Approval is separate from evaluation. Only an ELIGIBLE candidate can be approved; a rejection can always be recorded."
            />
            <ApprovalPanel
              view={view}
              onRecorded={(next) => {
                setResult({ key, view: next, error: null });
                setAuditToken((t) => t + 1);
              }}
            />
          </Card>

          <AuditLog reloadToken={auditToken} />
        </>
      )}
    </div>
  );
}
