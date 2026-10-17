/**
 * The Claude API key a user connects from the UI (their own API credit).
 *
 * Stored server-side in <data dir>/private/ai-connection.json (git-ignored, mode 0600) and never sent back to the
 * browser — only a masked hint is. Read synchronously (tiny file) so modeInfo() can stay synchronous.
 * A connected key takes precedence over ANTHROPIC_API_KEY.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../storage/store";

const FILE = "private/ai-connection.json";
const file = () => path.join(/*turbopackIgnore: true*/ dataDir(), FILE);

export function readConnectedKey(): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8")) as { api_key?: unknown };
    return typeof parsed.api_key === "string" && parsed.api_key ? parsed.api_key : null;
  } catch {
    return null;
  }
}

export function saveConnectedKey(apiKey: string): void {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ api_key: apiKey, connected_at: new Date().toISOString() }) + "\n", { mode: 0o600 });
}

export function clearConnectedKey(): void {
  fs.rmSync(file(), { force: true });
}

export const maskKey = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;

/** Key the app will use right now, and where it came from. */
export function activeKey(): { key: string; source: "connected" | "env" } | null {
  const connected = readConnectedKey();
  if (connected) return { key: connected, source: "connected" };
  const env = process.env.ANTHROPIC_API_KEY;
  return env ? { key: env, source: "env" } : null;
}
