import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { SCENARIOS, SPLIT_ASSIGNMENT, SPLIT_VERSION } from "@/lib/domain/scenarios";
import { POLICIES } from "@/lib/domain/policies";
import { AGENT_CONFIGS } from "@/lib/agent/configs";

export async function GET() {
  await connection();
  return handle(async () =>
    ok({
      scenarios: SCENARIOS.map((s) => ({ ...s, split: SPLIT_ASSIGNMENT[s.case_id] ?? null })),
      split_version: SPLIT_VERSION,
      policies: POLICIES,
      agent_configs: AGENT_CONFIGS,
    }),
  );
}
