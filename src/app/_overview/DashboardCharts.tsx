"use client";

/**
 * Dashboard charts. Hand-built SVG/HTML, following the dataviz method:
 * categorical slots in fixed order (validated), 2px lines, ≥8px markers with a
 * surface ring, legend for ≥2 series, end labels, crosshair tooltip, table view.
 */
import { useState } from "react";
import type { OverviewData } from "./types";
import { cx } from "@/components/ui";

type History = OverviewData["history"];

// Categorical slots 1–5 (validated light-mode set; three sit below 3:1 → legend + end labels + table view).
const SERIES = [
  { key: "pass_all", label: "All checks pass", color: "#2a78d6" },
  { key: "stale_policy_used", label: "Right policy", color: "#eb6834" },
  { key: "margin_calculation_error", label: "Margin math", color: "#1baf7a" },
  { key: "margin_guardrail_violation", label: "Margin floor", color: "#eda100" },
  { key: "missing_mandatory_approval", label: "Approvals", color: "#e87ba4" },
];
const GRID = "#e5e7eb";

const pct = (r: number | null | undefined) => (r === null || r === undefined ? "—" : `${Math.round(r * 100)}%`);
const shortDate = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const shortTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function value(h: History[number], key: string): number | null {
  return key === "pass_all" ? h.pass_all_rate : (h.checks[key] ?? null);
}

export function TrendsChart({ history }: { history: History }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (history.length === 0) {
    return <Empty>Run an experiment to start tracking eval results over time.</Empty>;
  }
  const W = 760;
  const H = 280;
  const P = { l: 44, r: 96, t: 16, b: 46 };
  const n = history.length;
  const x = (i: number) => (n === 1 ? (P.l + W - P.r) / 2 : P.l + ((W - P.l - P.r) * i) / (n - 1));
  const y = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
  const visible = SERIES.filter((s) => !hidden.has(s.key));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {SERIES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setHidden((h) => { const next = new Set(h); if (next.has(s.key)) next.delete(s.key); else next.add(s.key); return next; })}
            className={cx("flex items-center gap-1.5 text-xs", hidden.has(s.key) ? "text-slate-400 line-through" : "text-slate-700")}
            aria-pressed={!hidden.has(s.key)}
          >
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, height: s.key === "pass_all" ? 3 : 2 }} />
            {s.label}
          </button>
        ))}
        <button type="button" onClick={() => setTable((v) => !v)} className="ml-auto text-xs text-sky-700 hover:underline">
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>

      {table ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">Run</th>
              {SERIES.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {history.map((h) => (
              <tr key={h.run_id} className="border-t border-slate-100">
                <td className="py-1">
                  {h.label} · {shortDate(h.created_at)} {!h.current_content && <span className="text-xs text-slate-400">(older cases)</span>}
                </td>
                {SERIES.map((s) => (
                  <td key={s.key}>{pct(value(h, s.key))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Pass rate per check across runs">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={GRID} />
                <text x={P.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#94a3b8">
                  {t * 100}%
                </text>
              </g>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#94a3b8" strokeWidth={1} />}
            {visible.map((s) => {
              const pts = history.map((h, i) => ({ i, v: value(h, s.key) })).filter((p) => p.v !== null) as Array<{ i: number; v: number }>;
              const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ");
              const last = pts[pts.length - 1];
              return (
                <g key={s.key}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={s.key === "pass_all" ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((p) => (
                    <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={s.key === "pass_all" ? 5 : 4} fill={s.color} stroke="#fff" strokeWidth={2} />
                  ))}
                  {last && (
                    <text x={x(last.i) + 10} y={y(last.v)} dominantBaseline="middle" fontSize={10} fill="#334155">
                      {s.key === "pass_all" ? `${pct(last.v)} all` : ""}
                    </text>
                  )}
                </g>
              );
            })}
            {history.map((h, i) => (
              <g key={h.run_id}>
                <text x={x(i)} y={H - P.b + 16} textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"} fontSize={10} fill="#475569" fontWeight={500}>
                  {h.label}
                </text>
                <text x={x(i)} y={H - P.b + 29} textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"} fontSize={9} fill="#94a3b8">
                  {n > 4 ? shortTime(h.created_at) : shortDate(h.created_at)}
                  {h.current_content ? "" : " · old"}
                </text>
                <rect x={x(i) - 30} y={P.t} width={60} height={H - P.t - P.b} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            ))}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-48 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: `${(x(hover) / W) * 100}%` }}
            >
              <div className="mb-1 font-semibold text-slate-800">
                {history[hover].label} · {shortDate(history[hover].created_at)}
              </div>
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-2 text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="tabular-nums text-slate-900">{pct(value(history[hover], s.key))}</span>
                </div>
              ))}
              <div className="mt-1 text-slate-500">{history[hover].critical_cases} critical case(s)</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type TrendPoint = OverviewData["trend"]["points"][number];

const CHECK_NAMES: Record<string, string> = {
  stale_policy_used: "Right policy",
  margin_calculation_error: "Margin math",
  margin_guardrail_violation: "Margin floor",
  missing_mandatory_approval: "Approvals",
};
const BASELINE_FILL = "#94a3b8"; // neutral: the "before" series
const CORRECTED_FILL = "#2a78d6"; // categorical slot 1: the "after" series

/**
 * Cases passing each check: Baseline vs Corrected, two bars per check.
 * Series identity = fill + legend; status colour is used only on the x/n text (green = all pass, red = failures).
 */
export function CheckBars({ baseline, corrected }: { baseline: TrendPoint | null; corrected: TrendPoint | null }) {
  if (!baseline && !corrected) return <Empty>Run Baseline and Corrected in Experiments to compare checks.</Empty>;
  const series = [
    { key: "baseline", label: "Baseline", fill: BASELINE_FILL, point: baseline },
    { key: "corrected", label: "Corrected", fill: CORRECTED_FILL, point: corrected },
  ];
  const ids = (corrected ?? baseline)!.checks.map((c) => c.evaluator_id);
  const H = 170;
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.fill }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-slate-400">
          <span className="text-emerald-700">x/n</span> all pass · <span className="text-rose-700">x/n</span> has failures
        </span>
      </div>
      <div className="flex items-end justify-around gap-4 border-b border-slate-200" style={{ height: H }}>
        {ids.map((id) => (
          <div key={id} className="flex items-end gap-1.5">
            {series.map((s) => {
              const c = s.point?.checks.find((x) => x.evaluator_id === id);
              const rate = c && c.total ? c.pass / c.total : 0;
              return (
                <div
                  key={s.key}
                  className="flex flex-col items-center justify-end"
                  style={{ height: H }}
                  title={c ? `${CHECK_NAMES[id]} · ${s.label}: ${c.pass} of ${c.total} cases pass` : `${s.label}: no run`}
                >
                  <span
                    className={cx(
                      "mb-0.5 text-[10px] font-medium tabular-nums",
                      !c ? "text-slate-400" : c.pass === c.total ? "text-emerald-700" : "text-rose-700",
                    )}
                  >
                    {c ? `${c.pass}/${c.total}` : "—"}
                  </span>
                  <div className="w-6 rounded-t" style={{ height: c ? Math.max(2, rate * (H - 18)) : 0, background: s.fill }} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-around text-xs text-slate-600">
        {ids.map((id) => (
          <span key={id}>{CHECK_NAMES[id]}</span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars, one per item, value-labelled. */
export function CountBars({ rows, max }: { rows: Array<{ label: string; count: number; color?: string; hint?: string }>; max?: number }) {
  const m = Math.max(1, max ?? Math.max(...rows.map((r) => r.count)));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} title={r.hint} className="grid grid-cols-[130px_1fr_32px] items-center gap-2 text-sm">
          <span className="truncate text-slate-600">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full" style={{ width: `${(r.count / m) * 100}%`, background: r.color ?? "#2a78d6" }} />
          </span>
          <span className="text-right tabular-nums text-slate-900">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">{children}</div>;
}
