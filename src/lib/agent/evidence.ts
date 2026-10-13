/**
 * Evidence pack: the exact facts and policy text supplied to the agent, each
 * with a citable evidence ID. The LLM judge receives the same pack, so it can
 * only rely on evidence the agent actually had.
 */
import { policySections } from "../domain/policies";
import type { EvidenceItem, MerchantScenario, PricingPolicy } from "../domain/schemas";

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const rate = (bps: number, fee: number) => `${(bps / 100).toFixed(2)}% + $${fee.toFixed(2)} per transaction`;

export function merchantFacts(s: MerchantScenario): EvidenceItem[] {
  const f = (id: string, text: string): EvidenceItem => ({
    evidence_id: `FACT-${id}`,
    kind: "merchant_fact",
    source_id: s.case_id,
    text,
  });
  const facts: EvidenceItem[] = [
    f(
      "profile",
      `Merchant ${s.merchant.name} (${s.merchant.merchant_id}), size: ${s.merchant.size}, segment: ${s.merchant.segment}, customer for ${s.merchant.months_as_customer} months.`,
    ),
    f("volume", `Monthly processing volume: ${money(s.monthly_volume_usd)}.`),
    f(
      "transactions",
      `Monthly transaction count: ${s.monthly_transactions.toLocaleString("en-US")} (average ticket ${money(
        s.monthly_volume_usd / s.monthly_transactions,
      )}).`,
    ),
    s.cost_data.status === "complete"
      ? f(
          "cost",
          `Merchant-specific processing cost: ${(s.cost_data.cost_bps / 100).toFixed(2)}% of volume + $${s.cost_data.per_txn_cost_usd.toFixed(2)} per transaction.`,
        )
      : f("cost", `Merchant-specific processing cost data is UNAVAILABLE: ${s.cost_data.note}`),
    f(
      "current_pricing",
      s.current_pricing
        ? `Current pricing: ${rate(s.current_pricing.rate_bps, s.current_pricing.per_txn_fee_usd)}.`
        : "No current pricing (new merchant).",
    ),
    f(
      "request",
      `Merchant request (merchant's own words, unverified): "${s.request.message}" Requested pricing: ${rate(
        s.request.requested_pricing.rate_bps,
        s.request.requested_pricing.per_txn_fee_usd,
      )}.`,
    ),
    f("decision_date", `Pricing decision date: ${s.decision_date}.`),
    f(
      "exception",
      s.exception.status === "none"
        ? "No promotion or exception requested."
        : s.exception.status === "promotion"
          ? `Promotion requested: code ${s.exception.promo_code}. Context: ${s.exception.justification ?? "none"}.`
          : `Strategic exception requested. Context: ${s.exception.justification ?? "none"}.`,
    ),
  ];
  return facts;
}

export function policyEvidence(policies: PricingPolicy[]): EvidenceItem[] {
  return policies.flatMap((p) =>
    policySections(p).map((sec) => ({
      evidence_id: sec.evidence_id,
      kind: "policy_section" as const,
      source_id: p.policy_id,
      text: `${sec.heading}: ${sec.text}`,
    })),
  );
}

export function buildEvidencePack(s: MerchantScenario, policies: PricingPolicy[]): EvidenceItem[] {
  return [...merchantFacts(s), ...policyEvidence(policies)];
}

export function renderEvidence(items: EvidenceItem[]): string {
  return items.map((e) => `[${e.evidence_id}] ${e.text}`).join("\n");
}
