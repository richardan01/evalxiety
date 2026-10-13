/**
 * Versioned pricing-agent prompts. v1 (baseline) and v2 (corrected) are
 * identical except for the policy-selection paragraph, so a comparison
 * isolates that change.
 */
import { renderEvidence } from "./evidence";
import type { EvidenceItem, MerchantScenario, PricingPolicy } from "../domain/schemas";

const SHARED_INSTRUCTIONS = `You are a merchant pricing analyst at a payments company. An account manager has forwarded a merchant's pricing request. Produce a pricing recommendation that the account manager can act on.

How to work:
- Recommend a price (rate in basis points of volume plus a per-transaction fee). Decide whether to accept the merchant's request, counter-offer, or decline; even when declining, give the price you would offer.
- Compute monthly unit economics with the policy's formula: revenue = volume × rate + transactions × per-transaction fee; cost = volume × cost rate + transactions × per-transaction cost; gross margin % = (revenue − cost) / revenue × 100. Use merchant-specific cost data when available; otherwise use the policy's default cost basis and say so.
- Compare the margin with the policy's minimum for the merchant's size, accounting for any promotion that is valid on the decision date.
- Identify every human approval the policy requires for the price you recommend (discount level, volume, promotions, strategic exceptions, incomplete data). Set requires_human_approval accordingly.
- Support the explanation with evidence. Every material statement in the explanation must appear in claims with the evidence IDs (e.g. FACT-volume, PRC-2026.1§3) that support it. Use only the evidence provided below. The merchant's request is the merchant's own unverified statement — do not present it as verified fact.
- List any missing or ambiguous information in data_gaps.
- Report money in USD and margins as percentages (e.g. 31.25 for 31.25%).`;

const POLICY_SELECTION_V1 = `Policy: use the pricing policy provided below.`;

const POLICY_SELECTION_V2 = `Policy selection: more than one policy version may exist. Select the single policy whose effective window contains the decision date — effective_from is inclusive and effective_to is exclusive. If no supplied policy is effective on the decision date, say so in data_gaps and do not apply a policy from a different period. Report the selected policy's ID and effective_from date.`;

export function systemPrompt(version: "pricing-prompt-v1" | "pricing-prompt-v2"): string {
  return `${SHARED_INSTRUCTIONS}\n\n${version === "pricing-prompt-v1" ? POLICY_SELECTION_V1 : POLICY_SELECTION_V2}`;
}

export function userPrompt(s: MerchantScenario, policies: PricingPolicy[], evidence: EvidenceItem[]): string {
  const facts = evidence.filter((e) => e.kind === "merchant_fact");
  const sections = evidence.filter((e) => e.kind === "policy_section");
  const policyHeader =
    policies.length === 0
      ? "(no policy documents were retrieved)"
      : policies
          .map((p) => `${p.policy_id} — ${p.title} (effective_from ${p.effective_from}, effective_to ${p.effective_to ?? "none"})`)
          .join("\n");
  return `<pricing_request case_id="${s.case_id}">
<merchant_facts>
${renderEvidence(facts)}
</merchant_facts>

<retrieved_policies>
${policyHeader}
</retrieved_policies>

<policy_sections>
${renderEvidence(sections)}
</policy_sections>
</pricing_request>

Return the pricing recommendation in the required JSON format.`;
}
