"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, InfoTip, Ratio, cx, fmtUsd } from "@/components/ui";
import type { CaseChange, EvaluatorTally, PairedCase, RunSummary } from "@/lib/metrics/experiments";
import { apiRequest } from "./request";
import { ChangeBadge, Dot, DotLegend, DotPair, agentCost, checkLabel, fmtInt, fmtMs, humanize } from "./shared";
import type { CompareData, EvaluatorInfo, RunRow } from "./types";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export type ComparisonState = { status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: CompareData };

/** GET /api/experiments/compare for the selected pair; keeps the previous result while a background refresh is in flight. */
export function useComparison(baseline: RunRow | undefined, candidate: RunRow | undefined, refreshKey: string): ComparisonState {
  const ids = baseline && candidate ? `${baseline.run.run_id}|${candidate.run.run_id}` : null;
  const [state, setState] = useState<{ ids: string; data?: CompareData; error?: string } | null>(null);

  useEffect(() => {
    if (!ids) return;
    let alive = true;
    const [b, c] = ids.split("|");
    const url = `/api/experiments/compare?baseline=${encodeURIComponent(b)}&candidate=${encodeURIComponent(c)}`;
    void apiRequest<CompareData>("GET", url).then((res) => {
      if (alive) setState(res.ok ? { ids, data: res.data } : { ids, error: res.error });
    });
    return () => {
      alive = false;
    };
  }, [ids, refreshKey]);

  if (!ids) return { status: "idle" };
  if (state?.ids !== ids) return { status: "loading" };
  if (state.error !== undefined) return { status: "error", error: state.error };
  return { status: "ready", data: state.data! };
}

const PASS_ALL_INFO = (
  <>
    <b>Pass-all = every code check passes</b> for a case. Cases without a trace count as not passing. The AI judge is experimental and never
    counts. There is no weighted or composite score.
  </>
);

// ---------------------------------------------------------------------------
// Answer strip
// ---------------------------------------------------------------------------

function Tile({ label, tone, className, children }: { label: ReactNode; tone?: "red" | "green"; className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-lg border px-4 py-3 shadow-sm",
        tone === "red" ? "border-rose-300 bg-rose-50" : tone === "green" ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Fraction({ s, side, tone }: { s: RunSummary; side: string; tone?: "green" | "red" }) {
  return (
    <div>
      <div
        className={cx(
          "text-4xl font-semibold tracking-tight tabular-nums",
          tone === "green" ? "text-emerald-700" : tone === "red" ? "text-rose-700" : "text-slate-900",
        )}
      >
        {s.pass_all_count}
        <span className="text-xl font-medium text-slate-400">/{s.n_cases}</span>
      </div>
      <div className="text-xs text-slate-500">
        {side} · <Ratio value={s.pass_all_rate} undefinedReason="No cases" />
      </div>
    </div>
  );
}

const CaseIds = ({ ids }: { ids: string[] }) => <div className="mt-1 truncate font-mono text-xs text-slate-600">{ids.length ? ids.join(" ") : "none"}</div>;

export function ResultStrip({ d }: { d: CompareData }) {
  const cmp = d.comparison;
  const bs = cmp.baseline_summary;
  const cs = cmp.candidate_summary;
  const regCases = [...new Set(cmp.new_regressions.map((r) => r.case_id))];
  const critical = cmp.new_critical_regressions;
  const up = cs.pass_all_count > bs.pass_all_count;
  const down = cs.pass_all_count < bs.pass_all_count;

  return (
    <div className="grid gap-3 md:grid-cols-5">
      <Tile
        className="md:col-span-2"
        label={
          <>
            Cases passing every check <InfoTip label="What is pass-all?">{PASS_ALL_INFO}</InfoTip>
          </>
        }
      >
        <div className="flex items-center gap-5">
          <Fraction s={bs} side={d.baseline.config.label} />
          <span aria-hidden className="text-3xl text-slate-300">
            →
          </span>
          <Fraction s={cs} side={d.candidate.config.label} tone={up ? "green" : down ? "red" : undefined} />
        </div>
      </Tile>

      <Tile label="Fixed" tone={cmp.fixed.length ? "green" : undefined}>
        <div className="flex items-center gap-2 text-4xl font-semibold tabular-nums text-emerald-700">
          <span aria-hidden className="text-2xl">
            ✓
          </span>
          {cmp.fixed.length}
        </div>
        <CaseIds ids={cmp.fixed} />
      </Tile>

      <Tile
        label={
          <>
            New regressions <InfoTip label="What is a regression?">A check that passed for Baseline now fails (or errors) for Corrected.</InfoTip>
          </>
        }
        tone={regCases.length ? "red" : undefined}
      >
        <div className={cx("flex items-center gap-2 text-4xl font-semibold tabular-nums", regCases.length ? "text-rose-700" : "text-slate-900")}>
          <span aria-hidden className="text-2xl">
            {regCases.length ? "✕" : "✓"}
          </span>
          {regCases.length}
          {critical.length > 0 && (
            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-white uppercase">critical</span>
          )}
        </div>
        {regCases.length === 0 ? (
          <CaseIds ids={[]} />
        ) : (
          <div className="mt-1 space-y-0.5 text-xs text-rose-900">
            {cmp.new_regressions.slice(0, 3).map((r) => {
              const pair = cmp.pairs.find((p) => p.case_id === r.case_id);
              return (
                <div key={`${r.case_id}-${r.evaluator_id}`} title={`${r.case_id}: ${humanize(r.evaluator_id)} passed for Baseline, fails for Corrected`}>
                  <b className="font-mono">{r.case_id}</b> · {checkLabel(r.evaluator_id)} now fails
                  {pair?.candidate.trace_id && (
                    <>
                      {" · "}
                      <Link className="underline" href={`/review/${pair.candidate.trace_id}`}>
                        trace
                      </Link>
                    </>
                  )}
                </div>
              );
            })}
            {cmp.new_regressions.length > 3 && <div>+{cmp.new_regressions.length - 3} more</div>}
          </div>
        )}
      </Tile>

      <Tile label="Still failing">
        <div className={cx("text-4xl font-semibold tabular-nums", cmp.still_failing.length ? "text-amber-700" : "text-slate-900")}>{cmp.still_failing.length}</div>
        <CaseIds ids={cmp.still_failing} />
      </Tile>
    </div>
  );
}

/** One-line warnings that only appear when they apply. */
export function ComparisonNotices({ d }: { d: CompareData }) {
  const b = d.baseline.run;
  const c = d.candidate.run;
  const notes: Array<{ tone: "red" | "amber"; text: ReactNode }> = [];
  if (d.mode_mismatch) {
    notes.push({ tone: "red", text: `Mode mismatch (${b.execution_mode.toUpperCase()} vs ${c.execution_mode.toUpperCase()}) — not evidence about the change. Pick two runs with the same mode.` });
  } else if (b.execution_mode === "mock") {
    notes.push({ tone: "amber", text: "MOCK runs — they exercise the pipeline, not the real model." });
  }
  const notDone = [b, c].filter((r) => r.status !== "completed");
  if (notDone.length) notes.push({ tone: "amber", text: `${notDone.map((r) => `${r.run_id} is ${r.status}`).join("; ")} — cases without a trace show as incomplete.` });
  if (b.agent_config_id === c.agent_config_id) notes.push({ tone: "amber", text: "Same version on both sides — this shows run-to-run noise, not the effect of the fix." });
  if (d.comparison.incomplete.length) notes.push({ tone: "amber", text: `Incomplete (not classified): ${d.comparison.incomplete.join(" ")}` });
  if (!notes.length) return null;
  return (
    <div className="space-y-1">
      {notes.map((n, i) => (
        <p
          key={i}
          className={cx(
            "rounded-md border px-3 py-1.5 text-xs",
            n.tone === "red" ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-950",
          )}
        >
          {n.text}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case table
// ---------------------------------------------------------------------------

const ORDER: Record<CaseChange, number> = { regressed: 0, fixed: 1, still_failing: 2, incomplete: 3, still_passing: 4 };

function TraceLinks({ p }: { p: PairedCase }) {
  const link = (id: string | null, label: string) =>
    id ? (
      <Link href={`/review/${id}`} className="text-sky-700 hover:underline" title={id}>
        {label}
      </Link>
    ) : (
      <span className="text-slate-400" title="No trace">
        {label}
      </span>
    );
  return (
    <span className="whitespace-nowrap">
      {link(p.baseline.trace_id, "Baseline")} <span className="text-slate-300">·</span> {link(p.candidate.trace_id, "Corrected")}
    </span>
  );
}

export function CaseTable({ d, evaluators }: { d: CompareData; evaluators: EvaluatorInfo[] }) {
  const cmp = d.comparison;
  const info = new Map(evaluators.map((e) => [e.evaluator_id, e]));
  const fromPairs = [...new Set(cmp.pairs.flatMap((p) => p.evaluator_changes.map((x) => x.evaluator_id)))];
  const evalIds = evaluators.length ? [...evaluators.map((e) => e.evaluator_id), ...fromPairs.filter((id) => !info.has(id))] : fromPairs;
  const rows = [...cmp.pairs].sort((a, b) => ORDER[a.change] - ORDER[b.change] || a.case_id.localeCompare(b.case_id));

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th rowSpan={2} className="px-4 pt-2.5 pb-1.5 align-bottom font-medium">
              Case
            </th>
            <th colSpan={evalIds.length} className="border-b border-slate-100 px-2 pt-2.5 pb-1 text-center font-medium">
              Code checks <span className="font-normal text-slate-400">Baseline → Corrected</span>
            </th>
            <th rowSpan={2} className="px-3 pt-2.5 pb-1.5 align-bottom font-medium">
              Change
            </th>
            <th rowSpan={2} className="px-3 pt-2.5 pb-1.5 align-bottom font-medium">
              Traces
            </th>
            <th rowSpan={2} className="border-l-2 border-violet-200 bg-violet-50/60 px-3 pt-2.5 pb-1.5 align-bottom font-medium text-violet-900">
              AI judge
              <div className="font-normal text-violet-700">experimental, not in pass-all</div>
            </th>
          </tr>
          <tr className="border-b border-slate-200">
            {evalIds.map((id) => {
              const e = info.get(id);
              return (
                <th key={id} className="px-2 pb-1.5 text-center font-medium whitespace-nowrap" title={e ? `${humanize(id)} (${e.severity}) — ${e.question}` : humanize(id)}>
                  {checkLabel(id)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const meta = d.case_meta[p.case_id];
            const critical = p.new_critical_regressions.length > 0;
            const changes = new Map(p.evaluator_changes.map((x) => [x.evaluator_id, x]));
            return (
              <tr key={p.case_id} className={cx("border-b border-slate-100 last:border-0", p.change === "regressed" || critical ? "bg-rose-50" : undefined)}>
                <td className="max-w-[340px] px-4 py-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">{p.case_id}</span>
                    {meta && (
                      <span className="truncate text-xs text-slate-600" title={meta.title}>
                        {meta.title}
                      </span>
                    )}
                    {meta?.split === "heldout" && <Badge tone="purple">held-out</Badge>}
                  </div>
                  {(p.baseline.execution_error || p.candidate.execution_error) && (
                    <div className="truncate text-xs text-rose-700" title={[p.baseline.execution_error, p.candidate.execution_error].filter(Boolean).join(" | ")}>
                      error: {p.candidate.execution_error ?? p.baseline.execution_error}
                    </div>
                  )}
                </td>
                {evalIds.map((id) => {
                  const ch = changes.get(id);
                  return (
                    <td
                      key={id}
                      className={cx(
                        "px-2 py-1.5 text-center",
                        ch?.kind === "fixed" && "bg-emerald-50",
                        ch?.kind === "regressed" && "bg-rose-200/70",
                      )}
                      title={ch && ch.kind !== "unchanged" ? `${checkLabel(id)}: ${ch.kind}` : undefined}
                    >
                      <DotPair from={ch?.from} to={ch?.to} />
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <ChangeBadge change={p.change} />
                  {critical && (
                    <span className="ml-1">
                      <Badge tone="red" title={`New critical regression: ${p.new_critical_regressions.map(humanize).join(", ")}`}>
                        critical
                      </Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  <TraceLinks p={p} />
                </td>
                <td className="border-l-2 border-violet-200 bg-violet-50/40 px-3 py-1.5">
                  <DotPair from={p.baseline.judge_verdict} to={p.candidate.judge_verdict} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-slate-100 px-4 py-2">
        <DotLegend />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secondary: per-check pass rates, cost & latency
// ---------------------------------------------------------------------------

function TallyCell({ t }: { t: EvaluatorTally }) {
  const den = t.pass + t.fail + t.error;
  return (
    <span className="whitespace-nowrap">
      <Ratio value={t.pass_rate} undefinedReason="No applicable results (all N/A or no traces)" />{" "}
      <span className="text-xs text-slate-500 tabular-nums" title={`fail ${t.fail} · error ${t.error} · n/a ${t.not_applicable}`}>
        ({t.pass}/{den})
      </span>
    </span>
  );
}

function JudgeCounts({ s }: { s: RunSummary }) {
  const j = s.judge;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs tabular-nums">
      <span className="inline-flex items-center gap-1">
        <Dot outcome="PASS" /> {j.PASS}
      </span>
      <span className="inline-flex items-center gap-1">
        <Dot outcome="FAIL" /> {j.FAIL}
      </span>
      {j.REQUIRES_REVIEW > 0 && (
        <span className="inline-flex items-center gap-1">
          <Dot outcome="REQUIRES_REVIEW" /> {j.REQUIRES_REVIEW}
        </span>
      )}
      {j.ERROR > 0 && (
        <span className="inline-flex items-center gap-1">
          <Dot outcome="ERROR" /> {j.ERROR}
        </span>
      )}
      {j.not_run > 0 && <span className="text-slate-500">not run {j.not_run}</span>}
    </span>
  );
}

export function PerCheckTable({ d, evaluators }: { d: CompareData; evaluators: EvaluatorInfo[] }) {
  const cmp = d.comparison;
  const info = new Map(evaluators.map((e) => [e.evaluator_id, e]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr className="border-b border-slate-100">
            <th className="py-1.5 pr-3 font-medium">
              <span className="inline-flex items-center gap-1.5">
                Check
                <InfoTip label="How is pass rate computed?">
                  Pass rate = pass / (pass + fail + error). Not-applicable results are left out; errors count against. Shown side by side,
                  never averaged into one score.
                </InfoTip>
              </span>
            </th>
            <th className="py-1.5 pr-3 font-medium">Severity</th>
            <th className="py-1.5 pr-3 font-medium">{d.baseline.config.label}</th>
            <th className="py-1.5 pr-3 font-medium">{d.candidate.config.label}</th>
            <th className="py-1.5 font-medium">Cases fixed / regressed</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(cmp.per_evaluator).map(([id, t]) => {
            const e = info.get(id);
            const fixed = cmp.pairs.filter((p) => p.evaluator_changes.some((x) => x.evaluator_id === id && x.kind === "fixed")).length;
            const regressed = cmp.pairs.filter((p) => p.evaluator_changes.some((x) => x.evaluator_id === id && x.kind === "regressed")).length;
            return (
              <tr key={id} className="border-b border-slate-50">
                <td className="py-1.5 pr-3" title={e?.question}>
                  <span className="font-medium text-slate-900">{checkLabel(id)}</span>{" "}
                  <code className="font-mono text-[11px] text-slate-400">{id}</code>
                </td>
                <td className="py-1.5 pr-3">
                  <Badge tone={e?.severity === "critical" ? "red" : e?.severity === "major" ? "amber" : "neutral"}>{e?.severity ?? "—"}</Badge>
                </td>
                <td className="py-1.5 pr-3">
                  <TallyCell t={t.baseline} />
                </td>
                <td className="py-1.5 pr-3">
                  <TallyCell t={t.candidate} />
                </td>
                <td className="py-1.5 text-xs tabular-nums">
                  <span className={fixed ? "text-emerald-700" : "text-slate-500"}>{fixed} fixed</span> ·{" "}
                  <span className={regressed ? "font-semibold text-rose-700" : "text-slate-500"}>{regressed} regressed</span>
                </td>
              </tr>
            );
          })}
          <tr className="bg-violet-50/40">
            <td className="py-1.5 pr-3">
              <span className="font-medium text-violet-900">AI judge</span>{" "}
              <span className="text-xs text-violet-700">experimental, not in pass-all</span>
            </td>
            <td className="py-1.5 pr-3">
              <Badge tone="purple">experimental</Badge>
            </td>
            <td className="py-1.5 pr-3">
              <JudgeCounts s={cmp.baseline_summary} />
            </td>
            <td className="py-1.5 pr-3">
              <JudgeCounts s={cmp.candidate_summary} />
            </td>
            <td className="py-1.5 text-xs text-slate-500">unsupported pricing justification</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** One-line cost summary for the collapsed section header. */
export function costSummary(d: CompareData): string {
  const side = (s: RunSummary, mode: "live" | "mock") =>
    mode === "mock" ? "$0 (mock)" : `${fmtUsd(s.total_cost_usd)}${s.n_with_trace > 0 && s.cache_hits === s.n_with_trace ? " (cached)" : ""}`;
  return `agent cost ${side(d.comparison.baseline_summary, d.baseline.run.execution_mode)} → ${side(d.comparison.candidate_summary, d.candidate.run.execution_mode)}`;
}

export function CostTable({ d }: { d: CompareData }) {
  const bs = d.comparison.baseline_summary;
  const cs = d.comparison.candidate_summary;
  const bMode = d.baseline.run.execution_mode;
  const cMode = d.candidate.run.execution_mode;
  const rows: Array<[string, ReactNode, ReactNode]> = [
    ["Estimated agent cost", agentCost(bs, bMode), agentCost(cs, cMode)],
    ["Tokens in / out", `${fmtInt(bs.total_input_tokens)} / ${fmtInt(bs.total_output_tokens)}`, `${fmtInt(cs.total_input_tokens)} / ${fmtInt(cs.total_output_tokens)}`],
    ["Mean latency", fmtMs(bs.mean_latency_ms), fmtMs(cs.mean_latency_ms)],
    ["p50 latency", fmtMs(bs.p50_latency_ms), fmtMs(cs.p50_latency_ms)],
    ["Max latency", fmtMs(bs.max_latency_ms), fmtMs(cs.max_latency_ms)],
    ["Cache hits", `${bs.cache_hits} / ${bs.n_with_trace}`, `${cs.cache_hits} / ${cs.n_with_trace}`],
  ];
  return (
    <table className="w-full max-w-2xl text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr className="border-b border-slate-100">
          <th className="py-1.5 pr-3 font-medium">
            <span className="inline-flex items-center gap-1.5">
              Agent calls only
              <InfoTip label="What is included?">
                Agent calls only — judge calls are not included. Cost is estimated from token usage; cache hits replay a stored response and cost
                $0. Mock tokens and latency say nothing about the real model.
              </InfoTip>
            </span>
          </th>
          <th className="py-1.5 pr-3 font-medium">{d.baseline.config.label}</th>
          <th className="py-1.5 font-medium">{d.candidate.config.label}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, b, c]) => (
          <tr key={k} className="border-b border-slate-50 last:border-0">
            <td className="py-1.5 pr-3 text-slate-500">{k}</td>
            <td className="py-1.5 pr-3 tabular-nums">{b}</td>
            <td className="py-1.5 tabular-nums">{c}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
