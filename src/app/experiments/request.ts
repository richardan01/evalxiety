/**
 * Fetch helper that keeps the HTTP status and body, so the UI can react to
 * 409 (paid-batch confirmation needed) and 423 (held-out locked) responses.
 * The shared getJSON/postJSON helpers only surface an error message.
 */
import type { BatchEstimate } from "./types";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; estimate?: BatchEstimate };

export async function apiRequest<T>(method: "GET" | "POST", url: string, payload?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, status: res.status, data: body as T };
  const details = Array.isArray(body.details) ? `: ${(body.details as string[]).join("; ")}` : "";
  return {
    ok: false,
    status: res.status,
    error: `${typeof body.error === "string" ? body.error : `${method} ${url} failed (${res.status})`}${details}`,
    estimate: (body.estimate as BatchEstimate | undefined) ?? undefined,
  };
}
