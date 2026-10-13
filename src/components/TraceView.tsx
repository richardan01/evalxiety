/**
 * Read-only trace inspector. Shows the merchant request, the agent's
 * structured recommendation, and the exact evidence it was given — with cited
 * evidence highlighted so a reviewer can check every claim against its source.
 */
import type { Trace } from "@/lib/domain/schemas";
import { Badge, Card, JsonDetails, KeyValue, MockBadge, fmtDateTime, fmtPct, fmtRate, fmtUsd } from "./ui";

export function TraceHeader({ trace }: { trace: Trace }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <MockBadge mode={trace.execution_mode} />
      {trace.cache_hit && <Badge tone="blue" title="Replayed from the on-disk response cache — no new API spend">CACHED RESPONSE</Badge>}
      {trace.data_origin === "synthetic" && <Badge tone="neutral" title="Synthetic scenario — not production data">SYNTHETIC CASE</Badge>}
      {trace.data_origin === "user_supplied" && <Badge tone="neutral">USER-SUPPLIED CASE</Badge>}
      {trace.execution_error && <Badge tone="red">EXECUTION ERROR</Badge>}
      <span>
        <code className="font-mono">{trace.trace_id}</code> · case <b>{trace.case_id}</b> · {trace.agent_version} · {trace.prompt_version} ·
        retrieval {trace.retrieval_strategy}
      </span>
      <span>
        · model <code className="font-mono">{trace.model_id}</code>
        {trace.served_model_id && trace.served_model_id !== trace.model_id && (
          <Badge tone="amber" title="Server-side fallback served this request">served by {trace.served_model_id}</Badge>
        )}
      </span>
      <span>· {fmtDateTime(trace.timestamp)}</span>
      <span>· {trace.latency_ms.toLocaleString()} ms</span>
      {trace.token_usage && (
        <span>
          · {trace.token_usage.input_tokens.toLocaleString()} in / {trace.token_usage.output_tokens.toLocaleString()} out tokens ·{" "}
          {fmtUsd(trace.estimated_cost_usd, 4)}
        </span>
      )}
    </div>
  );
}

export function TraceView({ trace, highlightEvidence = [] }: { trace: Trace; highlightEvidence?: string[] }) {
  const s = trace.input;
  const out = trace.parsed_structured_output;
  const cited = new Set<string>([
    ...(out?.claims.flatMap((c) => c.evidence_ids) ?? []),
    ...(out?.approvals_required.map((a) => a.policy_evidence_id) ?? []),
    ...highlightEvidence,
  ]);

  return (
    <div className="space-y-4">
      <TraceHeader trace={trace} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="1 · Merchant request" subtitle={s.title}>
          <blockquote className="mb-3 border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-sm italic text-slate-800">
            “{s.request.message}”
          </blockquote>
          <KeyValue
            rows={[
              ["Merchant", `${s.merchant.name} (${s.merchant.size}, ${s.merchant.segment})`],
              ["Decision date", <b key="d">{s.decision_date}</b>],
              ["Requested", <b key="r">{fmtRate(s.request.requested_pricing.rate_bps, s.request.requested_pricing.per_txn_fee_usd)}</b>],
              ["Current pricing", s.current_pricing ? fmtRate(s.current_pricing.rate_bps, s.current_pricing.per_txn_fee_usd) : "new merchant"],
              ["Monthly volume", fmtUsd(s.monthly_volume_usd, 0)],
              ["Monthly transactions", s.monthly_transactions.toLocaleString()],
              [
                "Cost data",
                s.cost_data.status === "complete"
                  ? `${(s.cost_data.cost_bps / 100).toFixed(2)}% + $${s.cost_data.per_txn_cost_usd.toFixed(2)}`
                  : <span key="c" className="font-medium text-amber-700">missing — {s.cost_data.note}</span>,
              ],
              [
                "Exception",
                s.exception.status === "none" ? "none" : `${s.exception.status}${s.exception.promo_code ? ` (${s.exception.promo_code})` : ""}`,
              ],
            ]}
          />
        </Card>

        <Card title="2 · Agent recommendation" subtitle={out ? `Decision: ${out.decision.replace(/_/g, " ")}` : "No structured output"}>
          {trace.execution_error && (
            <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">{trace.execution_error}</p>
          )}
          {out ? (
            <KeyValue
              rows={[
                ["Recommended price", <b key="p">{fmtRate(out.recommended_pricing.rate_bps, out.recommended_pricing.per_txn_fee_usd)}</b>],
                ["Selected policy", <span key="sp"><b>{out.selected_policy_id}</b> (effective from {out.policy_effective_from})</span>],
                ["Cost basis used", `${(out.cost_basis_used.cost_bps / 100).toFixed(2)}% + $${out.cost_basis_used.per_txn_cost_usd.toFixed(2)} (${out.cost_basis_used.source})`],
                ["Revenue / month", fmtUsd(out.unit_economics.monthly_revenue_usd)],
                ["Cost / month", fmtUsd(out.unit_economics.monthly_cost_usd)],
                ["Gross profit / month", fmtUsd(out.unit_economics.monthly_gross_profit_usd)],
                ["Gross margin", <b key="m">{fmtPct(out.unit_economics.gross_margin_pct)}</b>],
                ["Minimum margin stated", `${fmtPct(out.minimum_margin_pct_required)} — ${out.meets_minimum_margin ? "meets" : "below"} (agent's claim)`],
                ["Discount vs list", fmtPct(out.discount_vs_list_pct)],
                [
                  "Human approval",
                  out.requires_human_approval ? (
                    <ul key="a" className="list-disc pl-4">
                      {out.approvals_required.map((a, i) => (
                        <li key={i}>
                          <b>{a.approver_role}</b> — {a.reason} <code className="text-xs">[{a.policy_evidence_id}]</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "not required (agent's claim)"
                  ),
                ],
                ["Data gaps", out.data_gaps.length ? out.data_gaps.join("; ") : "none reported"],
              ]}
            />
          ) : (
            <p className="text-sm text-slate-500">The agent did not return a parseable recommendation.</p>
          )}
        </Card>
      </div>

      {out && (
        <Card title="3 · Explanation and claims" subtitle="Each claim lists the evidence IDs the agent cited. Check them against the evidence pack below.">
          <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{out.explanation}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-3">Claim</th>
                <th className="py-1">Cited evidence</th>
              </tr>
            </thead>
            <tbody>
              {out.claims.map((c, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-3">{c.claim}</td>
                  <td className="py-1.5">
                    {c.evidence_ids.length === 0 ? (
                      <Badge tone="red">no evidence cited</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.evidence_ids.map((id) => {
                          const exists = trace.evidence_pack.some((e) => e.evidence_id === id);
                          return (
                            <a key={id} href={`#ev-${encodeURIComponent(id)}`}>
                              <Badge tone={exists ? "blue" : "red"} title={exists ? "In evidence pack" : "Not in the evidence pack supplied to the agent"}>
                                {id}
                                {!exists && " ✗"}
                              </Badge>
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card
        title="4 · Evidence pack supplied to the agent"
        subtitle={`Policies retrieved: ${trace.policy_context.map((p) => `${p.policy_id} (${p.effective_from} → ${p.effective_to ?? "open"})`).join(", ") || "none"}`}
      >
        <ul className="space-y-1 text-sm">
          {trace.evidence_pack.map((e) => (
            <li
              key={e.evidence_id}
              id={`ev-${encodeURIComponent(e.evidence_id)}`}
              className={cited.has(e.evidence_id) ? "rounded bg-sky-50 px-2 py-1 ring-1 ring-sky-200" : "px-2 py-1"}
            >
              <code className="mr-2 text-xs font-semibold text-slate-600">[{e.evidence_id}]</code>
              {e.text}
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-2">
        <JsonDetails summary="System prompt" value={trace.system_prompt} />
        <JsonDetails summary="User prompt (as sent)" value={trace.user_prompt} />
        <JsonDetails summary="Raw final response" value={trace.final_response ?? "(none)"} />
        <JsonDetails summary="Full trace JSON" value={trace} />
      </div>
    </div>
  );
}
