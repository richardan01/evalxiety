import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { withAgentErrors } from "@/lib/agents/api";
import { TestBody, testConnection } from "@/lib/agents/onboard";

/**
 * POST /api/onboard/test → call the endpoint once with a sample input and suggest starter checks from the reply.
 * Nothing is stored. 200 { result: { output, evidence, latency_ms, error }, suggested_checks } · 400 unsafe or missing secret
 */
export async function POST(req: Request) {
  await connection();
  return handle(() => withAgentErrors(async () => ok(await testConnection(TestBody.parse(await req.json().catch(() => null))))));
}
