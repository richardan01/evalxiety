"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Callout, Card, EmptyState, MockBadge, Ratio, SeverityBadge, SplitBadge, Stat, cx, fmtUsd } from "@/components/ui";
import type { CaseChange, EvaluatorTally, PairedCase, RunSummary } from "@/lib/metrics/experiments";
import { JudgeMissingButton } from "./JudgeMissingButton";
import { apiRequest } from "./request";
import { missingJudgeCount } from "./RunsTable";
import { ChangeBadge, ModePair, OutcomeChip, changeHelp, fmtInt, fmtMs, humanize, shortHash } from "./shared";
import type { CompareData, EvaluatorInfo, RunRow } from "./types";

type Filter = "all" | "changed" | CaseChange;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "changed", label: "Fixed + regressed" },
  { id: "regressed", label: "Regressed" },
  { id: "fixed", label: "Fixed" },
  { id: "still_failing", label: "Still failing" },
  { id: "still_passing", label: "Still passing" },
  { id: "incomplete", label: "Incomplete" },
];

export function ComparisonView({
  baseline,
  candidate,
  evaluators,
  refreshKey,
  onChanged,
}: {
  baseline: RunRow;
  candidate: RunRow;
  evaluators: EvaluatorInfo[];
  refreshKey: string;
  onChanged: () => void;
}) {
  const ids = `${baseline.run.run_id}|${candidate.run.run_id}`;
  const [state, setState] = useState<{ ids: string; data?: CompareData; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const url = `/api/experiments/compare?baseline=${encodeURIComponent(baseline.run.run_id)}&candidate=${encodeURIComponent(candidate.run.run_id)}`;
    void apiRequest<CompareData>("GET", url).then((res) => {
      if (alive) setState(res.ok ? { ids, data: res.data } : { ids, error: res.error });
    });
    return () => {
      alive = false;
    };
  }, [ids, refreshKey, baseline.run.run_id, candidate.run.run_id]);

  // Keep showing the previous result for the same pair while a background refresh is in flight.
  const current = state?.ids === ids ? state : null;
  if (!current) return <p className="text-sm text-slate-500">Loading paired comparison…</p>;
  if (current.error) {
    return (
      <Callout tone="red" title="Comparison not available">
        {current.error}
      </Callout>
    );
  }
  return <ComparisonBody d={current.data!} baselineRow={baseline} candidateRow={candidate} evaluators={evaluators} onChanged={onChanged} />;
}

function ComparisonBody({
  d,
  baselineRow,
  candidateRow,
  evaluators,
  onChanged,
}: {
  d: CompareData;
  baselineRow: RunRow;
  candidateRow: RunRow;
  evaluators: EvaluatorInfo[];
  onChanged: () => void;
}) {
  const cmp = d.comparison;
  const bs = cmp.baseline_summary;
  const cs = cmp.candidate_summary;
  const bMode = d.baseline.run.execution_mode;
  const cMode = d.candidate.run.execution_mode;
  const anyMock = bMode === "mock" || cMode === "mock";
  const notDone = [d.baseline.run, d.candidate.run].filter((r) => r.status !== "completed");
  const sameConfig = d.baseline.run.agent_config_id === d.candidate.run.agent_config_id;
  const modes = <ModePair baseline={bMode} candidate={cMode} />;

  return (
    <div className="space-y-5">
      {/* What is being compared */}
      <Card title="What is being compared" actions={modes}>
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <RunIdentity side="Baseline" run={d.baseline.run} label={d.baseline.config.label} />
          <RunIdentity side="Candidate" run={d.candidate.run} label={d.candidate.config.label} />
          <div>
            <div className="text-xs font-medium text-slate-500">Frozen set (identical in both runs)</div>
            <div className="font-mono text-xs font-semibold">{d.baseline.run.frozen_set_id}</div>
            <div className="font-mono text-[11px] text-slate-500" title={d.baseline.run.frozen_set_hash}>
              hash {shortHash(d.baseline.run.frozen_set_hash)}… = {shortHash(d.candidate.run.frozen_set_hash)}…
            </div>
            <div className="text-xs text-slate-500">{cmp.pairs.length} paired cases (synthetic)</div>
          </div>
        </div>
      </Card>

      <div className="space-y-2">
        {d.mode_mismatch && (
          <Callout tone="red" title="Execution modes differ">
            Baseline is {bMode.toUpperCase()} and candidate is {cMode.toUpperCase()}. Differences may come from the mock agent rather than the
            configuration change — do not use this comparison as evidence. Compare two runs with the same mode.
          </Callout>
        )}
        {anyMock && !d.mode_mismatch && (
          <Callout tone="amber" title="MOCK results">
            At least one run used the deterministic mock agent (and mock judge, if judged). Mock runs
            exercise the pipeline and UI but are not evidence about the real model and never count as release evidence.
          </Callout>
        )}
        {notDone.length > 0 && (
          <Callout tone="amber" title="Not every run has completed">
            {notDone.map((r) => `${r.run_id} is ${r.status}`).join("; ")}. Cases without a trace are shown as INCOMPLETE and are not counted as
            fixed or regressed.
          </Callout>
        )}
        {sameConfig && (
          <Callout tone="slate" title="Same configuration on both sides">
            Both runs use <code className="font-mono">{d.baseline.run.agent_config_id}</code>. This measures run-to-run variation, not the effect
            of the change.
          </Callout>
        )}
        <Callout tone="amber" title="Read the evidence, not just the headline">
          Do not conclude the change worked because one number went up — inspect case-level evidence.
        </Callout>
      </div>

      {/* A. Headline */}
      <SubHeading letter="A" title="Headline: what changed between the two runs">
        Counts come from the validated deterministic checks only. <b>Pass-all</b> means every applicable validated check passes for a case;
        cases with no trace count as not passing. The experimental judge is excluded. There is no weighted or composite score.
      </SubHeading>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Pass-all rate (baseline → candidate)"
          value={
            <span>
              <Ratio value={bs.pass_all_rate} undefinedReason="No cases" /> <span className="text-slate-400">→</span>{" "}
              <Ratio value={cs.pass_all_rate} undefinedReason="No cases" />
            </span>
          }
          hint={`${bs.pass_all_count}/${bs.n_cases} → ${cs.pass_all_count}/${cs.n_cases} cases. Pass-all means every applicable validated check passes.`}
        />
        <Stat
          label="Critical check failures (baseline → candidate)"
          value={`${bs.critical_failure_count} → ${cs.critical_failure_count}`}
          tone={cs.critical_failure_count > 0 ? "red" : undefined}
          hint={`Critical-severity check FAILs summed over cases; in ${bs.cases_with_critical_failure.length} → ${cs.cases_with_critical_failure.length} case(s).`}
        />
        <Stat
          label="Fixed cases"
          value={cmp.fixed.length}
          tone={cmp.fixed.length > 0 ? "green" : undefined}
          hint={cmp.fixed.length ? `Failed pass-all before, pass now: ${cmp.fixed.join(", ")}` : "No case went from failing to passing pass-all."}
        />
        <Stat
          label="New regressions (check level)"
          value={cmp.new_regressions.length}
          tone={cmp.new_critical_regressions.length > 0 ? "red" : cmp.new_regressions.length > 0 ? "amber" : undefined}
          hint={
            <>
              A check that PASSED in the baseline now FAILS or errors. {cmp.regressed.length} case(s) lost pass-all.{" "}
              <b className={cmp.new_critical_regressions.length ? "text-rose-700" : undefined}>
                {cmp.new_critical_regressions.length} CRITICAL
              </b>
              .
            </>
          }
        />
        <Stat
          label="Remaining failures"
          value={cmp.still_failing.length}
          tone={cmp.still_failing.length > 0 ? "amber" : undefined}
          hint={cmp.still_failing.length ? `Fail pass-all in both runs: ${cmp.still_failing.join(", ")}` : "No case fails in both runs."}
        />
        <Stat
          label="Incomplete cases"
          value={cmp.incomplete.length}
          tone={cmp.incomplete.length > 0 ? "amber" : undefined}
          hint={
            cmp.incomplete.length
              ? `Missing trace or an execution/evaluator error in either run: ${cmp.incomplete.join(", ")}. Not classified.`
              : "Every case has a usable trace in both runs."
          }
        />
      </div>
      {cmp.new_critical_regressions.length > 0 && (
        <Callout tone="red" title={`New CRITICAL regressions (${cmp.new_critical_regressions.length})`}>
          <ul className="list-disc pl-5">
            {cmp.new_critical_regressions.map((r) => {
              const pair = cmp.pairs.find((p) => p.case_id === r.case_id);
              const ch = pair?.evaluator_changes.find((x) => x.evaluator_id === r.evaluator_id);
              return (
                <li key={`${r.case_id}-${r.evaluator_id}`}>
                  <b>{r.case_id}</b> — {humanize(r.evaluator_id)}: {ch?.from ?? "—"} → {ch?.to ?? "—"}{" "}
                  {pair?.candidate.trace_id && (
                    <Link className="underline" href={`/review/${pair.candidate.trace_id}`}>
                      open candidate trace
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Callout>
      )}

      {/* B. Case-level paired table */}
      <SubHeading letter="B" title="Case by case: the evidence behind the headline">
        Each row is one frozen case run by both configurations. Each check column shows <b>baseline → candidate</b>; green cells were fixed,
        red cells regressed. Open the traces to see exactly what the agent did.
      </SubHeading>
      <PairedCaseTable d={d} evaluators={evaluators} modes={modes} />

      {/* C. Per check */}
      <SubHeading letter="C" title="Pass rate per check (one check per failure mode)">
        Pass rate = pass / (pass + fail + error). Not-applicable results are left out of the denominator; errors count against. Shown side by
        side — never averaged into one score.
      </SubHeading>
      <PerCheckTable d={d} evaluators={evaluators} modes={modes} />

      {/* D. Judge */}
      <SubHeading letter="D" title="Experimental judge findings (not part of pass-all)">
        The LLM judge checks one criterion: is every pricing claim supported by the supplied evidence? It is EXPERIMENTAL — trust it only as far
        as its calibration against human labels (Evaluators tab) supports. REQUIRES REVIEW and ERROR are never treated as PASS.
      </SubHeading>
      <JudgeTable d={d} baselineRow={baselineRow} candidateRow={candidateRow} modes={modes} onChanged={onChanged} />

      {/* E. Cost & latency */}
      <SubHeading letter="E" title="Cost and latency">
        Agent calls only (judge calls are not included). Cost is estimated from token usage; cache hits replay a stored response and cost $0.
        {anyMock ? " Mock-run tokens and latency come from the mock agent and say nothing about the real model." : ""}
      </SubHeading>
      <CostTable bs={bs} cs={cs} bMode={bMode} cMode={cMode} />
    </div>
  );
}

function SubHeading({ letter, title, children }: { letter: string; title: string; children: ReactNode }) {
  return (
    <div className="pt-2">
      <h3 className="text-sm font-semibold text-slate-900">
        <span className="mr-1.5 text-slate-400">{letter}.</span>
        {title}
      </h3>
      <p className="mt-0.5 max-w-4xl text-xs text-slate-600">{children}</p>
    </div>
  );
}

function RunIdentity({ side, run, label }: { side: string; run: CompareData["baseline"]["run"]; label: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{side}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <b>{label}</b> <MockBadge mode={run.execution_mode} />
        {run.status !== "completed" && <Badge tone={run.status === "failed" ? "red" : "amber"}>{run.status.toUpperCase()}</Badge>}
      </div>
      <div className="font-mono text-[11px] text-slate-500">
        {run.run_id} · {run.agent_config_id}
      </div>
    </div>
  );
}

function PassAllChip({ value }: { value: boolean | null }) {
  if (value === null) return <Badge tone="purple" title="No trace — cannot be determined">?</Badge>;
  return value ? <Badge tone="green">PASS</Badge> : <Badge tone="red">FAIL</Badge>;
}

function TraceLink({ id, side }: { id: string | null; side: string }) {
  if (!id) return <span className="text-slate-400">no {side} trace</span>;
  return (
    <Link href={`/review/${id}`} className="whitespace-nowrap text-sky-700 underline" title={id}>
      {side} trace
    </Link>
  );
}

function PairedCaseTable({ d, evaluators, modes }: { d: CompareData; evaluators: EvaluatorInfo[]; modes: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const cmp = d.comparison;
  const evalIds = cmp.pairs[0]?.evaluator_changes.map((x) => x.evaluator_id) ?? evaluators.map((e) => e.evaluator_id);
  const evalInfo = new Map(evaluators.map((e) => [e.evaluator_id, e]));
  const matches = (p: PairedCase) =>
    filter === "all" ? true : filter === "changed" ? p.change === "fixed" || p.change === "regressed" : p.change === filter;
  const count = (f: Filter) => cmp.pairs.filter((p) => (f === "all" ? true : f === "changed" ? p.change === "fixed" || p.change === "regressed" : p.change === f)).length;
  const rows = cmp.pairs.filter(matches);

  return (
    <Card
      title="Paired case table"
      subtitle="Change is decided by pass-all: fixed = fail → pass, regressed = pass → fail. A row is highlighted red when a CRITICAL check newly regressed."
      actions={modes}
    >
      <div className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cx(
              "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
              filter === f.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
            )}
          >
            {f.label} ({count(f.id)})
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No cases match this filter" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="py-1.5 pr-3 font-medium">Case</th>
                {evalIds.map((id) => (
                  <th key={id} className="py-1.5 pr-3 font-medium" title={evalInfo.get(id)?.question}>
                    <div>{humanize(id)}</div>
                    <SeverityBadge severity={evalInfo.get(id)?.severity} />
                  </th>
                ))}
                <th className="py-1.5 pr-3 font-medium">Pass-all</th>
                <th className="py-1.5 pr-3 font-medium">Change</th>
                <th className="py-1.5 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const meta = d.case_meta[p.case_id];
                const critical = p.new_critical_regressions.length > 0;
                return (
                  <tr key={p.case_id} className={cx("border-b border-slate-50 align-top", critical && "bg-rose-50")}>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold">{p.case_id}</span>
                        <SplitBadge split={meta?.split ?? null} />
                      </div>
                      {meta && <div className="max-w-[220px] text-slate-500">{meta.title}</div>}
                      {p.baseline.execution_error && <div className="max-w-[220px] text-rose-700">baseline: {p.baseline.execution_error}</div>}
                      {p.candidate.execution_error && <div className="max-w-[220px] text-rose-700">candidate: {p.candidate.execution_error}</div>}
                    </td>
                    {evalIds.map((id) => {
                      const ch = p.evaluator_changes.find((x) => x.evaluator_id === id);
                      return (
                        <td
                          key={id}
                          className={cx(
                            "py-2 pr-3 whitespace-nowrap",
                            ch?.kind === "fixed" && "bg-emerald-50",
                            ch?.kind === "regressed" && "bg-rose-100",
                          )}
                          title={ch?.kind === "unchanged" ? "unchanged" : ch?.kind}
                        >
                          <span className="sr-only">baseline </span>
                          <OutcomeChip outcome={ch?.from ?? null} />
                          <span className="mx-1 text-slate-400">→</span>
                          <span className="sr-only">candidate </span>
                          <OutcomeChip outcome={ch?.to ?? null} />
                        </td>
                      );
                    })}
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <PassAllChip value={p.baseline.pass_all} />
                      <span className="mx-1 text-slate-400">→</span>
                      <PassAllChip value={p.candidate.pass_all} />
                    </td>
                    <td className="py-2 pr-3">
                      <div title={changeHelp(p.change)}>
                        <ChangeBadge change={p.change} />
                      </div>
                      {critical && (
                        <div className="mt-1">
                          <Badge tone="red" title="A critical check passed in the baseline and fails in the candidate">
                            NEW CRITICAL REGRESSION
                          </Badge>
                          <div className="mt-0.5 text-rose-800">{p.new_critical_regressions.map(humanize).join(", ")}</div>
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col gap-0.5">
                        <TraceLink id={p.baseline.trace_id} side="baseline" />
                        <TraceLink id={p.candidate.trace_id} side="candidate" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Legend: PASS / FAIL / N/A (not applicable to this case) / ERROR (evaluator could not decide — counts as not passing) / — (no trace).
      </p>
    </Card>
  );
}

function TallyCell({ t }: { t: EvaluatorTally }) {
  const den = t.pass + t.fail + t.error;
  return (
    <>
      <div className="font-medium">
        <Ratio value={t.pass_rate} undefinedReason="No applicable results (all N/A or no traces)" />
      </div>
      <div className="tabular-nums text-slate-500">
        {t.pass} / {den} applicable
      </div>
      <div className="text-[11px] text-slate-500">
        fail {t.fail} · error {t.error} · n/a {t.not_applicable}
      </div>
    </>
  );
}

function PerCheckTable({ d, evaluators, modes }: { d: CompareData; evaluators: EvaluatorInfo[]; modes: ReactNode }) {
  const cmp = d.comparison;
  const evalInfo = new Map(evaluators.map((e) => [e.evaluator_id, e]));
  return (
    <Card title="Validated deterministic checks" subtitle="Each check is validated by unit tests and targets one failure mode." actions={modes}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="py-1.5 pr-3 font-medium">Check → targeted failure mode</th>
              <th className="py-1.5 pr-3 font-medium">Severity</th>
              <th className="py-1.5 pr-3 font-medium">Baseline pass rate</th>
              <th className="py-1.5 pr-3 font-medium">Candidate pass rate</th>
              <th className="py-1.5 font-medium">Cases fixed / regressed on this check</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(cmp.per_evaluator).map(([id, t]) => {
              const info = evalInfo.get(id);
              const fixed = cmp.pairs.filter((p) => p.evaluator_changes.some((x) => x.evaluator_id === id && x.kind === "fixed")).length;
              const regressed = cmp.pairs.filter((p) => p.evaluator_changes.some((x) => x.evaluator_id === id && x.kind === "regressed")).length;
              return (
                <tr key={id} className="border-b border-slate-50 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-900">{humanize(id)}</div>
                    {info && (
                      <>
                        <div className="text-slate-500" title="Taxonomy category from the seed list — a hypothesis until human review observes it (Trace Review / Overview)">
                          → failure mode: {humanize(info.failure_mode_id)} <span className="text-[10px] uppercase">(seed hypothesis)</span>
                        </div>
                        <div className="max-w-sm text-[11px] text-slate-500">{info.question}</div>
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <SeverityBadge severity={info?.severity} />
                    {info?.blocking && (
                      <div className="mt-0.5">
                        <Badge tone="slate">blocking</Badge>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <TallyCell t={t.baseline} />
                  </td>
                  <td className="py-2 pr-3">
                    <TallyCell t={t.candidate} />
                  </td>
                  <td className="py-2 tabular-nums">
                    <span className={fixed ? "text-emerald-700" : "text-slate-500"}>{fixed} fixed</span> ·{" "}
                    <span className={regressed ? (info?.severity === "critical" ? "font-semibold text-rose-700" : "text-rose-700") : "text-slate-500"}>
                      {regressed} regressed
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function JudgeTally({ s }: { s: RunSummary }) {
  const j = s.judge;
  return (
    <span className="text-xs tabular-nums">
      <span className="text-emerald-700">PASS {j.PASS}</span> · <span className="text-rose-700">FAIL {j.FAIL}</span> ·{" "}
      <span className="text-amber-700">REQUIRES REVIEW {j.REQUIRES_REVIEW}</span> · <span className="text-violet-700">ERROR {j.ERROR}</span> ·{" "}
      <span className="text-slate-500">not run {j.not_run}</span>
    </span>
  );
}

function JudgeTable({
  d,
  baselineRow,
  candidateRow,
  modes,
  onChanged,
}: {
  d: CompareData;
  baselineRow: RunRow;
  candidateRow: RunRow;
  modes: ReactNode;
  onChanged: () => void;
}) {
  const cmp = d.comparison;
  const bs = cmp.baseline_summary;
  const cs = cmp.candidate_summary;
  const nothing = bs.judge.not_run === bs.n_cases && cs.judge.not_run === cs.n_cases;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Experimental judge: unsupported_pricing_justification <Badge tone="purple">EXPERIMENTAL</Badge>
        </span>
      }
      subtitle="Judge FAIL = the judge found a pricing claim not supported by the evidence. Verdicts never change pass-all or the headline numbers."
      actions={modes}
    >
      <div className="mb-3 grid gap-2 text-sm md:grid-cols-2">
        <div className="rounded border border-slate-200 px-3 py-2">
          <div className="mb-1 text-xs font-medium text-slate-500">
            Baseline ({d.baseline.config.label}) <MockBadge mode={d.baseline.run.execution_mode} />
          </div>
          <JudgeTally s={bs} />
          <div className="mt-2">
            <JudgeMissingButton run={baselineRow.run} missing={missingJudgeCount(baselineRow)} label="Judge missing baseline traces" onDone={onChanged} />
          </div>
        </div>
        <div className="rounded border border-slate-200 px-3 py-2">
          <div className="mb-1 text-xs font-medium text-slate-500">
            Candidate ({d.candidate.config.label}) <MockBadge mode={d.candidate.run.execution_mode} />
          </div>
          <JudgeTally s={cs} />
          <div className="mt-2">
            <JudgeMissingButton run={candidateRow.run} missing={missingJudgeCount(candidateRow)} label="Judge missing candidate traces" onDone={onChanged} />
          </div>
        </div>
      </div>
      {nothing ? (
        <EmptyState title="No judge results for these runs yet">
          Use “Judge missing … traces” above, or tick “Also run the experimental judge” when starting a run. Only results for the current judge
          version are shown.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="py-1.5 pr-3 font-medium">Case</th>
                <th className="py-1.5 pr-3 font-medium">Baseline judge verdict</th>
                <th className="py-1.5 pr-3 font-medium">Candidate judge verdict</th>
                <th className="py-1.5 font-medium">Inspect the trace yourself</th>
              </tr>
            </thead>
            <tbody>
              {cmp.pairs.map((p) => (
                <tr key={p.case_id} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 font-mono font-semibold">{p.case_id}</td>
                  <td className="py-1.5 pr-3">
                    {p.baseline.judge_verdict ? <OutcomeChip outcome={p.baseline.judge_verdict} /> : <span className="text-slate-400">not run</span>}
                  </td>
                  <td className="py-1.5 pr-3">
                    {p.candidate.judge_verdict ? <OutcomeChip outcome={p.candidate.judge_verdict} /> : <span className="text-slate-400">not run</span>}
                  </td>
                  <td className="py-1.5">
                    <span className="flex gap-3">
                      <TraceLink id={p.baseline.trace_id} side="baseline" />
                      <TraceLink id={p.candidate.trace_id} side="candidate" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CostTable({ bs, cs, bMode, cMode }: { bs: RunSummary; cs: RunSummary; bMode: "live" | "mock"; cMode: "live" | "mock" }) {
  const cost = (s: RunSummary, mode: "live" | "mock") => (mode === "mock" ? "$0 (mock — no spend)" : fmtUsd(s.total_cost_usd, 4));
  const rows: Array<[string, ReactNode, ReactNode]> = [
    ["Execution mode", <MockBadge key="b" mode={bMode} />, <MockBadge key="c" mode={cMode} />],
    ["Total input tokens", fmtInt(bs.total_input_tokens), fmtInt(cs.total_input_tokens)],
    ["Total output tokens", fmtInt(bs.total_output_tokens), fmtInt(cs.total_output_tokens)],
    ["Estimated agent cost", cost(bs, bMode), cost(cs, cMode)],
    ["Mean latency", fmtMs(bs.mean_latency_ms), fmtMs(cs.mean_latency_ms)],
    ["p50 latency", fmtMs(bs.p50_latency_ms), fmtMs(cs.p50_latency_ms)],
    ["Max latency", fmtMs(bs.max_latency_ms), fmtMs(cs.max_latency_ms)],
    ["Cache hits (traces)", `${bs.cache_hits} / ${bs.n_with_trace}`, `${cs.cache_hits} / ${cs.n_with_trace}`],
  ];
  return (
    <Card title="Cost and latency per run">
      <table className="w-full max-w-2xl text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr className="border-b border-slate-100">
            <th className="py-1.5 pr-3 font-medium">Metric</th>
            <th className="py-1.5 pr-3 font-medium">Baseline</th>
            <th className="py-1.5 font-medium">Candidate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, b, c]) => (
            <tr key={k} className="border-b border-slate-50">
              <td className="py-1.5 pr-3 text-slate-500">{k}</td>
              <td className="py-1.5 pr-3 tabular-nums">{b}</td>
              <td className="py-1.5 tabular-nums">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
