/**
 * Held-out protection at the single choke point every execution passes through
 * (runPricingAgent). Held-out cases must stay untouched until the audited reveal,
 * so this applies to single-case runs, batches, mock and live alike — and to
 * custom scenarios that copy a held-out case's content under a new ID.
 */
import { SCENARIOS, SPLIT_ASSIGNMENT } from "../domain/scenarios";
import type { MerchantScenario } from "../domain/schemas";
import { getHeldoutState } from "../storage/repos";
import { sha256 } from "../storage/store";

export class HeldoutAccessError extends Error {}

/** Scenario content without identity/labelling fields, so a renamed copy still matches. */
function contentHash(s: MerchantScenario): string {
  const content: Partial<MerchantScenario> = { ...s };
  delete content.case_id;
  delete content.variation;
  delete content.data_origin;
  return sha256(content);
}

let heldoutHashes: Map<string, string> | null = null;
function heldoutByContent(): Map<string, string> {
  heldoutHashes ??= new Map(
    SCENARIOS.filter((s) => SPLIT_ASSIGNMENT[s.case_id] === "heldout").map((s) => [contentHash(s), s.case_id]),
  );
  return heldoutHashes;
}

/** The held-out case this scenario is (by ID or by content), or null. */
export function heldoutCaseFor(scenario: MerchantScenario): string | null {
  if (SPLIT_ASSIGNMENT[scenario.case_id] === "heldout") return scenario.case_id;
  return heldoutByContent().get(contentHash(scenario)) ?? null;
}

export async function assertHeldoutUnlocked(scenario: MerchantScenario): Promise<void> {
  const caseId = heldoutCaseFor(scenario);
  if (!caseId) return;
  const state = await getHeldoutState();
  if (state.revealed) return;
  throw new HeldoutAccessError(
    `${caseId} is a held-out case and stays untouched until the final evaluation. Reveal held-out access first (Evaluators → Judge calibration → Reveal held-out) — the reveal is audited and irreversible.`,
  );
}
