import { connection } from "next/server";
import { fail, handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { CreateBody, OnboardError, createAgent } from "@/lib/agents/onboard";

/**
 * POST /api/onboard → create a NEW agents/<id>/ folder (agent.json + cases.jsonl) from the wizard.
 * 201 { agent_id, cases, heldout, checks, token_env } · 409 the folder already exists (it is never overwritten) · 400 invalid
 */
export async function POST(req: Request) {
  await connection();
  return handle(() =>
    withAgentErrors(async () => {
      try {
        return ok(await createAgent(CreateBody.parse(await req.json().catch(() => null))), { status: 201 });
      } catch (err) {
        if (err instanceof OnboardError) return fail(err.status, err.message);
        throw err;
      }
    }),
  );
}
