import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/http";
import { agentAudit } from "@/lib/agents/repo";
import { agentEnvPrefix, envNameBelongsTo } from "@/lib/agents/http";
import { AgentId } from "@/lib/agents/schemas";
import { deleteAgentSecret, readAgentSecrets, saveAgentSecret, secretSource, secretValueProblem } from "@/lib/agents/secrets";

/**
 * Secrets for an agent's endpoint, saved from the app instead of .env.local. Values are never returned: GET lists
 * which names are set and where. Works before the agent's folder exists, so the wizard can save a token and then test.
 * Mutating requests are same-origin JSON on a local Host only (proxy.ts), like every other write.
 */
const Suffix = z.string().regex(/^[A-Z0-9]{1,32}$/, "use capital letters and digits only, e.g. TOKEN").default("TOKEN");

const Save = z.object({
  agent_id: AgentId,
  suffix: Suffix,
  value: z.string().max(4096),
  actor: z.string().trim().max(100).optional(),
});

const Remove = z.object({ agent_id: AgentId, suffix: Suffix, actor: z.string().trim().max(100).optional() });

/** GET /api/agent-secrets?agent_id=… → { names: [{ name, source: "app" | "env" }] } (values are never returned) */
export async function GET(req: NextRequest) {
  await connection();
  return handle(async () => {
    const agentId = AgentId.parse(req.nextUrl.searchParams.get("agent_id") ?? "");
    const prefix = agentEnvPrefix(agentId);
    const names = new Set([...Object.keys(readAgentSecrets()), ...Object.keys(process.env)].filter((n) => n.startsWith(prefix) && envNameBelongsTo(agentId, n)));
    return ok({ names: [...names].sort().map((name) => ({ name, source: secretSource(name) })) });
  });
}

/** POST { agent_id, suffix?: "TOKEN", value } → { name, source: "app" } */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = Save.parse(await req.json().catch(() => null));
    const name = `${agentEnvPrefix(body.agent_id)}${body.suffix}`;
    const problem = secretValueProblem(body.value);
    if (problem) return fail(400, problem);
    saveAgentSecret(name, body.value);
    await agentAudit(body.agent_id, body.actor || "(not given)", "secret_saved", { name });
    return ok({ name, source: "app" });
  });
}

/** DELETE { agent_id, suffix? } → { name, removed } (an environment variable of the same name still applies) */
export async function DELETE(req: Request) {
  await connection();
  return handle(async () => {
    const body = Remove.parse(await req.json().catch(() => null));
    const name = `${agentEnvPrefix(body.agent_id)}${body.suffix}`;
    const removed = deleteAgentSecret(name);
    if (removed) await agentAudit(body.agent_id, body.actor || "(not given)", "secret_removed", { name });
    return ok({ name, removed, source: secretSource(name) });
  });
}
