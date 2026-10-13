"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, EmptyState } from "@/components/ui";
import { ComparisonView } from "./ComparisonView";
import { ConfigsSection } from "./ConfigsSection";
import { FrozenSetsSection } from "./FrozenSetsSection";
import { RunLauncher } from "./RunLauncher";
import { RunsTable } from "./RunsTable";
import { apiRequest, type ApiResult } from "./request";
import { SectionHeading } from "./shared";
import type { ExperimentsData, RunRow } from "./types";

const STALL_MS = 60 * 60 * 1000;

/** Latest completed Baseline + Corrected pair on the same frozen set (identical hash), newest first. */
function latestPair(runs: RunRow[]): [RunRow, RunRow] | null {
  const done = runs.filter((r) => r.run.status === "completed");
  for (const c of done.filter((r) => r.config_role === "corrected")) {
    const b = done.find((r) => r.config_role === "baseline" && r.run.frozen_set_hash === c.run.frozen_set_hash && r.run.frozen_set_id === c.run.frozen_set_id);
    if (b) return [b, c];
  }
  return null;
}

export function ExperimentsHome() {
  const [data, setData] = useState<ExperimentsData | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);

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
  const shouldPoll = data?.runs.some((r) => r.run.status === "running" && !isStalled(r)) ?? false;

  useEffect(() => {
    if (!shouldPoll) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [shouldPoll, load]);

  if (!data) {
    return error ? (
      <Callout tone="red" title="Could not load experiments">
        {error}
      </Callout>
    ) : (
      <p className="text-sm text-slate-500">Loading experiments…</p>
    );
  }

  const byId = new Map(data.runs.map((r) => [r.run.run_id, r]));
  const baseline = baselineId ? byId.get(baselineId) : undefined;
  const candidate = candidateId ? byId.get(candidateId) : undefined;
  const pair = latestPair(data.runs);
  const refreshKey = [baseline, candidate]
    .map((r) => (r ? `${r.run.status}:${r.progress.traces_done}:${JSON.stringify(r.summary.judge)}` : "-"))
    .join("|");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Experiments — baseline vs corrected on frozen cases</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Run both agent configurations on the same frozen synthetic cases and compare them <b>case by case</b>. This is regression testing:
          a fix only counts if the cases it targets now pass <i>and</i> no case that passed before has started failing.
        </p>
        <ol className="mt-3 grid gap-1 text-sm text-slate-700 sm:grid-cols-5">
          {["Understand the two configurations", "Check the frozen test set", "Run both configurations", "Pick baseline & candidate runs", "Inspect the paired comparison"].map(
            (s, i) => (
              <li key={s} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <span className="mr-1 font-semibold text-slate-400">{i + 1}.</span>
                <a className="hover:underline" href={`#step-${i + 1}`}>
                  {s}
                </a>
              </li>
            ),
          )}
        </ol>
        {error && (
          <p className="mt-2 text-xs text-rose-700">
            Last refresh failed: {error} (showing the previous data)
          </p>
        )}
      </div>

      <section className="space-y-3">
        <SectionHeading n={1} id="step-1" title="The two configurations under test">
          The baseline is the current agent; the corrected agent changes how it picks the pricing policy. Everything else is held constant so
          that differences in results can be attributed to that change.
        </SectionHeading>
        <ConfigsSection configs={data.agent_configs} modelId={data.model_id} />
      </section>

      <section className="space-y-3">
        <SectionHeading n={2} id="step-2" title="Frozen test sets">
          A frozen set is a fixed list of synthetic cases whose content is fingerprinted, so two runs can be compared on exactly the same inputs.
        </SectionHeading>
        <FrozenSetsSection sets={data.frozen_sets} heldout={data.heldout} />
      </section>

      <section className="space-y-3">
        <SectionHeading n={3} id="step-3" title="Run a configuration on a frozen set">
          Each run executes the agent once per case and records one trace per case. In live mode this spends API credits, so you will see an
          estimate and must confirm it.
        </SectionHeading>
        <RunLauncher data={data} onStarted={() => void load()} />
      </section>

      <section className="space-y-3">
        <SectionHeading n={4} id="step-4" title="Runs — pick a baseline and a candidate">
          Pass-all = share of cases where every applicable validated deterministic check passes (cases without a trace count as not passing).
          Critical fails = critical-severity check failures. Judge columns are experimental and never feed pass-all. The list refreshes every 3
          seconds while a run is in progress.
        </SectionHeading>
        {pair && (pair[0].run.run_id !== baselineId || pair[1].run.run_id !== candidateId) && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Button
              variant="secondary"
              onClick={() => {
                setBaselineId(pair[0].run.run_id);
                setCandidateId(pair[1].run.run_id);
              }}
            >
              Select latest Baseline vs Corrected pair
            </Button>
            <span className="text-xs">
              {pair[0].run.run_id} vs {pair[1].run.run_id} on {pair[0].run.frozen_set_id}
            </span>
          </div>
        )}
        {baseline && candidate && baseline.run.execution_mode !== candidate.run.execution_mode && (
          <Callout tone="red" title="Mode mismatch">
            The baseline run is {baseline.run.execution_mode.toUpperCase()} and the candidate run is {candidate.run.execution_mode.toUpperCase()}.
            A MOCK-vs-LIVE comparison says nothing about the configuration change — pick two runs with the same mode.
          </Callout>
        )}
        <RunsTable
          data={data}
          baselineId={baselineId}
          candidateId={candidateId}
          onSelectBaseline={setBaselineId}
          onSelectCandidate={setCandidateId}
          onClear={() => {
            setBaselineId(null);
            setCandidateId(null);
          }}
          onChanged={() => void load()}
          isStalled={isStalled}
        />
      </section>

      <section className="space-y-3">
        <SectionHeading n={5} id="step-5" title="Paired comparison: baseline vs candidate, case by case">
          Both runs are paired case by case over identical frozen inputs. Start with the headline, then read the case table — that is where the
          evidence is.
        </SectionHeading>
        {baseline && candidate ? (
          <ComparisonView
            baseline={baseline}
            candidate={candidate}
            evaluators={data.evaluators}
            refreshKey={refreshKey}
            onChanged={() => void load()}
          />
        ) : (
          <EmptyState title="Select two runs to compare">
            {data.runs.length < 2
              ? "Run Baseline and Corrected on the same frozen set (step 3), then choose one as baseline and the other as candidate in step 4."
              : `Choose a baseline run and a candidate run on the same frozen set in step 4${baseline ? " — baseline selected, now pick a candidate" : candidate ? " — candidate selected, now pick a baseline" : ""}.`}
          </EmptyState>
        )}
      </section>
    </div>
  );
}
