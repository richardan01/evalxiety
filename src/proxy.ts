import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Host names the API answers to: loopback, plus any in EVALXIETY_ALLOWED_HOSTS (comma-separated, e.g. a LAN name). */
export function hostAllowed(hostHeader: string | null, extra = process.env.EVALXIETY_ALLOWED_HOSTS ?? ""): boolean {
  if (!hostHeader) return false;
  const name = hostHeader.toLowerCase().replace(/:\d+$/, "");
  return LOCAL_HOSTS.has(name) || extra.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).includes(name);
}

/**
 * Local-tool hardening for API calls:
 * - answer only to a local Host name (DNS rebinding): a page on evil.example that re-points its own domain at
 *   127.0.0.1 is "same-origin" to the browser, so without this it could read traces or start runs;
 * and for mutating calls (runs, judge calls, reveals, approvals):
 * - reject cross-site requests (CSRF): a web page on another origin must not be able to
 *   spend credits or trigger the irreversible held-out reveal;
 * - require a JSON body, which a plain HTML form cannot send without a CORS preflight.
 */
export function proxy(req: NextRequest) {
  if (!hostAllowed(req.headers.get("host"))) {
    return NextResponse.json({ error: "Host not allowed. Open the app at localhost, or add this host to EVALXIETY_ALLOWED_HOSTS." }, { status: 403 });
  }
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();

  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  // "Origin: null" (sandboxed iframes, file:// pages) or an unparsable origin is treated as cross-site, not a crash.
  let originHost: string | null = null;
  try {
    if (origin && origin !== "null") originHost = new URL(origin).host;
  } catch {
    /* unparsable */
  }
  const crossSite = (site !== null && site !== "same-origin" && site !== "none") || (origin !== null && (originHost === null || originHost !== host));
  if (crossSite) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
