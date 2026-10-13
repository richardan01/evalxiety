"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { getJSON } from "@/lib/client/api";
import { Button, Callout, Card, MockBadge, PageHeader } from "@/components/ui";
import { ApprovalPanel } from "./ApprovalPanel";
import { AuditLog } from "./AuditLog";
import { CandidateSummary, Checklist, Reasons, RunSelectors, Verdict, runsSummary } from "./sections";
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

/**
 * The selection comes from the URL (?candidate=&baseline=) via page props — the URL is the
 * single source of truth, so the header tab link (/release) always resets to the latest runs.
 */
export function ReleaseGate({ candidate, baseline }: Selection) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [nonce, setNonce] = useState(0);
  const [auditToken, setAuditToken] = useState(0);
  const [result, setResult] = useState<{ key: string; view: ReleaseView | null; error: string | null } | null>(null);
  const url = `/api/release${query({ candidate, baseline })}`;
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

  const loading = result?.key !== key || navigating;
  // `result` keeps the previous view until the new one arrives, so the page doesn't flash while re-checking.
  const view = result?.view ?? null;
  const passed = view?.gate.checks.filter((c) => c.status === "pass").length ?? 0;

  function select(next: Selection) {
    startNav(() => router.replace(`/release${query(next)}`, { scroll: false }));
  }

  return (
    <div>
      <PageHeader
        title="Release gate"
        question="Can this agent version ship to the demo?"
        info={
          <>
            Automated checks, a baseline comparison and human reviews roll up into one status:{" "}
            <b>No ship › Not enough evidence › Ready for approval</b>. Only a named human&apos;s sign-off on this exact evidence makes it{" "}
            <b>Approved for demo</b>.
          </>
        }
        action={
          <div className="flex items-center gap-2">
            {loading && view && <span className="text-xs text-slate-500">Updating…</span>}
            <Button variant="secondary" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
              Re-check
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
        {result?.error && !loading && (
          <Callout tone="red" title="Could not load the release gate">
            <p>{result.error}</p>
            {(candidate || baseline) && (
              <div className="mt-2">
                <Button variant="secondary" onClick={() => select({ candidate: "", baseline: "" })}>
                  Reset to the latest runs
                </Button>
              </div>
            )}
          </Callout>
        )}

        {!view && loading && <p className="text-sm text-slate-500">Loading…</p>}

        {view && (
          <>
            <Verdict view={view} />

            <Card
              title={
                <>
                  What&apos;s needed{" "}
                  <span className="font-normal text-slate-500">
                    · {passed}/{view.gate.checks.length} done
                  </span>
                </>
              }
              actions={view.candidate_run ? <MockBadge mode={view.candidate_run.execution_mode} /> : null}
            >
              <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2">
                <Checklist checks={view.gate.checks} />
                <Reasons view={view} />
              </div>
            </Card>

            <ApprovalPanel
              key={`${view.candidate_run?.run_id ?? "none"}|${view.evidence_snapshot_hash}`}
              view={view}
              refreshing={loading}
              onRecorded={(next) => {
                setResult({ key, view: next, error: null });
                setAuditToken((t) => t + 1);
              }}
            />

            <details className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-slate-700">
                Runs &amp; details <span className="font-normal text-slate-400">· {runsSummary(view)}</span>
              </summary>
              <div className="space-y-4 border-t border-slate-100 px-4 py-3">
                <RunSelectors view={view} candidate={candidate} baseline={baseline} onChange={select} busy={loading} />
                <CandidateSummary view={view} />
              </div>
            </details>

            <AuditLog reloadToken={auditToken} />
          </>
        )}
      </div>
    </div>
  );
}
