import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { SCENARIOS, SPLIT_ASSIGNMENT, SPLIT_VERSION } from "@/lib/domain/scenarios";
import { POLICIES } from "@/lib/domain/policies";
import { AGENT_CONFIGS } from "@/lib/agent/configs";
import { getHeldoutState } from "@/lib/storage/repos";

export async function GET() {
  await connection();
  return handle(async () => {
    // Held-out case content stays out of reach until the audited reveal (reading it first would let it leak into prompts).
    const revealed = (await getHeldoutState()).revealed;
    return ok({
      scenarios: SCENARIOS.map((s) => ({ ...s, split: SPLIT_ASSIGNMENT[s.case_id] ?? null })).filter((s) => revealed || s.split !== "heldout"),
      split_version: SPLIT_VERSION,
      policies: POLICIES,
      agent_configs: AGENT_CONFIGS,
    });
  });
}
