/**
 * Tokens saved from the app: private on disk, scoped to their agent by name, never returned, and used by the same
 * header resolution as .env.local (so redaction and the plain-http refusal still apply).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { agentEnv, deleteAgentSecret, readAgentSecrets, saveAgentSecret, secretSource, secretValueProblem } from "./secrets";
import { testConnection } from "./onboard";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});
import { DELETE, GET, POST } from "@/app/api/agent-secrets/route";

let dir: string;
let server: http.Server;
let url: string;
let lastAuth: string | undefined;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-secrets-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  server = http.createServer((req, res) => {
    lastAuth = req.headers.authorization;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ output: "ok" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/answer`;
});
afterAll(async () => {
  delete process.env.EVALXIETY_AGENT_ENV_BOT_TOKEN;
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

const json = (body: unknown, method = "POST") => new Request("http://localhost/api/agent-secrets", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("agent secrets store", () => {
  it("is a private file, and a saved value wins over the environment", async () => {
    process.env.EVALXIETY_AGENT_ENV_BOT_TOKEN = "from-env-123";
    expect(secretSource("EVALXIETY_AGENT_ENV_BOT_TOKEN")).toBe("env");
    saveAgentSecret("EVALXIETY_AGENT_ENV_BOT_TOKEN", "from-app-456");
    expect(agentEnv().EVALXIETY_AGENT_ENV_BOT_TOKEN).toBe("from-app-456");
    expect(secretSource("EVALXIETY_AGENT_ENV_BOT_TOKEN")).toBe("app");
    const f = path.join(dir, "private", "agent-secrets.json");
    expect((await fs.stat(f)).mode & 0o777).toBe(0o600);
    expect(deleteAgentSecret("EVALXIETY_AGENT_ENV_BOT_TOKEN")).toBe(true);
    expect(agentEnv().EVALXIETY_AGENT_ENV_BOT_TOKEN).toBe("from-env-123");
  });

  it("refuses values that couldn't be redacted safely", () => {
    expect(secretValueProblem("short")).toMatch(/at least 8/);
    expect(secretValueProblem(" padded-token ")).toMatch(/space/);
    expect(secretValueProblem("two\nlines-token")).toMatch(/one line/);
    expect(secretValueProblem("a-good-token")).toBeNull();
  });
});

describe("/api/agent-secrets", () => {
  it("saves under the agent's own name and never returns the value", async () => {
    const saved = await POST(json({ agent_id: "tok-bot", value: "secret-token-789" }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ name: "EVALXIETY_AGENT_TOK_BOT_TOKEN", source: "app" });
    const listed = await GET(new NextRequest("http://localhost/api/agent-secrets?agent_id=tok-bot"));
    const text = await listed.text();
    expect(JSON.parse(text)).toEqual({ names: [{ name: "EVALXIETY_AGENT_TOK_BOT_TOKEN", source: "app" }] });
    expect(text).not.toContain("secret-token-789");
    // Another agent's list doesn't include it.
    const other = await GET(new NextRequest("http://localhost/api/agent-secrets?agent_id=tok"));
    expect((await other.json()).names).toEqual([]);
  });

  it("rejects bad ids, suffixes and values", async () => {
    expect((await POST(json({ agent_id: "Bad Id", value: "secret-token-789" }))).status).toBe(400);
    expect((await POST(json({ agent_id: "tok-bot", suffix: "bot_token", value: "secret-token-789" }))).status).toBe(400);
    const short = await POST(json({ agent_id: "tok-bot", value: "short" }));
    expect(short.status).toBe(400);
    expect((await short.json()).error).toMatch(/at least 8/);
  });

  it("is what the wizard's test call sends, with no .env.local edit or restart", async () => {
    await testConnection({ agent_id: "tok-bot", connection: { url, auth: { name: "Authorization", prefix: "Bearer " }, timeout_ms: 5000 }, sample_input: "hi" });
    expect(lastAuth).toBe("Bearer secret-token-789");
    const removed = await DELETE(json({ agent_id: "tok-bot" }, "DELETE"));
    expect(await removed.json()).toMatchObject({ name: "EVALXIETY_AGENT_TOK_BOT_TOKEN", removed: true, source: null });
    expect(readAgentSecrets()).toEqual({});
  });
});
