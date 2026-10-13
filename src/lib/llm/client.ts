/**
 * Claude API access with credit controls.
 *
 * - Live calls happen only when MOCK_MODE=false AND an API key is configured.
 *   Anything else runs in mock mode, and every mock artifact is labelled.
 * - Live responses are cached on disk keyed by the full request, so re-running
 *   a frozen case does not spend credits twice (cache hits are labelled).
 * - A spend ledger enforces LIVE_SPEND_CAP_USD before each live call.
 *
 * Note: these are Claude API credits. They do not cover Claude Code usage.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { readJson, sha256, updateJson, writeJson } from "../storage/store";
import type { TokenUsage } from "../domain/schemas";

export const MODEL_ID = "claude-opus-5-5";
// Claude Opus 5.5 list price per million tokens (USD): $4 input, $20 output, $0.20 cache read, 1.25x input for cache writes.
const PRICE = { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } as const;

export interface ModeInfo {
  mode: "live" | "mock";
  reason: string;
  spend_cap_usd: number;
}

export function modeInfo(): ModeInfo {
  const rawCap = Number(process.env.LIVE_SPEND_CAP_USD ?? "10");
  // Fail closed: an unparseable or negative cap must never mean "no cap".
  if (!Number.isFinite(rawCap) || rawCap < 0) {
    return { mode: "mock", reason: "LIVE_SPEND_CAP_USD is not a valid non-negative number", spend_cap_usd: 0 };
  }
  const cap = rawCap;
  const mockFlag = (process.env.MOCK_MODE ?? "true").toLowerCase();
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (mockFlag !== "false") return { mode: "mock", reason: "MOCK_MODE is not set to false", spend_cap_usd: cap };
  if (!hasKey) return { mode: "mock", reason: "ANTHROPIC_API_KEY is not configured", spend_cap_usd: cap };
  return { mode: "live", reason: "MOCK_MODE=false and API key present", spend_cap_usd: cap };
}

export function estimateCostUsd(u: TokenUsage): number {
  return (
    (u.input_tokens * PRICE.input +
      u.output_tokens * PRICE.output +
      u.cache_read_input_tokens * PRICE.cache_read +
      u.cache_creation_input_tokens * PRICE.cache_write) /
    1_000_000
  );
}

// ---------------------------------------------------------------------------
// Spend ledger — reserve before calling, settle after
// ---------------------------------------------------------------------------
//
// The cap is enforced on committed spend = recorded spend + open reservations.
// Every live call first reserves its WORST-CASE cost under the ledger lock, so
// concurrent calls cannot jointly overshoot the cap; after the call the
// reservation is replaced by the actual cost. The lock is per server process:
// two processes sharing one data dir are not coordinated.

/** Claude Opus 5 / Opus 4.8 — the models a declined Opus 5.5 request can fall back to (server-side fallback). */
const FALLBACK_PRICE = { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } as const;
/** Tokens a request adds beyond its text (message framing, structured-output schema scaffolding). */
const INPUT_OVERHEAD_TOKENS = 2000;
/** Reservations older than this are treated as abandoned (process died mid-call); > SDK timeout × retries. */
const RESERVATION_TTL_MS = 60 * 60 * 1000;

const Reservation = z.object({ id: z.string(), at: z.string(), purpose: z.string(), reserved_usd: z.number() });
const Ledger = z.object({
  total_estimated_usd: z.number(),
  live_calls: z.number(),
  entries: z.array(
    z.object({ at: z.string(), purpose: z.string(), estimated_usd: z.number(), model: z.string() }),
  ),
  reservations: z.array(Reservation).default([]),
});
type Ledger = z.infer<typeof Ledger>;
const LEDGER_FILE = "spend_ledger.json";
const EMPTY_LEDGER: Ledger = { total_estimated_usd: 0, live_calls: 0, entries: [], reservations: [] };

export async function readLedger(): Promise<Ledger> {
  return readJson(LEDGER_FILE, Ledger, EMPTY_LEDGER);
}

const openReservations = (l: Ledger, now = Date.now()) =>
  l.reservations.filter((r) => now - Date.parse(r.at) < RESERVATION_TTL_MS);

/** Recorded spend plus budget held by in-flight calls. */
export function committedUsd(l: Ledger): number {
  return l.total_estimated_usd + openReservations(l).reduce((n, r) => n + r.reserved_usd, 0);
}

/**
 * Upper bound on what one call can cost: every input token at the cache-write
 * rate (a token always covers ≥ 1 byte, so bytes bound tokens), the full
 * max_tokens of output, and — because a refusal can be followed by a
 * server-side fallback in the same call — the same again at fallback prices.
 */
export function worstCaseCostUsd(inputBytes: number, maxTokens: number): number {
  const inTok = inputBytes + INPUT_OVERHEAD_TOKENS;
  const attempt = (p: { input: number; output: number; cache_write: number }) =>
    (inTok * Math.max(p.input, p.cache_write) + maxTokens * p.output) / 1_000_000;
  return attempt(PRICE) + attempt(FALLBACK_PRICE);
}

export const utf8Bytes = (...parts: string[]) => parts.reduce((n, p) => n + Buffer.byteLength(p, "utf8"), 0);

export class SpendCapError extends Error {}

/** Atomically reserve budget for one live call, or throw SpendCapError. Returns the reservation id. */
export async function reserveSpend(purpose: string, reservedUsd: number): Promise<string> {
  const cap = modeInfo().spend_cap_usd;
  const id = crypto.randomUUID();
  await updateJson(LEDGER_FILE, Ledger, EMPTY_LEDGER, (l) => {
    const committed = committedUsd(l);
    if (committed + reservedUsd > cap) {
      throw new SpendCapError(
        `Live spend cap would be exceeded: $${committed.toFixed(2)} committed ($${l.total_estimated_usd.toFixed(2)} spent + in-flight reservations) + up to $${reservedUsd.toFixed(2)} for this call > $${cap.toFixed(2)} cap. Raise LIVE_SPEND_CAP_USD deliberately to continue.`,
      );
    }
    return {
      ...l,
      reservations: [...openReservations(l), { id, at: new Date().toISOString(), purpose, reserved_usd: reservedUsd }],
    };
  });
  return id;
}

/** Release a reservation and record what the call actually cost (null = nothing billed / unknown). */
export async function settleSpend(reservationId: string, purpose: string, actualUsd: number | null, model: string | null) {
  await updateJson(LEDGER_FILE, Ledger, EMPTY_LEDGER, (l) => ({
    total_estimated_usd: l.total_estimated_usd + (actualUsd ?? 0),
    live_calls: l.live_calls + (actualUsd === null ? 0 : 1),
    entries:
      actualUsd === null
        ? l.entries
        : [...l.entries, { at: new Date().toISOString(), purpose, estimated_usd: actualUsd, model: model ?? MODEL_ID }],
    reservations: l.reservations.filter((r) => r.id !== reservationId),
  }));
}

// ---------------------------------------------------------------------------
// Structured call
// ---------------------------------------------------------------------------

export interface StructuredCallRequest {
  purpose: string; // e.g. "agent:C01" or "judge:trace_x"
  system: string;
  user: string;
  /** JSON output format — pass the result of betaZodOutputFormat(schema). */
  format: Anthropic.Beta.Messages.BetaJSONOutputFormat;
  effort: "low" | "medium" | "high";
  bypassCache?: boolean;
}

export interface StructuredCallResult {
  raw_text: string | null;
  served_model_id: string | null;
  stop_reason: string | null;
  usage: TokenUsage | null;
  estimated_cost_usd: number | null;
  latency_ms: number;
  cache_hit: boolean;
  error: string | null;
}

const CachedResponse = z.object({
  raw_text: z.string().nullable(),
  served_model_id: z.string().nullable(),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_read_input_tokens: z.number(),
    cache_creation_input_tokens: z.number(),
  }),
  estimated_cost_usd: z.number(),
  latency_ms: z.number(),
  cached_at: z.string(),
});

/** Output ceiling per structured call (thinking counts toward it). Also the basis of the spend reservation. */
const MAX_TOKENS = 16000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export async function callStructured(req: StructuredCallRequest): Promise<StructuredCallResult> {
  const info = modeInfo();
  if (info.mode !== "live") throw new Error(`callStructured requires live mode (${info.reason})`);

  const cacheKey = sha256({ model: MODEL_ID, system: req.system, user: req.user, schema: req.format.schema, effort: req.effort });
  const cacheFile = `llm_cache/${cacheKey}.json`;
  if (!req.bypassCache) {
    const hit = await readJson(cacheFile, CachedResponse.nullable(), null);
    if (hit) {
      return {
        raw_text: hit.raw_text,
        served_model_id: hit.served_model_id,
        stop_reason: hit.stop_reason,
        usage: hit.usage,
        estimated_cost_usd: 0, // no new spend; original cost is in the cache file
        latency_ms: hit.latency_ms,
        cache_hit: true,
        error: null,
      };
    }
  }

  const reservedUsd = worstCaseCostUsd(utf8Bytes(req.system, req.user, JSON.stringify(req.format.schema)), MAX_TOKENS);
  const reservationId = await reserveSpend(req.purpose, reservedUsd);
  let settled = false;
  const settle = async (usd: number | null, model: string | null) => {
    if (settled) return;
    settled = true;
    await settleSpend(reservationId, req.purpose, usd, model);
  };

  const started = Date.now();
  try {
    const response = await getClient().beta.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      // Server-side refusal fallback: if Claude Opus 5.5 declines, Anthropic re-runs the request on its
      // recommended fallback model. The model that actually answered is recorded as served_model_id.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      output_config: { effort: req.effort, format: req.format },
    });
    const latency = Date.now() - started;
    const text = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const usage: TokenUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    const cost = estimateCostUsd(usage);
    await settle(cost, response.model);

    const refused = response.stop_reason === "refusal";
    const truncated = response.stop_reason === "max_tokens";
    const result: StructuredCallResult = {
      raw_text: text || null,
      served_model_id: response.model,
      stop_reason: response.stop_reason,
      usage,
      estimated_cost_usd: cost,
      latency_ms: latency,
      cache_hit: false,
      error: refused
        ? `Model refused (category: ${response.stop_details?.category ?? "unknown"})`
        : truncated
          ? "Response truncated at max_tokens"
          : null,
    };
    // Only cache clean completions — never cache refusals or truncations.
    if (!result.error) {
      await writeJson(cacheFile, {
        raw_text: result.raw_text,
        served_model_id: result.served_model_id,
        stop_reason: result.stop_reason,
        usage,
        estimated_cost_usd: cost,
        latency_ms: latency,
        cached_at: new Date().toISOString(),
      });
    }
    return result;
  } catch (err) {
    // An error response from the API (4xx/5xx) is not billed: release the hold. Anything else
    // (timeout, dropped connection) may have been billed server-side, so record the worst case.
    await settle(err instanceof Anthropic.APIError && err.status ? null : reservedUsd, null);
    const latency = Date.now() - started;
    let message: string;
    if (err instanceof Anthropic.AuthenticationError) message = "Authentication failed — check ANTHROPIC_API_KEY";
    else if (err instanceof Anthropic.RateLimitError) message = "Rate limited — retry later";
    else if (err instanceof Anthropic.BadRequestError) message = `Bad request: ${err.message}`;
    else if (err instanceof Anthropic.APIError) message = `API error ${err.status}: ${err.message}`;
    else message = err instanceof Error ? err.message : String(err);
    return {
      raw_text: null,
      served_model_id: null,
      stop_reason: null,
      usage: null,
      estimated_cost_usd: null,
      latency_ms: latency,
      cache_hit: false,
      error: message,
    };
  }
}
