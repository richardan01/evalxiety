import { NextResponse, type NextRequest } from "next/server";

/**
 * Local-tool hardening for the API (runs, judge calls, reveals, approvals, and the data they read):
 * - reject requests whose Host is not a loopback name (DNS rebinding: a remote page served from
 *   `evil.example` whose DNS now points at 127.0.0.1 is same-origin from the browser's point of
 *   view, so only the Host header tells it apart) — applies to every method, reads included;
 * - reject cross-site mutating requests (CSRF): a web page on another origin must not be able to
 *   spend credits or trigger the irreversible held-out reveal;
 * - require a JSON body, which a plain HTML form cannot send without a CORS preflight.
 */

const DEFAULT_ALLOWED_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];

/** Hostnames the app may be addressed as. Extend with EVALXIETY_ALLOWED_HOSTS=a,b when binding elsewhere (e.g. a LAN name). */
export function allowedHostnames(env: Record<string, string | undefined> = process.env): Set<string> {
  const extra = (env.EVALXIETY_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_HOSTNAMES, ...extra]);
}

/** Hostname part of a Host header (port stripped, IPv6 kept in brackets), or null if unparseable. */
export function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when the Host header names a loopback host or one listed in EVALXIETY_ALLOWED_HOSTS. */
export function hostAllowed(hostHeader: string | null, extra?: string): boolean {
  const allowed = extra === undefined ? allowedHostnames() : allowedHostnames({ EVALXIETY_ALLOWED_HOSTS: extra });
  const hostname = hostnameOf(hostHeader);
  return hostname !== null && allowed.has(hostname);
}

export type GuardVerdict = { ok: true } | { ok: false; status: number; error: string };

const HOST_ERROR = "Host not allowed. Open the app at localhost, or add this host to EVALXIETY_ALLOWED_HOSTS.";

/** Pure decision so it can be unit-tested without a Next runtime. */
export function guard(
  req: { method: string; headers: { get(name: string): string | null } },
  allowed: Set<string> = allowedHostnames(),
): GuardVerdict {
  const host = req.headers.get("host");
  const hostname = hostnameOf(host);
  if (!hostname || !allowed.has(hostname)) {
    return { ok: false, status: 403, error: HOST_ERROR };
  }

  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return { ok: true };

  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return { ok: false, status: 403, error: "Cross-site request blocked" };
  }
  const origin = req.headers.get("origin");
  if (origin !== null) {
    // A malformed or "null" Origin (sandboxed frame, file://) is treated as cross-site, not as a crash.
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { ok: false, status: 403, error: "Cross-site request blocked" };
    }
    if (originHost !== (host ?? "").toLowerCase()) {
      return { ok: false, status: 403, error: "Cross-site request blocked" };
    }
  }

  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415, error: "Content-Type must be application/json" };
  }
  return { ok: true };
}

export function proxy(req: NextRequest) {
  const v = guard(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
