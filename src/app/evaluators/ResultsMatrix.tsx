"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  EmptyState,
  JsonDetails,
  MockBadge,
  OutcomeBadge,
  SeverityBadge,
  SplitBadge,
  cx,
  fmtDateTime,
} from "@/components/ui";
import { ALL, DEFAULT_FILTERS, NO_RUN, filterRows, modeMix, orderChecks, plainName, type MatrixFilters } from "./matrix";
import { ExperimentalBadge, FilterSelect } from "./parts";
import type { EvaluatorCell, EvaluatorDefinition, EvaluatorResultRow, EvaluatorsResponse, JudgeCell } from "./types";

const JUDGE_COL = "__judge__";

/** Section C — every trace × every check. Collapsed by default (opened when the page is linked with ?run_id=). */
export function ResultsMatrix({ data, initialRunId }: { data: EvaluatorsResponse; initialRunId: string | null }) {
  return (
    <details id="results" open={Boolean(initialRunId)} className="group scroll-mt-4 rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-90">▶</span>
        <span className="group-open:hidden">Show results for every trace</span>
        <span className="hidden group-open:inline">Hide results for every trace</span>
        <span className="text-xs font-normal text-slate-500">({data.results.length})</span>
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-4 py-3">
        <MatrixBody data={data} initialRunId={initialRunId} />
      </div>
    </details>
  );
}

function MatrixBody({ data, initialRunId }: { data: EvaluatorsResponse; initialRunId: string | null }) {
  const [filters, setFilters] = useState<MatrixFilters>({ ...DEFAULT_FILTERS, runId: initialRunId ?? ALL });
  const [open, setOpen] = useState<{ trace_id: string; col: string } | null>(null);
  const evaluators = useMemo(() => orderChecks(data.deterministic), [data.deterministic]);

  const rows = useMemo(() => filterRows(data.results, filters), [data.results, filters]);
  const mix = modeMix(rows);
  const configs = useMemo(() => [...new Set(data.results.map((r) => r.agent_version))].sort(), [data.results]);
  const runIds = useMemo(
    () => (filters.runId !== ALL && filters.runId !== NO_RUN && !data.run_ids.includes(filters.runId) ? [...data.run_ids, filters.runId] : data.run_ids),
    [data.run_ids, filters.runId],
  );
  const set = (patch: Partial<MatrixFilters>) => {
    setOpen(null);
    setFilters((f) => ({ ...f, ...patch }));
  };
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const toggle = (trace_id: string, col: string) =>
    setOpen((o) => (o && o.trace_id === trace_id && o.col === col ? null : { trace_id, col }));

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Mode"
          value={filters.mode}
          onChange={(v) => set({ mode: v as MatrixFilters["mode"] })}
          options={[
            { value: "all", label: "All modes" },
            { value: "live", label: "LIVE only" },
            { value: "mock", label: "MOCK only (not evidence)" },
          ]}
        />
        <FilterSelect
          label="Agent config"
          value={filters.config}
          onChange={(v) => set({ config: v })}
          options={[{ value: ALL, label: "All configs" }, ...configs.map((c) => ({ value: c, label: c }))]}
        />
        <FilterSelect
          label="Experiment run"
          value={filters.runId}
          onChange={(v) => set({ runId: v })}
          options={[
            { value: ALL, label: "All runs" },
            { value: NO_RUN, label: "No run (ad-hoc)" },
            ...runIds.map((r) => ({ value: r, label: r })),
          ]}
        />
        <FilterSelect
          label="Split"
          value={filters.split}
          onChange={(v) => set({ split: v as MatrixFilters["split"] })}
          options={[
            { value: "all", label: "All splits" },
            { value: "dev", label: "dev" },
            { value: "heldout", label: "held-out" },
            { value: "custom", label: "custom (no split)" },
          ]}
        />
        {filtered && (
          <Button variant="ghost" onClick={() => set(DEFAULT_FILTERS)}>
            Clear filters
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
          <b className="text-slate-800">{rows.length}</b> of {data.results.length} traces
          {mix.live > 0 && (
            <>
              · <MockBadge mode="live" /> {mix.live}
            </>
          )}
          {mix.mock > 0 && (
            <>
              · <MockBadge mode="mock" /> {mix.mock}
            </>
          )}
        </span>
      </div>

      {data.results.length === 0 ? (
        <EmptyState title="No traces yet">
          Run a case in <Link className="text-sky-700 hover:underline" href="/review">Trace Review</Link> or{" "}
          <Link className="text-sky-700 hover:underline" href="/experiments">Experiments</Link>.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No traces match these filters">
          {filters.runId !== ALL && filters.runId !== NO_RUN && !data.run_ids.includes(filters.runId)
            ? `No stored trace belongs to run ${filters.runId}. `
            : ""}
          Clear the filters above.
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left align-bottom text-xs text-slate-500">
                  <th className="border-b border-slate-200 py-1.5 pr-3 font-medium">Trace</th>
                  <th className="border-b border-slate-200 pr-3 font-medium">Case / split</th>
                  <th className="border-b border-slate-200 pr-3 font-medium">Config · run</th>
                  <th className="border-b border-slate-200 pr-3 font-medium">Mode</th>
                  {evaluators.map((e) => (
                    <th key={e.evaluator_id} title={`${e.evaluator_id}: ${e.question}`} className="border-b border-slate-200 px-1.5 font-medium">
                      <div className="max-w-[120px] leading-tight text-slate-700">{plainName(e.evaluator_id)}</div>
                      <div className="mt-0.5">
                        <SeverityBadge severity={e.severity} />
                      </div>
                    </th>
                  ))}
                  <th className="border-b border-l-2 border-slate-200 border-l-violet-300 bg-violet-50/60 px-2 font-medium">
                    <div className="max-w-[120px] leading-tight text-slate-700">{plainName(data.judge.id)}</div>
                    <div className="mt-0.5">
                      <ExperimentalBadge />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.trace_id}>
                    <tr className="align-top hover:bg-slate-50/70">
                      <td className="border-b border-slate-100 py-2 pr-3">
                        <Link className="font-mono text-xs text-sky-700 hover:underline" href={`/review/${r.trace_id}`}>
                          {r.trace_id}
                        </Link>
                        <div className="text-[11px] text-slate-500">{fmtDateTime(r.timestamp)}</div>
                      </td>
                      <td className="border-b border-slate-100 pr-3">
                        <div className="font-medium text-slate-800">{r.case_id}</div>
                        <SplitBadge split={r.split} />
                      </td>
                      <td className="border-b border-slate-100 pr-3 text-xs text-slate-600">
                        <div>{r.agent_version}</div>
                        <div className="font-mono text-[11px] text-slate-500">{r.experiment_run_id ?? "no run"}</div>
                      </td>
                      <td className="border-b border-slate-100 pr-3">
                        <MockBadge mode={r.execution_mode} />
                        {r.execution_error && (
                          <div className="mt-1">
                            <Badge tone="red" title={r.execution_error}>execution error</Badge>
                          </div>
                        )}
                      </td>
                      {evaluators.map((e) => {
                        const cell = r.deterministic.find((d) => d.evaluator_id === e.evaluator_id);
                        const isOpen = open?.trace_id === r.trace_id && open.col === e.evaluator_id;
                        return (
                          <td key={e.evaluator_id} className="border-b border-slate-100 px-1.5 py-2">
                            {cell ? (
                              <CellButton active={isOpen} onClick={() => toggle(r.trace_id, e.evaluator_id)} label={`${e.evaluator_id} on ${r.trace_id}`}>
                                <OutcomeBadge outcome={cell.outcome} />
                              </CellButton>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="border-b border-l-2 border-slate-100 border-l-violet-300 bg-violet-50/40 px-2 py-2">
                        {r.judge ? (
                          <CellButton active={open?.trace_id === r.trace_id && open.col === JUDGE_COL} onClick={() => toggle(r.trace_id, JUDGE_COL)} label={`judge on ${r.trace_id}`}>
                            <OutcomeBadge outcome={r.judge.verdict} />
                          </CellButton>
                        ) : (
                          <span className="text-xs text-slate-400" title="No judge result under the current judge version for this trace">
                            not judged
                          </span>
                        )}
                      </td>
                    </tr>
                    {open?.trace_id === r.trace_id && (
                      <tr>
                        <td colSpan={5 + evaluators.length} className="border-b border-slate-200 bg-slate-50 px-3 py-3">
                          {open.col === JUDGE_COL && r.judge ? (
                            <JudgeDetail judge={r.judge} row={r} />
                          ) : (
                            <EvaluatorDetail
                              def={evaluators.find((e) => e.evaluator_id === open.col)}
                              cell={r.deterministic.find((d) => d.evaluator_id === open.col)}
                              row={r}
                            />
                          )}
                          <div className="mt-2 text-right">
                            <Button variant="ghost" onClick={() => setOpen(null)}>
                              Close
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function CellButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-label={`Show details: ${label}`}
      className={cx("rounded px-1 py-0.5 hover:bg-slate-200/70", active && "bg-slate-200 ring-1 ring-slate-400")}
    >
      {children}
    </button>
  );
}

function EvaluatorDetail({ def, cell, row }: { def: EvaluatorDefinition | undefined; cell: EvaluatorCell | undefined; row: EvaluatorResultRow }) {
  if (!def || !cell) return <p className="text-sm text-slate-500">No result for this check.</p>;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-xs font-semibold">{def.evaluator_id}</code>
        <span className="text-xs text-slate-500">v{cell.evaluator_version}</span>
        <OutcomeBadge outcome={cell.outcome} />
        <SeverityBadge severity={cell.severity} />
        <MockBadge mode={row.execution_mode} />
        <span className="text-xs text-slate-500">
          on case <b>{row.case_id}</b> · trace <code className="font-mono">{row.trace_id}</code>
        </span>
      </div>
      <p className="text-slate-600">
        <span className="font-medium text-slate-800">Question:</span> {def.question}
      </p>
      <p>
        <span className="font-medium text-slate-800">What the check found:</span> {cell.summary}
      </p>
      <JsonDetails summary="Exact values compared (recomputed vs stated, tolerances)" value={cell.details} open />
    </div>
  );
}

function JudgeDetail({ judge, row }: { judge: JudgeCell; row: EvaluatorResultRow }) {
  const out = judge.output;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-800">LLM judge</span>
        <ExperimentalBadge />
        <OutcomeBadge outcome={judge.verdict} />
        <MockBadge mode={judge.execution_mode} />
        <span className="text-xs text-slate-500">
          version <code className="font-mono">{judge.judge_version}</code> · {fmtDateTime(judge.created_at)} · case <b>{row.case_id}</b>
        </span>
      </div>
      <p className="text-xs text-slate-500">
        A judge finding — not a human label, never gold truth.
      </p>
      {judge.error && <p className="text-rose-700">Error: {judge.error}</p>}
      {out && (
        <div className="space-y-1.5">
          <p>
            <span className="font-medium text-slate-800">Explanation:</span> {out.explanation}
          </p>
          {out.uncertainty_reason && (
            <p className="text-amber-800">
              <span className="font-medium">Why the judge could not decide:</span> {out.uncertainty_reason}
            </p>
          )}
          <div>
            <span className="font-medium text-slate-800">Relevant claims:</span>{" "}
            {out.relevant_claims.length === 0 ? (
              <span className="text-slate-500">none listed</span>
            ) : (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {out.relevant_claims.map((c, i) => (
                  <li key={i}>“{c}”</li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium text-slate-800">Evidence IDs compared:</span>
            {out.evidence_ids.length === 0 ? (
              <span className="text-slate-500">none listed</span>
            ) : (
              out.evidence_ids.map((id) => (
                <code key={id} className="rounded bg-white px-1 font-mono text-xs ring-1 ring-slate-200">
                  {id}
                </code>
              ))
            )}
          </div>
        </div>
      )}
      <Link className="text-xs font-medium text-sky-700 hover:underline" href={`/review/${row.trace_id}`}>
        Review this trace →
      </Link>
    </div>
  );
}
