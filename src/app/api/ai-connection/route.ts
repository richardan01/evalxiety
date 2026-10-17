import Anthropic from "@anthropic-ai/sdk";
import { connection } from "next/server";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/http";
import { MODEL_ID, modeInfo } from "@/lib/llm/client";
import { activeKey, clearConnectedKey, maskKey, saveConnectedKey } from "@/lib/llm/connection";

function status() {
  const active = activeKey();
  return { connected: Boolean(active), source: active?.source ?? null, key_hint: active ? maskKey(active.key) : null, model_id: MODEL_ID, mode: modeInfo().mode };
}

/** GET → connection status. The key itself is never returned. */
export async function GET() {
  await connection();
  return handle(async () => ok(status()));
}

const Body = z.object({ api_key: z.string().trim().min(1) });

/** POST { api_key } → verify the key with a free call (list models), then store it server-side. */
export async function POST(req: Request) {
  return handle(async () => {
    const { api_key } = Body.parse(await req.json());
    if (api_key.startsWith("sk-ant-oat")) {
      return fail(400, "That is a Claude subscription (OAuth) token. Subscriptions can't be used for API calls from other apps — paste an API key from console.anthropic.com instead, or use Claude Desktop / Claude Code with the MCP connection below.");
    }
    if (!api_key.startsWith("sk-ant-")) return fail(400, "That doesn't look like an Anthropic API key (it should start with sk-ant-).");
    try {
      await new Anthropic({ apiKey: api_key, maxRetries: 0 }).models.list({ limit: 1 });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return fail(400, "Anthropic rejected this key. Check it and try again.");
      return fail(502, `Couldn't verify the key: ${err instanceof Error ? err.message : String(err)}`);
    }
    saveConnectedKey(api_key);
    return ok(status());
  });
}

/** DELETE → forget the connected key (an ANTHROPIC_API_KEY env var, if any, then applies again). */
export async function DELETE() {
  return handle(async () => {
    clearConnectedKey();
    return ok(status());
  });
}
