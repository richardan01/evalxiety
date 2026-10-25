/**
 * Agent secrets saved from the app (e.g. the token an agent's endpoint needs), so nobody has to edit .env.local and
 * restart. Stored server-side in <data dir>/private/agent-secrets.json (git-ignored, mode 0600) and never sent back to
 * the browser: the API only ever reports which names are set.
 *
 * The same naming rule as .env.local applies: an agent can only use EVALXIETY_AGENT_<AGENT_ID>_<SUFFIX>, so a saved
 * token can't be read by another agent's agent.json. A value saved here takes precedence over the same name in the
 * environment (saving it is the more recent, explicit act). Read synchronously: the file is tiny.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../storage/store";
import { AGENT_ENV_PREFIX, MIN_SECRET_LENGTH } from "./http";

const FILE = "private/agent-secrets.json";
const file = () => path.join(/*turbopackIgnore: true*/ dataDir(), FILE);

export function readAgentSecrets(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8")) as { secrets?: unknown };
    const s = parsed.secrets;
    if (!s || typeof s !== "object") return {};
    return Object.fromEntries(Object.entries(s as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[0].startsWith(AGENT_ENV_PREFIX)));
  } catch {
    return {};
  }
}

function write(secrets: Record<string, string>): void {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  // A fresh 0600 file renamed into place: `mode` only applies when a file is created.
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ secrets }) + "\n", { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, f);
}

/** Why a value can't be used as a secret (it could not be redacted safely from stored traces), or null if it can. */
export function secretValueProblem(value: string): string | null {
  if (/[\r\n\0]/.test(value)) return "The token must be on one line.";
  if (value.trim() !== value) return "The token can't start or end with a space.";
  if (value.length < MIN_SECRET_LENGTH) return `The token must be at least ${MIN_SECRET_LENGTH} characters.`;
  return null;
}

export function saveAgentSecret(name: string, value: string): void {
  write({ ...readAgentSecrets(), [name]: value });
}

export function deleteAgentSecret(name: string): boolean {
  const cur = readAgentSecrets();
  if (!(name in cur)) return false;
  delete cur[name];
  write(cur);
  return true;
}

/** What ${env:NAME} in agent headers resolves against: the environment, plus secrets saved in the app (app wins). */
export function agentEnv(): Record<string, string | undefined> {
  return { ...process.env, ...readAgentSecrets() };
}

/** Where a name is set, if anywhere. Never the value. */
export function secretSource(name: string): "app" | "env" | null {
  if (readAgentSecrets()[name]) return "app";
  return process.env[name] ? "env" : null;
}
