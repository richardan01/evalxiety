"use client";

/**
 * Compact trace summary: just what a reviewer needs to answer the rubric
 * checklist. The full trace (prompts, evidence pack, raw JSON) is one click away.
 * Reference rows show POLICY DATA (what a pricing reviewer would look up) — never
 * an automated verdict.
 */
import { useState } from "react";
import type { Trace } from "@/lib/domain/schemas";
import type { PricingPolicy } from "@/lib/domain/schemas";
import { TraceView } from "@/components/TraceView";
import { Badge, cx, fmtPct, fmtRate, fmtUsd } from "@/components/ui";

const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}k` : `$${n}`);

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cx("text-sm", strong ? "font-semibold text-slate-900" : "text-slate-800")}>{children}</div>
    </div>
  );
}

export function ReviewCard({ trace, policies }: { trace: Trace; policies: PricingPolicy[] | null }) {
  const [full, setFull] = useState(false);
  const [why, setWhy] = useState(false);
  const [allClaims, setAllClaims] = useState(false);
  const [gaps, setGaps] = useState(false);
  const s = trace.input;
  const o = trace.parsed_structured_output;
  const size = s.merchant.size;
  const supplied = new Set(trace.policy_context.map((p) => p.policy_id));
  const packIds = new Set(trace.evidence_pack.map((e) => e.evidence_id));

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
        <Row label="Merchant">
          {s.merchant.name} · {size} · {s.merchant.segment.replace(/_/g, " ")}
        </Row>
        <Row label="Asked for" strong>
          {fmtRate(s.request.requested_pricing.rate_bps, s.request.requested_pricing.per_txn_fee_usd)}
          <span className="ml-2 font-normal text-slate-500">“{s.request.message}”</span>
        </Row>
        <Row label="Decision date" strong>
          {s.decision_date}
        </Row>
        <Row label="Facts">
          {money(s.monthly_volume_usd)}/mo · {s.monthly_transactions.toLocaleString()} txns · cost{" "}
          {s.cost_data.status === "complete" ? (
            fmtRate(s.cost_data.cost_bps, s.cost_data.per_txn_cost_usd)
          ) : (
            <Badge tone="amber">missing</Badge>
          )}{" "}
          · {s.exception.status === "none" ? "no exception" : `${s.exception.status.replace(/_/g, " ")}${s.exception.promo_code ? ` ${s.exception.promo_code}` : ""}`}
        </Row>
        <div className="my-1 border-t border-slate-100" />
        {!o ? (
          <Row label="Agent">
            <span className="text-rose-700">No usable answer: {trace.execution_error ?? "unknown error"}</span>
          </Row>
        ) : (
          <>
            <Row label="Agent said" strong>
              <span className="uppercase">{o.decision.replace(/_/g, " ")}</span> ·{" "}
              {fmtRate(o.recommended_pricing.rate_bps, o.recommended_pricing.per_txn_fee_usd)}
            </Row>
            <Row label="Policy used">
              <b>{o.selected_policy_id}</b>
              <span className="ml-2 text-xs text-slate-500">
                retrieved: {[...supplied].join(", ") || "none"}
              </span>
            </Row>
            <Row label="Margin">
              <b>{fmtPct(o.unit_economics.gross_margin_pct)}</b> vs floor it used {fmtPct(o.minimum_margin_pct_required, 0)}
              <span className="ml-2 text-xs text-slate-500">
                rev {fmtUsd(o.unit_economics.monthly_revenue_usd, 0)} − cost {fmtUsd(o.unit_economics.monthly_cost_usd, 0)} (cost basis{" "}
                {fmtRate(o.cost_basis_used.cost_bps, o.cost_basis_used.per_txn_cost_usd)}, {o.cost_basis_used.source.replace("_", " ")})
              </span>
            </Row>
            <Row label="Approvals">
              {o.approvals_required.length === 0 ? (
                <span className="text-slate-500">none</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {o.approvals_required.map((a) => (
                    <Badge key={a.approver_role} tone="neutral" title={a.reason}>
                      {a.approver_role.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </span>
              )}
              <span className="ml-2 text-xs text-slate-500">discount vs list {fmtPct(o.discount_vs_list_pct, 1)}</span>
            </Row>
            <Row label="Reasons">
              <ul className="space-y-1">
                {(allClaims ? o.claims : o.claims.slice(0, 3)).map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-1">
                    <span>{c.claim}</span>
                    {c.evidence_ids.length === 0 ? (
                      <Badge tone="red">no source</Badge>
                    ) : (
                      c.evidence_ids.map((id) => (
                        <Badge key={id} tone={packIds.has(id) ? "blue" : "red"} title={packIds.has(id) ? "In the evidence given to the agent" : "Not in the evidence given to the agent"}>
                          {id}
                          {!packIds.has(id) && " ✗"}
                        </Badge>
                      ))
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex flex-wrap gap-3 text-xs">
                {o.claims.length > 3 && (
                  <button type="button" onClick={() => setAllClaims((v) => !v)} className="text-sky-700 hover:underline">
                    {allClaims ? "Show fewer" : `Show all ${o.claims.length} reasons`}
                  </button>
                )}
                <button type="button" onClick={() => setWhy((v) => !v)} className="text-sky-700 hover:underline">
                  {why ? "Hide" : "Show"} full explanation
                </button>
                {o.data_gaps.length > 0 && (
                  <button type="button" onClick={() => setGaps((v) => !v)} className="text-amber-800 hover:underline">
                    Agent flagged {o.data_gaps.length} data gap{o.data_gaps.length > 1 ? "s" : ""} {gaps ? "▴" : "▾"}
                  </button>
                )}
              </div>
              {why && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{o.explanation}</p>}
              {gaps && (
                <ul className="mt-1 list-disc pl-4 text-xs text-amber-900">
                  {o.data_gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              )}
            </Row>
          </>
        )}
      </section>

      {policies && (
        <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Policy reference ({size})</div>
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="text-left">
                <th className="py-0.5 font-medium">Policy</th>
                <th className="font-medium">In force</th>
                <th className="font-medium">Min margin</th>
                <th className="font-medium">Discount limit</th>
                <th className="font-medium">Deal desk above</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-slate-700">
              {policies.map((p) => (
                <tr key={p.policy_id}>
                  <td className="py-0.5 font-mono">{p.policy_id}</td>
                  <td>
                    {p.effective_from} → {p.effective_to ? p.effective_to : "now"}
                  </td>
                  <td>{p.min_margin_pct[size]}%</td>
                  <td>{p.discount_approval_threshold_pct}%</td>
                  <td>{money(p.high_volume_threshold_usd)}/mo</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-500">“In force” end dates are exclusive. Missing cost data always needs pricing desk; strategic exceptions need the CFO delegate.</p>
        </section>
      )}

      <button
        type="button"
        onClick={() => setFull((v) => !v)}
        className="w-full rounded-md border border-dashed border-slate-300 py-1.5 text-xs text-slate-600 hover:bg-white"
      >
        {full ? "Hide" : "Show"} full trace — evidence pack, prompts, raw JSON
      </button>
      {full && <TraceView trace={trace} />}
    </div>
  );
}
