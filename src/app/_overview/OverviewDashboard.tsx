"use client";

/**
 * Dashboard: tracks every eval run and the release verdict. Numbers come from
 * stored runs, traces and human labels (/api/overview). The "agent in focus"
 * (sidebar) picks which configuration the KPIs and check bars describe.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { InfoTip, MockBadge, StatusPill, cx } from "@/components/ui";
import { useFocusConfig } from "@/components/Sidebar";
import { topReason } from "@/app/release/status";
import { CheckBars, CountBars, TrendsChart } from "./DashboardCharts";
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
  const [focus] = useFocusConfig();

  useEffect(() => {
    getJSON<OverviewData>("/api/overview")
      .then(setO)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="text-sm text-rose-700">Could not load the dashboard: {error}</p>;
  if (!o) return <p className="text-sm text-slate-500">Loading…</p>;

  const t = o.trend;
  const fp = t.points.find((p) => p.config_id === focus) ?? t.points[t.points.length - 1] ?? null;
  const other = t.points.find((p) => p !== fp) ?? null;
  const reviewed = o.review.reviewed_traces;
  const minReviews = o.review.target_min;
  const fullRunDone = o.candidate_run !== null;
  const critical = t.new_critical_regressions;
  const today = new Date().toDateString();
  const runsToday = o.history.filter((h) => new Date(h.created_at).toDateString() === today).length;

  const top = topReason(o.release_reasons);
  const why =
    o.release_status === "INSUFFICIENT_EVIDENCE" && !fullRunDone && critical.length > 0
      ? `Not decided yet — dev results already show ${critical.length} critical regression${critical.length > 1 ? "s" : ""} (${critical.map((c) => c.case_id).join(", ")}).`
      : o.release_status === "INSUFFICIENT_EVIDENCE" && !fullRunDone
        ? "Not decided yet — the final check on all 20 cases hasn't run."
        : (top?.message ?? "All release conditions are met.");
  const next =
    reviewed < minReviews
      ? { href: "/review", label: `Review answers (${reviewed}/${minReviews})` }
      : !fullRunDone
        ? { href: "/experiments", label: "Run the final check" }
        : { href: "/release", label: "Open the release gate" };

  const passDelta = fp && other && fp.pass_all_rate !== null && other.pass_all_rate !== null ? Math.round((fp.pass_all_rate - other.pass_all_rate) * 100) : null;
  const critDelta = fp && other ? fp.critical_failures - other.critical_failures : null;
  const nCases = (ids: string[]) => ids.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
            Every eval run of the pricing agent — and whether it&apos;s ready to ship.
            <InfoTip>
              AgentTrust tests a Claude pricing agent on 20 synthetic merchant cases. Code checks verify policy rules; people label answers; an
              experimental AI judge checks explanations; the release gate combines the evidence. Pass rates per check — never an averaged score.
            </InfoTip>
          </div>
        </div>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          Focus: <b className="text-slate-800">{fp?.label ?? "—"}</b>
          {fp && <MockBadge mode={fp.execution_mode} />}
        </span>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <StatusPill status={o.release_status} />
          <p className="text-sm text-slate-800">{why}</p>
        </div>
        <Link href={next.href} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          {next.label} →
        </Link>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon="🧪" label="Eval runs" value={o.history.length} delta={runsToday ? `+${runsToday} today` : undefined} deltaTone="up" sub={`${o.executions.total} traces`} />
        <Kpi
          icon="✅"
          label="Pass-all rate"
          value={fp ? `${fp.pass_all_count}/${fp.n_cases}` : "—"}
          delta={passDelta !== null ? `${passDelta >= 0 ? "▲ +" : "▼ "}${passDelta} pts vs ${other?.label}` : undefined}
          deltaTone={passDelta === null ? "flat" : passDelta > 0 ? "up" : passDelta < 0 ? "down" : "flat"}
          info="Cases where every code check passes (policy, margin math, margin floor, approvals). The AI judge is not included."
        />
        <Kpi
          icon="⚠️"
          label="Critical failures"
          value={fp ? fp.critical_failures : "—"}
          delta={critDelta !== null ? (critDelta === 0 ? `same as ${other?.label}` : critDelta < 0 ? `▼ ${-critDelta} fewer than ${other?.label}` : `▲ ${critDelta} more than ${other?.label}`) : undefined}
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
        <Panel title="Check performance" info="Pass vs fail per code check in the latest run of the agent in focus." right={fp ? `${fp.label} · ${fp.n_cases} cases` : undefined}>
          <CheckBars point={fp} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="What changed" info="Case-by-case comparison of the latest Baseline and Corrected runs on the same frozen cases." right={<Link className="text-sky-700 hover:underline" href="/experiments">details →</Link>}>
          <CountBars
            rows={[
              { label: "✓ Fixed", count: nCases(t.fixed), color: "#0ca30c" },
              { label: "= Still passing", count: Math.max(0, (fp?.n_cases ?? 0) - t.fixed.length - t.regressed.length - t.still_failing.length), color: "#94a3b8" },
              { label: "✕ Still failing", count: nCases(t.still_failing), color: "#eda100" },
              { label: "↓ Broke", count: nCases(t.regressed), color: "#d03b3b" },
            ]}
            max={fp?.n_cases}
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
