import { NextResponse, type NextRequest } from "next/server";

/**
 * Local-tool hardening for mutating API calls (runs, judge calls, reveals, approvals):
 * - reject cross-site requests (CSRF): a web page on another origin must not be able to
 *   spend credits or trigger the irreversible held-out reveal;
 * - require a JSON body, which a plain HTML form cannot send without a CORS preflight.
 */
export function proxy(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();

  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  const crossSite = (site !== null && site !== "same-origin" && site !== "none") || (origin !== null && host !== null && new URL(origin).host !== host);
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
