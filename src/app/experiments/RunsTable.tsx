"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { Badge, Button, MockBadge, Ratio, cx, fmtDateTime } from "@/components/ui";
import { JudgeMissingButton } from "./JudgeMissingButton";
import { isCurrentContent, pairBlocker } from "./pairing";
import { apiRequest } from "./request";
import { Dot, agentCost, checkLabel, humanize } from "./shared";
import type { EvaluatorInfo, ExperimentsData, RunDetailData, RunRow } from "./types";

export const missingJudgeCount = (r: RunRow) => Math.max(0, r.summary.judge.not_run - (r.summary.n_cases - r.summary.n_with_trace));

function StatusCell({ row, stalled }: { row: RunRow; stalled: boolean }) {
  const { run, progress } = row;
  if (run.status === "running") {
    const pct = progress.cases ? Math.round((progress.traces_done / progress.cases) * 100) : 0;
    return (
      <div className="min-w-[100px]">
        <Badge tone="amber">running {progress.traces_done}/{progress.cases}</Badge>
        <div className="mt-1 h-1.5 w-full rounded bg-slate-100">
          <div className="h-1.5 rounded bg-amber-500" style={{ width: `${pct}%` }} />
        </div>
        {stalled && <div className="mt-0.5 text-[11px] text-rose-700">Stalled over 60 min — polling stopped.</div>}
      </div>
    );
  }
  if (run.status === "failed") {
    return (
      <Badge tone="red" title={run.notes ?? undefined}>
        ✕ failed {progress.traces_done}/{progress.cases}
      </Badge>
    );
  }
  return (
    <Badge tone="green">
      ✓ done {progress.traces_done}/{progress.cases}
    </Badge>
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

  if (data.runs.length === 0) return <p className="text-sm text-slate-500">No runs yet — use New run above.</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Newest first. Pick a Before and an After run on the same test set to compare them.</span>
        {(baselineId || candidateId) && (
          <Button variant="ghost" onClick={onClear}>
            Clear selection
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="py-1.5 pr-2 font-medium" title="Baseline side of the comparison">
                Before
              </th>
              <th className="py-1.5 pr-3 font-medium" title="Candidate side of the comparison">
                After
              </th>
              <th className="py-1.5 pr-3 font-medium">Run</th>
              <th className="py-1.5 pr-3 font-medium">Version</th>
              <th className="py-1.5 pr-3 font-medium">Test set</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium" title="Cases where every code check passes">
                Pass-all
              </th>
              <th className="py-1.5 pr-3 font-medium" title="Critical-severity check failures across all cases">
                Critical fails
              </th>
              <th className="py-1.5 pr-3 font-medium text-violet-800" title="Experimental judge verdicts — not part of pass-all">
                AI judge (exp.)
              </th>
              <th className="py-1.5 pr-3 font-medium" title="Estimated agent API cost; cache hits and mock runs cost $0">
                Cost
              </th>
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data.runs.map((row) => {
              const { run, summary } = row;
              const bBlock = pairBlocker(row, candidate, data.frozen_sets);
              const cBlock = pairBlocker(row, baseline, data.frozen_sets);
              const current = isCurrentContent(row, data.frozen_sets);
              const selected = run.run_id === baselineId || run.run_id === candidateId;
              const j = summary.judge;
              return (
                <Fragment key={run.run_id}>
                  <tr className={cx("border-b border-slate-50", selected && "bg-sky-50/70", !current && "text-slate-400")}>
                    <td className="py-1.5 pr-2">
                      <input
                        type="radio"
                        name="baseline-run"
                        aria-label={`Use ${run.run_id} as Before`}
                        checked={baselineId === run.run_id}
                        disabled={Boolean(bBlock)}
                        title={bBlock ?? "Use as Before (baseline side)"}
                        onChange={() => onSelectBaseline(run.run_id)}
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <input
                        type="radio"
                        name="candidate-run"
                        aria-label={`Use ${run.run_id} as After`}
                        checked={candidateId === run.run_id}
                        disabled={Boolean(cBlock)}
                        title={cBlock ?? "Use as After (candidate side)"}
                        onChange={() => onSelectCandidate(run.run_id)}
                      />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <code className="font-mono text-xs">{run.run_id}</code>{" "}
                      <span className="text-xs text-slate-500">{fmtDateTime(run.created_at)}</span>
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <Badge tone={row.config_role === "corrected" ? "blue" : "neutral"} title={run.agent_config_id}>
                        {row.config_label}
                      </Badge>{" "}
                      <MockBadge mode={run.execution_mode} />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="font-mono text-xs" title={`content hash ${run.frozen_set_hash}`}>
                        {run.frozen_set_id}
                      </span>
                      {!current && (
                        <span className="ml-1">
                          <Badge tone="neutral" title="Recorded on case/policy content that has since changed — shown, but not comparable">
                            old cases
                          </Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <StatusCell row={row} stalled={isStalled(row)} />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {run.status === "running" ? (
                        <span className="text-xs text-slate-500">—</span>
                      ) : (
                        <>
                          <span className="tabular-nums">
                            {summary.pass_all_count}/{summary.n_cases}
                          </span>{" "}
                          <span className="text-xs text-slate-500">
                            (<Ratio value={summary.pass_all_rate} undefinedReason="The run has no cases" />)
                          </span>
                          {summary.n_incomplete > 0 && <div className="text-[11px] text-violet-700">{summary.n_incomplete} incomplete</div>}
                        </>
                      )}
                    </td>
                    <td className={cx("py-1.5 pr-3 tabular-nums", summary.critical_failure_count > 0 && current && "font-semibold text-rose-700")}>
                      {summary.critical_failure_count}
                    </td>
                    <td className="py-1.5 pr-3 text-xs whitespace-nowrap tabular-nums">
                      <span title="Judge PASS">✓ {j.PASS}</span> · <span title="Judge FAIL">✕ {j.FAIL}</span>
                      {j.REQUIRES_REVIEW > 0 && <span title="Needs human review (not a pass)"> · ? {j.REQUIRES_REVIEW}</span>}
                      {j.ERROR > 0 && <span title="Judge error (not a pass)"> · ! {j.ERROR}</span>}
                      {j.not_run > 0 && <span className="text-slate-500"> · not run {j.not_run}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-xs whitespace-nowrap tabular-nums">{agentCost(summary, run.execution_mode)}</td>
                    <td className="py-1.5">
                      <div className="flex items-start gap-1 whitespace-nowrap">
                        <Button variant="ghost" onClick={() => setExpanded(expanded === run.run_id ? null : run.run_id)}>
                          {expanded === run.run_id ? "Hide" : "Cases"}
                        </Button>
                        <JudgeMissingButton run={run} missing={missingJudgeCount(row)} serverMode={data.mode.mode} onDone={onChanged} />
                      </div>
                    </td>
                  </tr>
                  {expanded === run.run_id && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={11} className="px-3 py-3">
                        <RunCases
                          runId={run.run_id}
                          evaluators={data.evaluators}
                          version={`${run.status}:${row.progress.traces_done}:${JSON.stringify(j)}`}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Per-case results of ONE run (GET /api/experiments/[id]). */
function RunCases({ runId, evaluators, version }: { runId: string; evaluators: EvaluatorInfo[]; version: string }) {
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
  // Columns come from the evaluator list (plus any extra ids in the results), never from one case — a case without a trace has no results.
  const known = evaluators.map((e) => e.evaluator_id);
  const extra = [...new Set(d.evals.flatMap((e) => e.results.map((r) => r.evaluator_id)))].filter((id) => !known.includes(id));
  const evaluatorIds = [...known, ...extra];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-3 font-medium">Case</th>
            {evaluatorIds.map((id) => (
              <th key={id} className="py-1 pr-3 text-center font-medium" title={humanize(id)}>
                {checkLabel(id)}
              </th>
            ))}
            <th className="py-1 pr-3 text-center font-medium">Pass-all</th>
            <th className="py-1 pr-3 text-center font-medium text-violet-800">AI judge (exp.)</th>
            <th className="py-1 font-medium">Trace</th>
          </tr>
        </thead>
        <tbody>
          {d.evals.map((e) => (
            <tr key={e.case_id} className="border-t border-slate-200/70">
              <td className="py-1 pr-3 font-mono font-semibold">
                {e.case_id}
                {e.execution_error && <div className="max-w-[220px] truncate font-sans font-normal text-rose-700" title={e.execution_error}>{e.execution_error}</div>}
              </td>
              {evaluatorIds.map((id) => (
                <td key={id} className="py-1 pr-3 text-center">
                  <Dot outcome={e.results.find((r) => r.evaluator_id === id)?.outcome ?? null} />
                </td>
              ))}
              <td className="py-1 pr-3 text-center">
                <Dot outcome={e.pass_all === null ? null : e.pass_all ? "PASS" : "FAIL"} />
              </td>
              <td className="py-1 pr-3 text-center">
                <Dot outcome={e.judge_verdict} />
              </td>
              <td className="py-1">
                {e.trace_id ? (
                  <Link href={`/review/${e.trace_id}`} className="font-mono text-sky-700 hover:underline">
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
