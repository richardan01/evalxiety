/**
 * HTTP adapter: Evalxiety calls the user's agent once per case.
 *
 * Request:  POST <url>   Content-Type: application/json   body: { "case_id": "...", "input": <case input> }
 * Response: any JSON or text. If the JSON is an object with an `output` key, these optional keys are read too:
 *           evidence [{id, text}], tool_calls [{name, input, output, error}], model_id, cost_usd, metadata.
 *           Otherwise the whole body is the output.
 *
 * Safety: the URL and headers come only from agent.json on disk (never from a request body); secrets come from the
 * environment via ${env:NAME}, scoped to the agent, and are redacted from anything stored; redirects are refused so a
 * token can't be forwarded to another host; responses are capped in size.
 */
import { z } from "zod";
import { isEmptyOutput } from "./checks";
import { formatZodIssues } from "./config";
import { EvidenceRef, ToolCall, type AgentCase, type HttpConnection } from "./schemas";

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class MissingEnvError extends Error {}
export class UnsafeConnectionError extends Error {}

/**
 * An agent may only read environment variables named for it: EVALXIETY_AGENT_<AGENT_ID>_*, where AGENT_ID is the folder
 * name upper-cased with dashes as underscores (support-bot → EVALXIETY_AGENT_SUPPORT_BOT_TOKEN). So an agent.json
 * from a shared repo can't read ANTHROPIC_API_KEY, cloud credentials, or another agent's token and send it to its URL.
 */
export const AGENT_ENV_PREFIX = "EVALXIETY_AGENT_";
export const agentEnvPrefix = (agentId: string) => `${AGENT_ENV_PREFIX}${agentId.toUpperCase().replace(/-/g, "_")}_`;
const ENV_REF = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Every ${env:NAME} referenced in the headers. */
export function referencedEnv(headers: Record<string, string>): string[] {
  return [...new Set(Object.values(headers).flatMap((v) => [...v.matchAll(ENV_REF)].map((m) => m[1])))];
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export const isLoopback = (url: string) => LOOPBACK.has(new URL(url).hostname);

/**
 * True when NAME belongs to exactly this agent: EVALXIETY_AGENT_<AGENT_ID>_<SUFFIX> with a suffix of letters and digits
 * only. Agent ids can't contain "_", so the split is unambiguous: agent "support" can't read support-bot's
 * EVALXIETY_AGENT_SUPPORT_BOT_TOKEN (its suffix would be "BOT_TOKEN").
 */
export function envNameBelongsTo(agentId: string, name: string): boolean {
  const prefix = agentEnvPrefix(agentId);
  return name.startsWith(prefix) && /^[A-Z0-9]+$/.test(name.slice(prefix.length));
}

/** Refuse configurations that would leak a secret: another agent's or a non-agent env var, or clear text off this machine. */
export function assertSafeConnection(agentId: string, url: string, headers: Record<string, string>): void {
  const refs = referencedEnv(headers);
  const prefix = agentEnvPrefix(agentId);
  const bad = refs.filter((n) => !envNameBelongsTo(agentId, n));
  if (bad.length) {
    throw new UnsafeConnectionError(
      `agents/${agentId}/agent.json headers may only read environment variables named ${prefix}<NAME>, where NAME is letters and digits only (found: ${bad.join(", ")}). Rename the variable in .env.local, e.g. ${prefix}TOKEN.`,
    );
  }
  if (refs.length && new URL(url).protocol === "http:" && !isLoopback(url)) {
    throw new UnsafeConnectionError(`Refusing to send secrets over plain http:// to ${new URL(url).host}. Use https://, or an agent on localhost.`);
  }
}

export interface ResolvedHeaders {
  headers: Record<string, string>;
  /** Secret values that were substituted, by variable name — redacted from anything that gets stored. */
  secrets: Record<string, string>;
}

/**
 * Expand ${env:NAME} in header values. Throws listing every missing variable (no partial headers), and refuses a value
 * that isn't a valid one-line header value — naming only the variable, never the value.
 */
export function resolveHeaders(headers: Record<string, string>, env: Record<string, string | undefined> = process.env): ResolvedHeaders {
  const missing = new Set<string>();
  const invalid = new Set<string>();
  const secrets: Record<string, string> = {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v.replace(ENV_REF, (_m, name: string) => {
      const val = env[name];
      if (val === undefined || val === "") {
        missing.add(name);
        return "";
      }
      if (/[\r\n\0]/.test(val) || val.length < MIN_SECRET_LENGTH || val.trim() !== val) invalid.add(name);
      secrets[name] = val;
      return val;
    });
  }
  if (missing.size) {
    throw new MissingEnvError(`Set ${[...missing].join(", ")} in .env.local (used in agent.json connection.headers), then restart the app.`);
  }
  if (invalid.size) {
    throw new UnsafeConnectionError(
      `${[...invalid].join(", ")} must be one line, at least ${MIN_SECRET_LENGTH} characters, with no leading or trailing spaces (otherwise it can't be safely redacted from stored traces). Fix it in .env.local.`,
    );
  }
  return { headers: out, secrets };
}

/** Shorter secret values are refused: they would match ordinary text, and redacting them would mangle stored output. */
export const MIN_SECRET_LENGTH = 8;

/** The ways a server may echo a secret back inside JSON or HTML text: JSON-escaped, "/" escaped, \u-escaped, HTML-escaped. */
function escapedForms(v: string): string[] {
  const json = JSON.stringify(v).slice(1, -1);
  const unicode = [...v].map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
  const unicodeUpper = unicode.replace(/\\u([0-9a-f]{4})/g, (_m, h: string) => `\\u${h.toUpperCase()}`);
  const html = v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const goJson = json.replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return [...new Set([v, json, json.replace(/\//g, "\\/"), unicode, unicodeUpper, html, goJson, goJson.replace(/\//g, "\\/")])];
}

/**
 * Replace every secret value with [REDACTED:NAME]: in every string at any depth (and in numbers that spell a secret),
 * longest secret first, including the escaped forms a server might echo back in JSON or HTML text.
 */
export function redactSecrets<T>(value: T, secrets: Record<string, string>): T {
  const entries = Object.entries(secrets)
    .filter(([, v]) => v.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b[1].length - a[1].length)
    .flatMap(([name, v]) => escapedForms(v).map((form) => [name, form] as const));
  if (!entries.length) return value;
  const scrub = (s: string) => entries.reduce((acc, [name, form]) => acc.split(form).join(`[REDACTED:${name}]`), s);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrub(v);
    if (typeof v === "number" || typeof v === "bigint") {
      const s = String(v);
      const out = scrub(s);
      return out === s ? v : out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [scrub(k), walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Redact a raw body: parse it as JSON when possible (so escaping can't hide a match), else scrub the text and its escapes. */
export function redactText(text: string, secrets: Record<string, string>): string {
  if (/^\s*[[{"]/.test(text)) {
    try {
      return JSON.stringify(redactSecrets(JSON.parse(text), secrets));
    } catch {
      /* not JSON: fall through */
    }
  }
  return redactSecrets(text, secrets);
}

const StructuredResponse = z.looseObject({
  output: z.unknown(),
  error: z.string().nullable().optional(),
  evidence: z.array(EvidenceRef).optional(),
  tool_calls: z.array(ToolCall).optional(),
  model_id: z.string().optional(),
  cost_usd: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export interface AgentCallResult {
  output: unknown;
  evidence: z.infer<typeof EvidenceRef>[];
  tool_calls: z.infer<typeof ToolCall>[];
  model_id: string | null;
  cost_usd: number | null;
  latency_ms: number;
  error: string | null;
  metadata: Record<string, unknown>;
}

const KNOWN_KEYS = new Set(["output", "error", "evidence", "tool_calls", "model_id", "cost_usd", "metadata"]);

/**
 * Map a response body to trace fields. Pure, for tests. Keys outside the contract are kept under metadata rather than
 * dropped. An empty answer is an error unless the agent opted in with allow_empty_output.
 */
export function mapResponse(body: unknown, allowEmpty = false): Omit<AgentCallResult, "latency_ms"> {
  if (body && typeof body === "object" && !Array.isArray(body) && "output" in body) {
    const parsed = StructuredResponse.safeParse(body);
    if (!parsed.success) {
      return {
        output: (body as { output: unknown }).output ?? null,
        evidence: [],
        tool_calls: [],
        model_id: null,
        cost_usd: null,
        error: `Response has an "output" key but other fields don't match the trace contract: ${formatZodIssues(parsed.error)}`,
        metadata: { raw_response: body },
      };
    }
    const r = parsed.data;
    const output = r.output ?? null;
    const extras = Object.fromEntries(Object.entries(r).filter(([k]) => !KNOWN_KEYS.has(k)));
    return {
      output,
      evidence: r.evidence ?? [],
      tool_calls: r.tool_calls ?? [],
      model_id: r.model_id ?? null,
      cost_usd: r.cost_usd ?? null,
      // "" and null mean "no error"; an empty answer is an error in its own right.
      error: r.error || (!allowEmpty && isEmptyOutput(output) ? "The agent returned no output" : null),
      metadata: { ...extras, ...(r.metadata ?? {}) },
    };
  }
  const empty = !allowEmpty && isEmptyOutput(body);
  return { output: empty ? null : body, evidence: [], tool_calls: [], model_id: null, cost_usd: null, error: empty ? "The agent returned an empty response" : null, metadata: {} };
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`Response is larger than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function callAgent(
  conn: HttpConnection,
  testCase: AgentCase,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  opts: { secrets?: Record<string, string>; allowEmpty?: boolean } = {},
): Promise<AgentCallResult> {
  // Redact before anything is cut short: a secret split by truncation could no longer be matched.
  const clean = (s: string) => redactText(s, opts.secrets ?? {});
  const started = performance.now();
  const empty = { output: null, evidence: [], tool_calls: [], model_id: null, cost_usd: null, metadata: {} };
  try {
    const res = await fetchImpl(conn.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/plain", ...headers },
      body: JSON.stringify({ case_id: testCase.case_id, input: testCase.input }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(conn.timeout_ms),
    });
    const text = await readCapped(res);
    const latency_ms = performance.now() - started;
    if (!res.ok) {
      const body = clean(text);
      return { ...empty, latency_ms, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}` };
    }
    let body: unknown = text;
    if ((res.headers.get("content-type") ?? "").includes("json") || /^\s*[[{]/.test(text)) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { ...redactSecrets(mapResponse(body, opts.allowEmpty), opts.secrets ?? {}), latency_ms };
  } catch (e) {
    const latency_ms = performance.now() - started;
    const err = e as Error & { cause?: { code?: string } };
    const msg =
      err.name === "TimeoutError"
        ? `Timed out after ${conn.timeout_ms} ms`
        : err.cause?.code === "ECONNREFUSED"
          ? `Connection refused at ${conn.url} — is your agent running?`
          : `${err.message}${err.cause?.code ? ` (${err.cause.code})` : ""}`;
    return { ...empty, latency_ms, error: clean(msg) };
  }
}

/** Run `fn` over items with at most `limit` in flight; results keep input order. Stops starting new items after a failure. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let stopped = false;
  const worker = async () => {
    // After any failure, no worker starts another item (each call may cost the agent's owner money).
    while (!stopped && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (e) {
        stopped = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
