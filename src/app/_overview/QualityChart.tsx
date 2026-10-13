"use client";

/**
 * "Does the fix work?" — pass-all rate by agent version as a line, with the 90%
 * demo bar, plus one small line per check (small multiples instead of five
 * overlapping lines). Single series per chart → no legend; values are direct-
 * labelled at the points; hover shows details; a table view is one click away.
 */
import { useState } from "react";
import type { OverviewData } from "./types";
import { MockBadge, cx } from "@/components/ui";

type Trend = OverviewData["trend"];
type Point = Trend["points"][number];

const SERIES = "#2a78d6"; // categorical slot 1 (validated: contrast ≥ 3:1 on the light surface)
const GRID = "#e5e7eb";
const AXIS_TEXT = "#64748b";
const TARGET = 0.9;

const CHECK_NAMES: Record<string, string> = {
  stale_policy_used: "Right policy for the date",
  margin_calculation_error: "Margin math",
  margin_guardrail_violation: "Margin floor",
  missing_mandatory_approval: "Required approvals",
};
const CHECK_ORDER = ["stale_policy_used", "margin_calculation_error", "margin_guardrail_violation", "missing_mandatory_approval"];

const pct = (r: number | null) => (r === null ? "undefined" : `${Math.round(r * 100)}%`);

interface Geo {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

function xFor(i: number, n: number, g: Geo) {
  const inner = g.w - g.padL - g.padR;
  return n === 1 ? g.padL + inner / 2 : g.padL + (inner * i) / (n - 1);
}
function yFor(r: number, g: Geo) {
  return g.padT + (1 - r) * (g.h - g.padT - g.padB);
}

function LineChart(props: {
  points: Array<{ label: string; rate: number | null; caption: string; tooltip: string }>;
  g: Geo;
  showTarget?: boolean;
  big?: boolean;
  ariaLabel: string;
}) {
  const { points, g, showTarget, big, ariaLabel } = props;
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const defined = points.map((p, i) => ({ ...p, i })).filter((p) => p.rate !== null);
  const path = defined.map((p, k) => `${k === 0 ? "M" : "L"}${xFor(p.i, n, g)},${yFor(p.rate!, g)}`).join(" ");
  const ticks = big ? [0, 0.25, 0.5, 0.75, 1] : [0, 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${g.w} ${g.h}`} className="w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={g.padL} x2={g.w - g.padR} y1={yFor(t, g)} y2={yFor(t, g)} stroke={GRID} strokeWidth={1} />
            {big && (
              <text x={g.padL - 8} y={yFor(t, g)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={AXIS_TEXT}>
                {Math.round(t * 100)}%
              </text>
            )}
          </g>
        ))}
        {showTarget && (
          <g>
            <line x1={g.padL} x2={g.w - g.padR} y1={yFor(TARGET, g)} y2={yFor(TARGET, g)} stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />
            <text x={g.w - g.padR} y={yFor(TARGET, g) - 6} textAnchor="end" fontSize={11} fill="#334155">
              demo bar 90%
            </text>
          </g>
        )}
        <path d={path} fill="none" stroke={SERIES} strokeWidth={big ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => {
          const x = xFor(i, n, g);
          return (
            <g key={i}>
              {p.rate !== null && (
                <>
                  <circle cx={x} cy={yFor(p.rate, g)} r={big ? 7 : 5} fill={SERIES} stroke="#ffffff" strokeWidth={2} />
                  <text
                    x={x}
                    y={yFor(p.rate, g) + (p.rate > 0.85 ? (big ? 24 : 16) : big ? -14 : -9)}
                    textAnchor="middle"
                    fontSize={big ? 14 : 11}
                    fontWeight={600}
                    fill="#0f172a"
                  >
                    {p.caption}
                  </text>
                </>
              )}
              {big && (
                <text x={x} y={g.h - 8} textAnchor="middle" fontSize={12} fill="#334155" fontWeight={500}>
                  {p.label}
                </text>
              )}
              {/* hit target larger than the mark */}
              <rect
                x={x - 40}
                y={g.padT - 10}
                width={80}
                height={g.h - g.padT - g.padB + 20}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-md"
          style={{ left: `${(xFor(hover, n, g) / g.w) * 100}%`, top: 0 }}
        >
          {points[hover].tooltip}
        </div>
      )}
    </div>
  );
}

export function QualityChart({ trend }: { trend: Trend }) {
  const [table, setTable] = useState(false);
  const pts = trend.points;
  if (pts.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">
        Run both agent versions in Experiments to draw this chart.
      </div>
    );
  }
  const nCases = pts[0].n_cases;
  const big: Geo = { w: 640, h: 260, padL: 48, padR: 24, padT: 24, padB: 36 };
  const small: Geo = { w: 220, h: 90, padL: 24, padR: 24, padT: 18, padB: 18 };
  const vLabel = (p: Point) => `${p.label} (${p.config_id.split("@")[1]})`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {trend.frozen_set_id === "FROZEN-FULL-v1" ? "All 20 test cases" : `${nCases} development test cases`}
          {[...new Set(pts.map((p) => p.execution_mode))].map((m) => (
            <MockBadge key={m} mode={m} />
          ))}
        </div>
        <button type="button" onClick={() => setTable((v) => !v)} className="text-xs text-sky-700 hover:underline">
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>

      {table ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">Check</th>
              {pts.map((p) => (
                <th key={p.config_id}>{vLabel(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t border-slate-100 font-semibold">
              <td className="py-1">All checks pass</td>
              {pts.map((p) => (
                <td key={p.config_id}>
                  {p.pass_all_count}/{p.n_cases} ({pct(p.pass_all_rate)})
                </td>
              ))}
            </tr>
            {CHECK_ORDER.map((id) => (
              <tr key={id} className="border-t border-slate-100">
                <td className="py-1">{CHECK_NAMES[id]}</td>
                {pts.map((p) => {
                  const c = p.checks.find((x) => x.evaluator_id === id)!;
                  return (
                    <td key={p.config_id}>
                      {c.pass}/{c.total} ({pct(c.rate)})
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <LineChart
            g={big}
            big
            showTarget
            ariaLabel={`Share of cases where every check passes: ${pts.map((p) => `${p.label} ${pct(p.pass_all_rate)}`).join(", ")}`}
            points={pts.map((p) => ({
              label: vLabel(p),
              rate: p.pass_all_rate,
              caption: `${pct(p.pass_all_rate)} · ${p.pass_all_count}/${p.n_cases}`,
              tooltip: `${p.label}: ${p.pass_all_count} of ${p.n_cases} cases pass every check · ${p.critical_failures} with a critical failure · run ${p.run_id}`,
            }))}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {CHECK_ORDER.map((id) => {
              const series = pts.map((p) => ({ p, c: p.checks.find((x) => x.evaluator_id === id)! }));
              const first = series[0].c;
              const last = series[series.length - 1].c;
              const delta = first.rate !== null && last.rate !== null ? last.rate - first.rate : null;
              return (
                <div key={id} className="rounded-md border border-slate-200 px-3 pt-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-700">{CHECK_NAMES[id]}</span>
                    <span
                      className={cx(
                        "text-xs font-semibold tabular-nums",
                        delta === null || delta === 0 ? "text-slate-500" : delta > 0 ? "text-emerald-700" : "text-rose-700",
                      )}
                    >
                      {delta === null ? "—" : delta === 0 ? "no change" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta * 100))} pts`}
                    </span>
                  </div>
                  <LineChart
                    g={small}
                    ariaLabel={`${CHECK_NAMES[id]}: ${series.map((s) => `${s.p.label} ${s.c.pass}/${s.c.total}`).join(", ")}`}
                    points={series.map(({ p, c }) => ({
                      label: p.label,
                      rate: c.rate,
                      caption: `${c.pass}/${c.total}`,
                      tooltip: `${p.label}: ${c.pass} of ${c.total} pass`,
                    }))}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
