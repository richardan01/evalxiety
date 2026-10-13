"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, MockBadge, Ratio, cx, fmtDateTime, fmtUsd } from "@/components/ui";
import { JudgeMissingButton } from "./JudgeMissingButton";
import { apiRequest } from "./request";
import { OutcomeChip, fmtInt, humanize, shortHash } from "./shared";
import type { ExperimentsData, RunDetailData, RunRow } from "./types";

export const missingJudgeCount = (r: RunRow) => Math.max(0, r.summary.judge.not_run - (r.summary.n_cases - r.summary.n_with_trace));

function StatusCell({ row, stalled }: { row: RunRow; stalled: boolean }) {
  const { run, progress } = row;
  if (run.status === "running") {
    const pct = progress.cases ? Math.round((progress.traces_done / progress.cases) * 100) : 0;
    return (
      <div className="min-w-[110px]">
        <Badge tone="amber">RUNNING</Badge>
        <div className="mt-1 text-xs tabular-nums text-slate-600">
          {progress.traces_done} / {progress.cases} traces
        </div>
        <div className="mt-0.5 h-1.5 w-full rounded bg-slate-100">
          <div className="h-1.5 rounded bg-amber-500" style={{ width: `${pct}%` }} />
        </div>
        {stalled && <div className="mt-0.5 text-[11px] text-rose-700">No completion after 60 min — the server may have restarted; polling stopped.</div>}
      </div>
    );
  }
  if (run.status === "failed") {
    return (
      <div>
        <Badge tone="red" title={run.notes ?? undefined}>
          FAILED
        </Badge>
        <div className="mt-1 text-xs text-slate-600">
          {progress.traces_done} / {progress.cases} traces
        </div>
        {run.notes && <div className="mt-0.5 max-w-[220px] text-[11px] text-rose-700">{run.notes}</div>}
      </div>
    );
  }
  return (
    <div>
      <Badge tone="green">COMPLETED</Badge>
      <div className="mt-1 text-xs tabular-nums text-slate-600">
        {progress.traces_done} / {progress.cases} traces
      </div>
    </div>
  );
}

export function RunsTable({
  data,
  baselineId,
  candidateId,
  onSelectBaseline,
  onSelectCandidate,
  onClear,
  onChanged,
  isStalled,
}: {
  data: ExperimentsData;
  baselineId: string | null;
  candidateId: string | null;
  onSelectBaseline: (id: string) => void;
  onSelectCandidate: (id: string) => void;
  onClear: () => void;
  onChanged: () => void;
  isStalled: (row: RunRow) => boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const byId = new Map(data.runs.map((r) => [r.run.run_id, r]));
  const baseline = baselineId ? byId.get(baselineId) : undefined;
  const candidate = candidateId ? byId.get(candidateId) : undefined;

  const incompatible = (row: RunRow, other: RunRow | undefined): string | null => {
    if (!other) return null;
    if (other.run.run_id === row.run.run_id) return "Already selected on the other side";
    if (other.run.frozen_set_id !== row.run.frozen_set_id || other.run.frozen_set_hash !== row.run.frozen_set_hash) {
      return `Different frozen set (${row.run.frozen_set_id} vs ${other.run.frozen_set_id}) — paired comparison requires identical case hashes`;
    }
    return null;
  };

  if (data.runs.length === 0) {
    return (
      <EmptyState title="No experiment runs yet">
        Start a run above — e.g. Baseline on FROZEN-DEV-v1, then Corrected on FROZEN-DEV-v1 — and both will appear here.
      </EmptyState>
    );
  }

  return (
    <Card
      title="Experiment runs"
      subtitle="Newest first. Choose one Baseline and one Candidate run on the same frozen set to compare them in step 5."
      actions={
        (baselineId || candidateId) && (
          <Button variant="ghost" onClick={onClear}>
            Clear selection
          </Button>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="py-1.5 pr-2 font-medium" title="Baseline side of the comparison">
                Base
              </th>
              <th className="py-1.5 pr-3 font-medium" title="Candidate side of the comparison">
                Cand.
              </th>
              <th className="py-1.5 pr-3 font-medium">Run</th>
              <th className="py-1.5 pr-3 font-medium">Config</th>
              <th className="py-1.5 pr-3 font-medium">Frozen set</th>
              <th className="py-1.5 pr-3 font-medium">Mode</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium" title="Cases where every applicable validated deterministic check passes, out of all cases in the set">
                Pass-all
              </th>
              <th className="py-1.5 pr-3 font-medium" title="Number of critical-severity check FAILs across all cases">
                Critical fails
              </th>
              <th className="py-1.5 pr-3 font-medium" title="Experimental judge verdicts (current judge version). Not part of pass-all.">
                Judge <span className="text-violet-700">(exp.)</span>
              </th>
              <th className="py-1.5 pr-3 font-medium">Tokens in / out</th>
              <th className="py-1.5 pr-3 font-medium" title="Estimated agent API cost from token usage; cache hits and mock runs cost $0">
                Est. cost
              </th>
              <th className="py-1.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((row) => {
              const { run, summary } = row;
              const bBlock = incompatible(row, candidate);
              const cBlock = incompatible(row, baseline);
              const selected = run.run_id === baselineId || run.run_id === candidateId;
              const j = summary.judge;
              return (
                <Fragment key={run.run_id}>
                  <tr className={cx("border-b border-slate-50 align-top", selected && "bg-sky-50/60")}>
                    <td className="py-2 pr-2">
                      <input
                        type="radio"
                        name="baseline-run"
                        aria-label={`Use ${run.run_id} as baseline`}
                        checked={baselineId === run.run_id}
                        disabled={Boolean(bBlock)}
                        title={bBlock ?? "Use as baseline"}
                        onChange={() => onSelectBaseline(run.run_id)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="radio"
                        name="candidate-run"
                        aria-label={`Use ${run.run_id} as candidate`}
                        checked={candidateId === run.run_id}
                        disabled={Boolean(cBlock)}
                        title={cBlock ?? "Use as candidate"}
                        onChange={() => onSelectCandidate(run.run_id)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <code className="font-mono text-xs">{run.run_id}</code>
                      <div className="text-xs text-slate-500">{fmtDateTime(run.created_at)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={row.config_role === "corrected" ? "blue" : "neutral"}>{row.config_label}</Badge>
                      <div className="font-mono text-[11px] text-slate-500">{run.agent_config_id}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs">{run.frozen_set_id}</span>
                      <div className="font-mono text-[11px] text-slate-500" title={run.frozen_set_hash}>
                        {shortHash(run.frozen_set_hash)}…
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <MockBadge mode={run.execution_mode} />
                    </td>
                    <td className="py-2 pr-3">
                      <StatusCell row={row} stalled={isStalled(row)} />
                    </td>
                    <td className="py-2 pr-3">
                      {run.status === "running" ? (
                        <span className="text-xs text-slate-500">in progress</span>
                      ) : (
                        <>
                          <Ratio value={summary.pass_all_rate} undefinedReason="The run has no cases" />
                          <div className="text-xs tabular-nums text-slate-500">
                            {summary.pass_all_count} / {summary.n_cases} cases
                          </div>
                          {summary.n_incomplete > 0 && <div className="text-[11px] text-violet-700">{summary.n_incomplete} incomplete</div>}
                        </>
                      )}
                    </td>
                    <td className={cx("py-2 pr-3 tabular-nums", summary.critical_failure_count > 0 && "font-semibold text-rose-700")}>
                      {summary.critical_failure_count}
                      {summary.cases_with_critical_failure.length > 0 && (
                        <div className="text-[11px] font-normal text-slate-500">in {summary.cases_with_critical_failure.length} case(s)</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs tabular-nums whitespace-nowrap">
                      <span className="text-emerald-700" title="Judge PASS: no unsupported justification found">
                        P {j.PASS}
                      </span>{" "}
                      ·{" "}
                      <span className="text-rose-700" title="Judge FAIL: unsupported justification found">
                        F {j.FAIL}
                      </span>{" "}
                      ·{" "}
                      <span className="text-amber-700" title="Judge was uncertain — requires human review (not a PASS)">
                        R {j.REQUIRES_REVIEW}
                      </span>{" "}
                      ·{" "}
                      <span className="text-violet-700" title="Judge error (not a PASS)">
                        E {j.ERROR}
                      </span>
                      <div className="text-slate-500">not run {j.not_run}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs tabular-nums whitespace-nowrap">
                      {fmtInt(summary.total_input_tokens)} / {fmtInt(summary.total_output_tokens)}
                      {summary.cache_hits > 0 && <div className="text-slate-500">{summary.cache_hits} cache hit(s)</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs tabular-nums whitespace-nowrap">
                      {run.execution_mode === "mock" ? <span className="text-amber-800">$0 (mock)</span> : fmtUsd(summary.total_cost_usd, 4)}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col items-start gap-1">
                        <Button variant="ghost" onClick={() => setExpanded(expanded === run.run_id ? null : run.run_id)}>
                          {expanded === run.run_id ? "Hide cases" : "View cases"}
                        </Button>
                        <JudgeMissingButton run={run} missing={missingJudgeCount(row)} label="Judge missing" onDone={onChanged} />
                      </div>
                    </td>
                  </tr>
                  {expanded === run.run_id && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={13} className="px-3 py-3">
                        <RunCases runId={run.run_id} version={`${run.status}:${row.progress.traces_done}:${JSON.stringify(j)}`} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Per-case results of ONE run (GET /api/experiments/[id]) — evidence view before pairing. */
function RunCases({ runId, version }: { runId: string; version: string }) {
  const key = `${runId}|${version}`;
  const [state, setState] = useState<{ key: string; data?: RunDetailData; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void apiRequest<RunDetailData>("GET", `/api/experiments/${encodeURIComponent(runId)}`).then((res) => {
      if (alive) setState(res.ok ? { key, data: res.data } : { key, error: res.error });
    });
    return () => {
      alive = false;
    };
  }, [runId, key]);

  if (!state) return <p className="text-xs text-slate-500">Loading cases…</p>;
  if (state.error) return <p className="text-xs text-rose-700">{state.error}</p>;
  const d = state.data!;
  const evaluatorIds = d.evals[0]?.results.map((r) => r.evaluator_id) ?? [];
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-slate-600">
        One row per frozen case. Outcomes come from the validated deterministic checks; the judge column is experimental. Open a trace to
        inspect the evidence behind any outcome.
      </p>
      <table className="w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-3 font-medium">Case</th>
            {evaluatorIds.map((id) => (
              <th key={id} className="py-1 pr-3 font-medium">
                {humanize(id)}
              </th>
            ))}
            <th className="py-1 pr-3 font-medium">Pass-all</th>
            <th className="py-1 pr-3 font-medium">Judge (exp.)</th>
            <th className="py-1 font-medium">Trace</th>
          </tr>
        </thead>
        <tbody>
          {d.evals.map((e) => (
            <tr key={e.case_id} className="border-t border-slate-200/70">
              <td className="py-1 pr-3 font-mono font-semibold">
                {e.case_id}
                {e.execution_error && <div className="max-w-[220px] font-sans font-normal text-rose-700">{e.execution_error}</div>}
              </td>
              {evaluatorIds.map((id) => (
                <td key={id} className="py-1 pr-3">
                  <OutcomeChip outcome={e.results.find((r) => r.evaluator_id === id)?.outcome ?? null} />
                </td>
              ))}
              <td className="py-1 pr-3">
                {e.pass_all === null ? <Badge tone="purple">undetermined</Badge> : e.pass_all ? <Badge tone="green">PASS-ALL</Badge> : <Badge tone="red">NOT PASS-ALL</Badge>}
              </td>
              <td className="py-1 pr-3">{e.judge_verdict ? <OutcomeChip outcome={e.judge_verdict} /> : <span className="text-slate-400">not run</span>}</td>
              <td className="py-1">
                {e.trace_id ? (
                  <Link href={`/review/${e.trace_id}`} className="font-mono text-sky-700 underline">
                    {e.trace_id}
                  </Link>
                ) : (
                  <span className="text-slate-400">no trace</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
