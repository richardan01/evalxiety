"use client";

/**
 * Overview = the answer first. One verdict, four numbers, one chart, the next step.
 * Every number comes from stored traces, human labels and runs (see /api/overview).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { InfoTip, MockBadge, PageHeader, StatusPill, cx, fmtUsd } from "@/components/ui";
import { topReason } from "@/app/release/status";
import { QualityChart } from "./QualityChart";
import type { ModeData, OverviewData } from "./types";

function Tile({ label, value, sub, tone, info }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "red" | "green" | "amber"; info?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <div
        className={cx(
          "mt-1 text-3xl font-semibold tabular-nums",
          tone === "red" && "text-rose-600",
          tone === "green" && "text-emerald-600",
          tone === "amber" && "text-amber-600",
          !tone && "text-slate-900",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-sm text-slate-500">{sub}</div>}
    </div>
  );
}

export function OverviewDashboard() {
  const [o, setO] = useState<OverviewData | null>(null);
  const [mode, setMode] = useState<ModeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJSON<OverviewData>("/api/overview")
      .then(setO)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    getJSON<ModeData>("/api/mode").then(setMode).catch(() => undefined);
  }, []);

  if (error) return <p className="text-sm text-rose-700">Could not load the overview: {error}</p>;
  if (!o) return <p className="text-sm text-slate-500">Loading…</p>;

  const t = o.trend;
  const base = t.points.find((p) => p.role === "baseline") ?? null;
  const fix = t.points.find((p) => p.role === "corrected") ?? null;
  const reviewed = o.review.reviewed_traces;
  const minReviews = o.review.target_min;
  const fullRunDone = o.candidate_run !== null;
  const critical = t.new_critical_regressions;

  // One sentence: why the verdict is what it is.
  const top = topReason(o.release_reasons);
  const why =
    o.release_status === "INSUFFICIENT_EVIDENCE" && !fullRunDone && critical.length > 0
      ? `Not decided yet — but development results already show ${critical.length} critical regression${critical.length > 1 ? "s" : ""} (${critical.map((c) => c.case_id).join(", ")}).`
      : o.release_status === "INSUFFICIENT_EVIDENCE" && !fullRunDone
        ? "Not decided yet — the final check on all 20 cases hasn't run."
        : (top?.message ?? "All release conditions are met.");

  // The single next step.
  const next =
    reviewed < minReviews
      ? { href: "/review", label: `Review answers (${reviewed}/${minReviews})` }
      : !fullRunDone
        ? { href: "/experiments", label: "Run the final check" }
        : { href: "/release", label: "Open the release gate" };

  const steps = [
    { label: `Review ${minReviews}–${o.review.target_max} agent answers`, done: reviewed >= minReviews, href: "/review", detail: `${reviewed} reviewed` },
    { label: "Run the final check on all 20 cases", done: fullRunDone, href: "/experiments", detail: fullRunDone ? "done" : "not run" },
    { label: "Decide: ship or not", done: o.release_status === "APPROVED_FOR_DEMO", href: "/release", detail: o.release_status.replace(/_/g, " ").toLowerCase() },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        question="Is the pricing agent ready to ship?"
        info="AgentTrust tests a Claude pricing agent on 20 synthetic merchant cases. Code checks verify policy rules; people label answers; an experimental AI judge checks the explanations; the release gate combines it all. Results describe a small test set — not production reliability."
      />

      {/* Verdict */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <StatusPill status={o.release_status} />
          <p className="text-base text-slate-800">{why}</p>
        </div>
        <Link href={next.href} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          {next.label} →
        </Link>
      </section>

      {/* Four numbers */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Cases passing every check"
          value={fix ? `${fix.pass_all_count}/${fix.n_cases}` : "—"}
          sub={fix && base ? `Corrected · was ${base.pass_all_count}/${base.n_cases} before the fix` : "Run both versions in Experiments"}
          tone={fix ? (fix.pass_all_rate !== null && fix.pass_all_rate >= 0.9 ? "green" : "amber") : undefined}
          info="Share of test cases where every code check passes (policy, margin math, margin floor, approvals). The AI judge is not part of this number."
        />
        <Tile
          label="Critical failures"
          value={fix ? fix.critical_failures : "—"}
          sub={critical.length ? `New regression: ${critical.map((c) => c.case_id).join(", ")}` : fix ? "in the corrected version" : undefined}
          tone={fix ? (fix.critical_failures > 0 ? "red" : "green") : undefined}
          info="Cases where the corrected agent broke a policy rule: wrong policy, margin below the floor, or a missing required approval."
        />
        <Tile
          label="Human reviews"
          value={`${reviewed}`}
          sub={
            <span className="flex items-center gap-2">
              of {minReviews} minimum
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-slate-700" style={{ width: `${Math.min(100, (reviewed / minReviews) * 100)}%` }} />
              </span>
            </span>
          }
          tone={reviewed >= minReviews ? "green" : "amber"}
          info="People label agent answers with a 5-question checklist. These labels are the reference for checking the AI judge."
        />
        <Tile
          label="API spend"
          value={mode ? fmtUsd(mode.ledger.total_estimated_usd) : "—"}
          sub={mode ? `of ${fmtUsd(mode.spend_cap_usd, 0)} cap · ${mode.ledger.live_calls} calls` : undefined}
          info="Estimated Claude API spend from the local ledger. Re-running identical cases is served from cache and costs nothing."
        />
      </div>

      {/* Chart */}
      <section className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">Does the fix work?</h2>
          <InfoTip>
            Each point is one agent version run on the same frozen test cases. The big line is the share of cases passing every code
            check; the small charts show each check. The dashed line is the 90% bar for a demo release.
          </InfoTip>
          {t.fixed.length > 0 && <span className="ml-auto text-sm text-emerald-700">✓ {t.fixed.length} cases fixed</span>}
          {t.regressed.length > 0 && <span className="text-sm text-rose-700">✕ {t.regressed.length} broke ({t.regressed.join(", ")})</span>}
        </div>
        <QualityChart trend={t} />
      </section>

      {/* Next steps */}
      <section className="rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-slate-900">Next steps</h2>
        <ol className="grid gap-2 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={i}>
              <Link href={s.href} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                <span
                  className={cx(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                    s.done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600",
                  )}
                  aria-label={s.done ? "done" : "to do"}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span className="text-sm text-slate-800">
                  {s.label}
                  <span className="block text-xs text-slate-500">{s.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {o.executions.live === 0 && o.executions.total > 0 && (
        <p className="flex items-center gap-2 text-xs text-amber-800">
          <MockBadge mode="mock" /> All results so far are mock and cannot support a release decision.
        </p>
      )}
    </div>
  );
}
