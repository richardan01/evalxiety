"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { Badge, Callout, Card, KeyValue, MockBadge, Ratio, Stat, cx, fmtUsd } from "@/components/ui";
import { STATUS_META, topReason } from "@/app/release/status";
import { demoSteps, type StepState } from "./demoPath";
import type { ModeData, OverviewData } from "./types";

const STEP_STYLE: Record<StepState, { icon: string; cls: string; word: string }> = {
  done: { icon: "✓", cls: "bg-emerald-100 text-emerald-800", word: "done" },
  todo: { icon: "○", cls: "bg-amber-50 text-amber-800 ring-1 ring-amber-300", word: "not done" },
  neutral: { icon: "–", cls: "bg-slate-100 text-slate-500", word: "not tracked" },
};

export function OverviewDashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [mode, setMode] = useState<ModeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modeError, setModeError] = useState(false);

  useEffect(() => {
    let alive = true;
    getJSON<OverviewData>("/api/overview")
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    getJSON<ModeData>("/api/mode")
      .then((m) => alive && setMode(m))
      .catch(() => alive && setModeError(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Overview</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Where the merchant-pricing agent stands on the path from its first trace to a demo release decision. Every number below is computed
          from stored traces, human annotations and runs — hover or read the note under each tile for where it comes from.
        </p>
      </div>

      {error && (
        <Callout tone="red" title="Could not load the overview">
          {error}
        </Callout>
      )}
      {!data && !error && <p className="text-sm text-slate-500">Loading overview…</p>}

      {data && (
        <>
          {data.executions.live === 0 && (
            <Callout tone="amber" title="All results so far are MOCK and cannot support a release decision.">
              {data.executions.total === 0 ? "No executions have been recorded yet. " : `All ${data.executions.total} recorded execution(s) used the mock agent. `}
              Mock output is deterministic test scaffolding, not evidence about the real model. Live runs need <code>MOCK_MODE=false</code> and an
              API key; spend is capped
              {mode ? ` at ${fmtUsd(mode.spend_cap_usd)}` : ""}.
            </Callout>
          )}

          <StatTiles data={data} />

          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <DemoPath data={data} />
            <ContextCard data={data} mode={mode} modeError={modeError} />
          </div>
        </>
      )}
    </div>
  );
}

function StatTiles({ data }: { data: OverviewData }) {
  const e = data.executions;
  const r = data.review;
  const run = data.candidate_run;
  const s = data.candidate_summary;
  const status = STATUS_META[data.release_status];
  const top = topReason(data.release_reasons);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Stat
        label="Test executions"
        value={e.total}
        hint={
          <>
            <b>{e.live}</b> live · <b>{e.mock}</b> mock · <b className={cx(e.errors > 0 && "text-rose-700")}>{e.errors}</b> with errors. Every agent
            run (single case or experiment) is stored as a trace.
          </>
        }
      />
      <Stat
        label="Human-reviewed coverage"
        value={
          <>
            {r.reviewed_traces} <span className="text-base font-normal text-slate-500">of {e.total}</span>
          </>
        }
        tone={r.reviewed_traces < r.target_min ? "amber" : undefined}
        hint={
          <>
            Traces with a human annotation. Target {r.target_min}–{r.target_max}; {r.unreviewed} unreviewed. Gold labels: {r.gold_dev} dev /{" "}
            {r.gold_heldout} held-out.
          </>
        }
      />
      <Stat
        label="Pass-all rate"
        value={run ? <Ratio value={data.pass_all_rate} undefinedReason="The candidate run has no cases" /> : <span className="text-base font-medium text-slate-500">No candidate run yet</span>}
        hint={
          run && s ? (
            <>
              Latest corrected run on the frozen release set: {s.pass_all_count} of {s.n_cases} cases pass every validated deterministic check.{" "}
              <code className="font-mono">{run.run_id}</code> <MockBadge mode={run.execution_mode} />
            </>
          ) : (
            "Run the corrected configuration on all frozen cases (Experiments tab) to measure it."
          )
        }
      />
      <Stat
        label="Critical failures"
        value={run && data.critical_failures !== null ? data.critical_failures : "—"}
        tone={data.critical_failures ? "red" : undefined}
        hint={
          run && s ? (
            <>
              Failed critical policy checks across {s.cases_with_critical_failure.length} case(s) of{" "}
              <code className="font-mono">{run.run_id}</code> <MockBadge mode={run.execution_mode} />
            </>
          ) : (
            "No candidate run yet, so nothing has been measured. “—” means unknown, not zero."
          )
        }
      />
      <Stat
        label="Release status"
        value={<span className={cx("text-base font-bold tracking-wide", status.text)}>{status.label}</span>}
        hint={
          <>
            {top ? top.message : status.explanation} {run && <MockBadge mode={run.execution_mode} />}{" "}
            <Link href="/release" className="font-medium text-sky-700 hover:underline">
              Open the release gate →
            </Link>
          </>
        }
      />
    </div>
  );
}

function DemoPath({ data }: { data: OverviewData }) {
  const steps = demoSteps(data);
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <Card
      title="Demo path"
      subtitle={`${done} of ${steps.length} steps confirmed by stored data. “Not tracked” steps can't be confirmed from the data, so they are never shown as done.`}
    >
      <ol className="divide-y divide-slate-100">
        {steps.map((s) => {
          const st = STEP_STYLE[s.state];
          return (
            <li key={s.n} className="flex items-start gap-3 py-2">
              <span
                className={cx("mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", st.cls)}
                title={st.word}
                aria-label={st.word}
              >
                {st.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">{s.n}</span>
                  <Link href={s.href} className="text-sm font-medium text-slate-900 hover:text-sky-700 hover:underline">
                    {s.title}
                  </Link>
                  <span className={cx("text-[11px]", s.state === "done" ? "text-emerald-700" : s.state === "todo" ? "text-amber-700" : "text-slate-400")}>
                    {st.word}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{s.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function ContextCard({ data, mode, modeError }: { data: OverviewData; mode: ModeData | null; modeError: boolean }) {
  return (
    <Card title="Spend and failure taxonomy" subtitle="Context for reading the tiles above.">
      <KeyValue
        rows={[
          [
            "Live API spend (estimated)",
            mode ? (
              <span key="spend">
                <b>{fmtUsd(mode.ledger.total_estimated_usd)}</b> of {fmtUsd(mode.spend_cap_usd)} cap · {mode.ledger.live_calls} live call(s)
              </span>
            ) : modeError ? (
              <span key="spend" className="text-slate-500">unavailable (could not load /api/mode)</span>
            ) : (
              <span key="spend" className="text-slate-500">loading…</span>
            ),
          ],
          [
            "Execution mode now",
            mode ? (
              <span key="mode" className="inline-flex flex-wrap items-center gap-1">
                <MockBadge mode={mode.mode} /> <span className="text-xs text-slate-500">{mode.reason}</span>
              </span>
            ) : (
              "—"
            ),
          ],
          [
            "Observed failure modes",
            <span key="fm">
              <b>{data.observed_failure_modes}</b> · taxonomy v{data.taxonomy_version}{" "}
              <Link href="/review/taxonomy" className="text-sky-700 hover:underline">
                view
              </Link>
            </span>,
          ],
          ["Gold examples", `${data.review.gold_examples} (${data.review.gold_dev} dev / ${data.review.gold_heldout} held-out)`],
          ["Frozen scenarios", <span key="sc">{data.scenario_count} synthetic merchant cases <Badge>SYNTHETIC</Badge></span>],
        ]}
      />
      <p className="mt-3 text-xs text-slate-500">
        Failure-mode counts come only from human annotations. Seed taxonomy categories are hypotheses until a reviewer observes them in a trace.
        Spend comes from the local spend ledger (estimated from token usage; cached replays cost nothing).
      </p>
    </Card>
  );
}
