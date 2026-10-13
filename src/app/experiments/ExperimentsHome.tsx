"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, MockBadge, PageHeader, fmtDateTime } from "@/components/ui";
import { CaseTable, ComparisonNotices, CostTable, PerCheckTable, ResultStrip, costSummary, useComparison } from "./ComparisonView";
import { ConfigsSection, configsSummary } from "./ConfigsSection";
import { FrozenSetsSection } from "./FrozenSetsSection";
import { latestComparablePair } from "./pairing";
import { RunLauncher } from "./RunLauncher";
import { RunsTable } from "./RunsTable";
import { apiRequest, type ApiResult } from "./request";
import { Disclosure } from "./shared";
import type { ExperimentsData, RunRow } from "./types";

const STALL_MS = 60 * 60 * 1000;

const PAGE_INFO = (
  <>
    <b>Baseline</b> reads a stale policy index; <b>Corrected</b> picks the policy in force on the decision date. Both run on the same frozen
    test cases. A fix counts only if failing cases now pass <i>and</i> nothing that passed breaks. Pass-all = every code check passes; the AI
    judge is experimental and never counts.
  </>
);

/** null = follow the latest comparable pair automatically. */
type Selection = { baseline: string | null; candidate: string | null } | null;

export function ExperimentsHome() {
  const [data, setData] = useState<ExperimentsData | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);

  const apply = useCallback((res: ApiResult<ExperimentsData>) => {
    if (res.ok) {
      setData(res.data);
      setFetchedAt(Date.now());
      setError(null);
    } else {
      setError(res.error);
    }
  }, []);

  const load = useCallback(() => apiRequest<ExperimentsData>("GET", "/api/experiments").then(apply), [apply]);

  useEffect(() => {
    let alive = true;
    void apiRequest<ExperimentsData>("GET", "/api/experiments").then((res) => {
      if (alive) apply(res);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  const isStalled = useCallback(
    (r: RunRow) => r.run.status === "running" && fetchedAt > 0 && fetchedAt - Date.parse(r.run.created_at) > STALL_MS,
    [fetchedAt],
  );
  const running = data?.runs.filter((r) => r.run.status === "running" && !isStalled(r)) ?? [];
  const shouldPoll = running.length > 0;

  useEffect(() => {
    if (!shouldPoll) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [shouldPoll, load]);

  const runs = data?.runs ?? [];
  const byId = new Map(runs.map((r) => [r.run.run_id, r]));
  const auto = data ? latestComparablePair(data.runs, data.frozen_sets) : null;
  const baselineId = selection ? selection.baseline : (auto?.[0].run.run_id ?? null);
  const candidateId = selection ? selection.candidate : (auto?.[1].run.run_id ?? null);
  const baseline = baselineId ? byId.get(baselineId) : undefined;
  const candidate = candidateId ? byId.get(candidateId) : undefined;
  const refreshKey = [baseline, candidate]
    .map((r) => (r ? `${r.run.status}:${r.progress.traces_done}:${JSON.stringify(r.summary.judge)}` : "-"))
    .join("|");
  const cmp = useComparison(baseline, candidate, refreshKey);

  const header = (
    <PageHeader
      title="Experiments"
      question="Did the fix work — without breaking anything?"
      info={PAGE_INFO}
      action={
        data && (
          <Button variant={launcherOpen ? "secondary" : "primary"} onClick={() => setLauncherOpen((o) => !o)}>
            {launcherOpen ? "Close" : "▶ New run"}
          </Button>
        )
      }
    />
  );

  if (!data) {
    return (
      <div>
        {header}
        {error ? <p className="text-sm text-rose-700">Could not load experiments: {error}</p> : <p className="text-sm text-slate-500">Loading…</p>}
      </div>
    );
  }

  const openRuns = () => {
    setRunsOpen(true);
    requestAnimationFrame(() => document.getElementById("all-runs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const isAuto = selection === null;
  const d = cmp.status === "ready" ? cmp.data : null;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {header}
        {launcherOpen && <RunLauncher data={data} onStarted={() => void load()} />}
        {running.map((r) => (
          <p key={r.run.run_id} className="flex items-center gap-2 text-xs text-amber-900">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
            Running {r.config_label} on {r.run.frozen_set_id}: {r.progress.traces_done}/{r.progress.cases} cases
            <MockBadge mode={r.run.execution_mode} />
          </p>
        ))}
        {error && <p className="text-xs text-rose-700">Last refresh failed: {error} (showing previous data)</p>}
      </div>

      {/* The answer */}
      {baseline && candidate ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
            <MockBadge mode={baseline.run.execution_mode} />
            {candidate.run.execution_mode !== baseline.run.execution_mode && <MockBadge mode={candidate.run.execution_mode} />}
            <span>
              <b className="text-slate-900">{baseline.config_label}</b> vs <b className="text-slate-900">{candidate.config_label}</b> on{" "}
              {d ? d.comparison.pairs.length : candidate.progress.cases} cases ({candidate.run.frozen_set_id})
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-xs text-slate-500">{fmtDateTime(candidate.run.created_at)}</span>
            <span className="text-slate-400">·</span>
            <span className="text-xs text-slate-500">{isAuto ? "latest pair" : "your pick"}</span>
            <button type="button" className="text-xs text-sky-700 hover:underline" onClick={isAuto ? openRuns : () => setSelection(null)}>
              {isAuto ? "change" : "back to latest"}
            </button>
          </div>

          {cmp.status === "loading" && <p className="text-sm text-slate-500">Comparing…</p>}
          {cmp.status === "error" && <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">Comparison not available: {cmp.error}</p>}
          {d && (
            <>
              <ResultStrip d={d} />
              <ComparisonNotices d={d} />
              <CaseTable d={d} evaluators={data.evaluators} />
            </>
          )}
        </section>
      ) : (
        <EmptyState title={selection ? "Pick a Before and an After run" : "No comparable Baseline + Corrected pair yet"}>
          {selection ? (
            <button type="button" className="text-sky-700 hover:underline" onClick={openRuns}>
              Open All runs
            </button>
          ) : (
            <span>
              Run both versions on the same test set.{" "}
              <button type="button" className="text-sky-700 hover:underline" onClick={() => setLauncherOpen(true)}>
                New run
              </button>
            </span>
          )}
        </EmptyState>
      )}

      {/* Secondary detail — collapsed */}
      <div className="space-y-2 pt-2">
        <Disclosure title="How the two versions differ" meta={configsSummary(data.agent_configs)}>
          <ConfigsSection configs={data.agent_configs} modelId={data.model_id} />
        </Disclosure>
        {d && (
          <>
            <Disclosure title="Pass rate per check" meta={`${Object.keys(d.comparison.per_evaluator).length} code checks + AI judge`}>
              <PerCheckTable d={d} evaluators={data.evaluators} />
            </Disclosure>
            <Disclosure title="Cost & latency" meta={costSummary(d)}>
              <CostTable d={d} />
            </Disclosure>
          </>
        )}
        <Disclosure
          title="Test sets"
          meta={`${data.frozen_sets.length} frozen sets · held-out ${data.heldout.revealed ? "unlocked" : "locked"}`}
        >
          <FrozenSetsSection sets={data.frozen_sets} heldout={data.heldout} />
        </Disclosure>
        <Disclosure
          id="all-runs"
          title="All runs"
          meta={`${data.runs.length} run${data.runs.length === 1 ? "" : "s"} · pick a different pair`}
          open={runsOpen}
          onOpenChange={setRunsOpen}
        >
          <RunsTable
            data={data}
            baselineId={baselineId}
            candidateId={candidateId}
            onSelectBaseline={(id) => setSelection({ baseline: id, candidate: candidateId })}
            onSelectCandidate={(id) => setSelection({ baseline: baselineId, candidate: id })}
            onClear={() => setSelection({ baseline: null, candidate: null })}
            onChanged={() => void load()}
            isStalled={isStalled}
          />
        </Disclosure>
      </div>
    </div>
  );
}
