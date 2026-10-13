"use client";

/**
 * Dashboard: tracks every eval run and the release verdict. Numbers come from
 * stored runs, traces and human labels (/api/overview). KPIs and check bars always
 * compare Baseline and Corrected side by side.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { InfoTip, MockBadge, cx } from "@/components/ui";
import { CheckBars, CountBars, TrendsChart } from "./DashboardCharts";
import { EvalxietyBanner } from "./EvalxietyBanner";
import type { OverviewData } from "./types";

function Kpi({ icon, label, value, delta, deltaTone, sub, info }: {
  icon: string;
  label: string;
  value: React.ReactNode;
  delta?: string;
  deltaTone?: "up" | "down" | "flat";
  sub?: React.ReactNode;
  info?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-base" aria-hidden>
          {icon}
        </span>
        <span className="flex items-center gap-1 text-xs text-slate-500">
          {label}
          {info && <InfoTip>{info}</InfoTip>}
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta && (
          <span
            className={cx(
              "rounded px-1.5 py-0.5 font-medium",
              deltaTone === "up" && "bg-emerald-50 text-emerald-700",
              deltaTone === "down" && "bg-rose-50 text-rose-700",
              (!deltaTone || deltaTone === "flat") && "bg-slate-100 text-slate-600",
            )}
          >
            {delta}
          </span>
        )}
        {sub && <span className="text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}

function Panel({ title, info, right, children, className }: { title: string; info?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white p-5 shadow-sm", className)}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {info && <InfoTip>{info}</InfoTip>}
        {right && <div className="ml-auto text-xs text-slate-500">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function OverviewDashboard() {
  const [o, setO] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJSON<OverviewData>("/api/overview")
      .then(setO)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="text-sm text-rose-700">Could not load the dashboard: {error}</p>;
  if (!o) return <p className="text-sm text-slate-500">Loading…</p>;

  const t = o.trend;
  const baseline = t.points.find((p) => p.role === "baseline") ?? null;
  const corrected = t.points.find((p) => p.role === "corrected") ?? null;
  const both = baseline && corrected ? { b: baseline, c: corrected } : null;
  const modes = [...new Set(t.points.map((p) => p.execution_mode))];
  const reviewed = o.review.reviewed_traces;
  const minReviews = o.review.target_min;
  const fullRunDone = o.candidate_run !== null;
  const critical = t.new_critical_regressions;
  const today = new Date().toDateString();
  const runsToday = o.history.filter((h) => new Date(h.created_at).toDateString() === today).length;

  const next =
    reviewed < minReviews
      ? { href: "/review", label: `Review answers (${reviewed}/${minReviews})` }
      : !fullRunDone
        ? { href: "/experiments", label: "Run the final check" }
        : { href: "/release", label: "Open the release gate" };

  const passDelta =
    both && both.b.pass_all_rate !== null && both.c.pass_all_rate !== null ? Math.round((both.c.pass_all_rate - both.b.pass_all_rate) * 100) : null;
  const critDelta = both ? both.c.critical_failures - both.b.critical_failures : null;
  const arrow = (from: React.ReactNode, to: React.ReactNode) => (
    <span className="whitespace-nowrap text-2xl">
      <span className="text-slate-400">{from}</span>
      <span className="mx-1.5 text-slate-300">→</span>
      {to}
    </span>
  );
  const nCases = (ids: string[]) => ids.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
            Every eval run of the pricing agent — and whether it&apos;s ready to ship.
            <InfoTip>
              Evalxiety tests a Claude pricing agent on 20 synthetic merchant cases. Code checks verify policy rules; people label answers; an
              experimental AI judge checks explanations; the release gate combines the evidence. Pass rates per check — never an averaged score.
            </InfoTip>
          </div>
        </div>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <b className="text-slate-800">Baseline vs Corrected</b>
          {modes.map((m) => (
            <MockBadge key={m} mode={m} />
          ))}
        </span>
      </div>

      <EvalxietyBanner o={o} next={next} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon="🧪" label="Eval runs" value={o.history.length} delta={runsToday ? `+${runsToday} today` : undefined} deltaTone="up" sub={`${o.executions.total} traces`} />
        <Kpi
          icon="✅"
          label="Pass-all rate"
          value={both ? arrow(`${both.b.pass_all_count}/${both.b.n_cases}`, `${both.c.pass_all_count}/${both.c.n_cases}`) : "—"}
          delta={passDelta !== null ? `${passDelta >= 0 ? "▲ +" : "▼ "}${passDelta} pts` : undefined}
          deltaTone={passDelta === null ? "flat" : passDelta > 0 ? "up" : passDelta < 0 ? "down" : "flat"}
          info="Cases where every code check passes (policy, margin math, margin floor, approvals). The AI judge is not included."
        />
        <Kpi
          icon="⚠️"
          label="Critical failures"
          value={both ? arrow(both.b.critical_failures, both.c.critical_failures) : "—"}
          delta={critDelta !== null ? (critDelta === 0 ? "no change" : critDelta < 0 ? `▼ ${-critDelta} fewer` : `▲ ${critDelta} more`) : undefined}
          deltaTone={critDelta === null ? "flat" : critDelta < 0 ? "up" : critDelta > 0 ? "down" : "flat"}
          sub={critical.length ? `new: ${critical.map((c) => c.case_id).join(", ")}` : undefined}
          info="Cases breaking a policy rule: wrong policy, margin below floor, or a missing required approval."
        />
        <Kpi
          icon="👤"
          label="Human reviewed"
          value={`${reviewed}`}
          sub={`of ${minReviews} minimum`}
          delta={reviewed >= minReviews ? "target met" : `${minReviews - reviewed} to go`}
          deltaTone={reviewed >= minReviews ? "up" : "flat"}
          info="Answers labelled by a person with the rubric checklist. They are the reference for the AI judge."
        />
        <Kpi
          icon="⚖️"
          label="Judge agreement"
          value={o.judge && o.judge.n > 0 ? `${o.judge.n}` : "—"}
          sub={o.judge && o.judge.n > 0 ? `labels compared` : "needs your labels"}
          delta={o.judge && o.judge.n > 0 ? `catches ${o.judge.tpr === null ? "undefined" : `${Math.round(o.judge.tpr * 100)}%`} · avoids false alarms ${o.judge.tnr === null ? "undefined" : `${Math.round(o.judge.tnr * 100)}%`}` : "experimental"}
          info={`How often the AI judge agrees with human labels on the dev set. ${o.judge?.status_label ?? ""}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Eval trends"
          className="xl:col-span-2"
          info="Pass rate per check for every completed run, oldest to newest. Click a legend item to hide it; hover a run for details."
          right={`${o.history.length} runs`}
        >
          <TrendsChart history={o.history} />
        </Panel>
        <Panel
          title="Check performance"
          info="Cases passing each code check: latest Baseline run vs latest Corrected run on the same frozen cases."
          right={corrected ? `${corrected.n_cases} cases` : undefined}
        >
          <CheckBars baseline={baseline} corrected={corrected} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="What changed" info="Case-by-case comparison of the latest Baseline and Corrected runs on the same frozen cases." right={<Link className="text-sky-700 hover:underline" href="/experiments">details →</Link>}>
          <CountBars
            rows={[
              { label: "✓ Fixed", count: nCases(t.fixed), color: "#0ca30c" },
              { label: "= Still passing", count: Math.max(0, (corrected?.n_cases ?? 0) - t.fixed.length - t.regressed.length - t.still_failing.length), color: "#94a3b8" },
              { label: "✕ Still failing", count: nCases(t.still_failing), color: "#eda100" },
              { label: "↓ Broke", count: nCases(t.regressed), color: "#d03b3b" },
            ]}
            max={corrected?.n_cases}
          />
        </Panel>
        <Panel title="Pipeline progress" info="How far the evaluation has come: runs → human labels → failure types → gold set → AI judge.">
          <CountBars rows={o.pipeline.map((p) => ({ label: p.step, count: p.count }))} />
        </Panel>
        <Panel title="Next steps">
          <ol className="space-y-2">
            {[
              { label: `Review ${minReviews}–${o.review.target_max} answers`, done: reviewed >= minReviews, href: "/review" },
              { label: "Group notes into failure types", done: o.observed_failure_modes > 0, href: "/review/taxonomy" },
              { label: "Final check on all 20 cases", done: fullRunDone, href: "/experiments" },
              { label: "Decide: ship or not", done: o.release_status === "APPROVED_FOR_DEMO", href: "/release" },
            ].map((s, i) => (
              <li key={s.href}>
                <Link href={s.href} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", s.done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600")}>
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className="text-sm text-slate-800">{s.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
