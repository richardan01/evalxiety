/**
 * Pricing agent configurations under test.
 *
 * BASELINE retrieves from a stale policy index (refreshed 2026-05-01) that does
 * not contain policy PRC-2026.2, and its prompt does not require effective-date
 * selection. CORRECTED retrieves the single policy effective on the decision
 * date and its prompt requires the agent to verify the effective window.
 * Everything else (model, effort, output schema, approval/citation instructions)
 * is identical, so differences in results are attributable to policy handling.
 */
import { POLICIES, selectEffectivePolicy } from "../domain/policies";
import type { PricingPolicy } from "../domain/schemas";

export type RetrievalStrategy = "stale_policy_index" | "effective_date_filtered";

export interface AgentConfig {
  config_id: string;
  label: string;
  role: "baseline" | "corrected";
  prompt_version: "pricing-prompt-v1" | "pricing-prompt-v2";
  retrieval_strategy: RetrievalStrategy;
  effort: "low" | "medium" | "high";
  description: string;
}

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    config_id: "pricing-agent@baseline-v1",
    label: "Baseline",
    role: "baseline",
    prompt_version: "pricing-prompt-v1",
    retrieval_strategy: "stale_policy_index",
    effort: "medium",
    description:
      "Retrieves policies from an index last refreshed 2026-05-01 (PRC-2025.1, PRC-2026.1 only). Prompt says to use the pricing policy provided; no effective-date selection rule.",
  },
  {
    config_id: "pricing-agent@corrected-v2",
    label: "Corrected",
    role: "corrected",
    prompt_version: "pricing-prompt-v2",
    retrieval_strategy: "effective_date_filtered",
    effort: "medium",
    description:
      "Retrieves the single policy effective on the decision date from the full registry. Prompt requires verifying the effective window (from inclusive, to exclusive).",
  },
];

export function getAgentConfig(configId: string): AgentConfig {
  const c = AGENT_CONFIGS.find((x) => x.config_id === configId);
  if (!c) throw new Error(`Unknown agent config: ${configId}`);
  return c;
}

/** The stale index's snapshot: policies it knew about on its last refresh. */
export const STALE_INDEX_POLICY_IDS = ["PRC-2026.1", "PRC-2025.1"]; // newest first, as the index returns them

export function retrievePolicies(strategy: RetrievalStrategy, decisionDate: string): PricingPolicy[] {
  if (strategy === "stale_policy_index") {
    return STALE_INDEX_POLICY_IDS.map((id) => POLICIES.find((p) => p.policy_id === id)!);
  }
  const effective = selectEffectivePolicy(decisionDate);
  return effective ? [effective] : [];
}
