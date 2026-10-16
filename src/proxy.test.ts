import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { allowedHostnames, guard, hostAllowed, hostnameOf, proxy } from "./proxy";

function req(method: string, headers: Record<string, string>) {
  const h = new Headers(headers);
  return { method, headers: { get: (n: string) => h.get(n) } };
}

const LOCAL = { host: "127.0.0.1:3123" };
const JSON_POST = { ...LOCAL, "content-type": "application/json", "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3123" };

describe("API guard: Host allowlist (DNS rebinding)", () => {
  it("accepts loopback hosts with or without a port, for every method", () => {
    for (const host of ["127.0.0.1:3123", "localhost:3123", "[::1]:3123", "localhost", "LOCALHOST:3123"]) {
      expect(guard(req("GET", { host })).ok).toBe(true);
      expect(guard(req("POST", { ...JSON_POST, host, origin: `http://${host}` })).ok).toBe(true);
    }
  });

  it("rejects a rebound hostname even when Origin and Sec-Fetch-Site look same-origin", () => {
    const rebound = {
      host: "evil.example:3123",
      origin: "http://evil.example:3123",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    };
    const v = guard(req("POST", rebound));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(403);
      expect(v.error).toMatch(/^Host not allowed/);
    }
    // Reads are covered too: the same page must not be able to pull traces or the audit log.
    expect(guard(req("GET", { host: "evil.example:3123" })).ok).toBe(false);
  });

  it("rejects a missing or unparseable Host", () => {
    expect(guard(req("GET", {})).ok).toBe(false);
    expect(guard(req("GET", { host: "not a host" })).ok).toBe(false);
  });

  it("honours EVALXIETY_ALLOWED_HOSTS as an explicit opt-in", () => {
    const allowed = allowedHostnames({ EVALXIETY_ALLOWED_HOSTS: "devbox.lan, Eval.Internal" });
    expect(guard(req("GET", { host: "devbox.lan:3123" }), allowed).ok).toBe(true);
    expect(guard(req("GET", { host: "eval.internal" }), allowed).ok).toBe(true);
    expect(guard(req("GET", { host: "other.lan" }), allowed).ok).toBe(false);
    expect(allowedHostnames({}).has("devbox.lan")).toBe(false);
  });

  it("hostAllowed wraps the allowlist for callers that only have a Host header", () => {
    expect(hostAllowed("localhost:3123")).toBe(true);
    expect(hostAllowed("127.0.0.1:3123")).toBe(true);
    expect(hostAllowed("[::1]:3123")).toBe(true);
    expect(hostAllowed("evil.example:3123")).toBe(false);
    expect(hostAllowed(null)).toBe(false);
    expect(hostAllowed("devbox.lan:3123", "devbox.lan, other")).toBe(true);
  });

  it("hostnameOf strips ports and keeps IPv6 brackets", () => {
    expect(hostnameOf("localhost:3123")).toBe("localhost");
    expect(hostnameOf("[::1]:3123")).toBe("[::1]");
    expect(hostnameOf("127.0.0.1")).toBe("127.0.0.1");
    expect(hostnameOf(null)).toBeNull();
    expect(hostnameOf("")).toBeNull();
  });
});

describe("API guard: CSRF and content type on mutations", () => {
  it("accepts a same-origin JSON POST, including non-browser clients with no fetch metadata", () => {
    expect(guard(req("POST", JSON_POST)).ok).toBe(true);
    expect(guard(req("POST", { ...LOCAL, "content-type": "application/json; charset=utf-8" })).ok).toBe(true);
    expect(guard(req("POST", { ...LOCAL, "content-type": "application/json", "sec-fetch-site": "none" })).ok).toBe(true);
  });

  it("rejects cross-site fetch metadata", () => {
    for (const site of ["cross-site", "same-site"]) {
      expect(guard(req("POST", { ...JSON_POST, "sec-fetch-site": site }))).toEqual({
        ok: false,
        status: 403,
        error: "Cross-site request blocked",
      });
    }
  });

  it("rejects an Origin that does not match Host", () => {
    expect(guard(req("POST", { ...JSON_POST, origin: "http://localhost:3123" })).ok).toBe(false);
    expect(guard(req("POST", { ...JSON_POST, origin: "http://127.0.0.1:9999" })).ok).toBe(false);
  });

  it("treats a malformed or 'null' Origin as cross-site instead of throwing", () => {
    expect(() => guard(req("POST", { ...JSON_POST, origin: "null" }))).not.toThrow();
    expect(guard(req("POST", { ...JSON_POST, origin: "null" }))).toEqual({ ok: false, status: 403, error: "Cross-site request blocked" });
    expect(guard(req("POST", { ...JSON_POST, origin: "::garbage" })).ok).toBe(false);
  });

  it("requires a JSON content type on mutations only", () => {
    expect(guard(req("POST", { ...LOCAL, "content-type": "application/x-www-form-urlencoded" }))).toEqual({
      ok: false,
      status: 415,
      error: "Content-Type must be application/json",
    });
    expect(guard(req("POST", { ...LOCAL, "content-type": "text/plain" })).ok).toBe(false);
    expect(guard(req("DELETE", LOCAL)).ok).toBe(false);
    expect(guard(req("GET", LOCAL)).ok).toBe(true);
    expect(guard(req("HEAD", LOCAL)).ok).toBe(true);
    expect(guard(req("OPTIONS", LOCAL)).ok).toBe(true);
  });
});

describe("proxy (Next runtime wrapper)", () => {
  const nextReq = (host: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(new URL(`http://${host}/api/agents`), { method: init.method ?? "GET", headers: { host, ...(init.headers ?? {}) } });

  it("maps the guard verdict onto the response", () => {
    expect(proxy(nextReq("evil.example:3123")).status).toBe(403);
    expect(proxy(nextReq("127.0.0.1:3123")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(nextReq("127.0.0.1:3123", { method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" } })).status).toBe(403);
    expect(proxy(nextReq("127.0.0.1:3123", { method: "POST", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(proxy(nextReq("127.0.0.1:3123", { method: "POST", headers: { "content-type": "application/json" } })).headers.get("x-middleware-next")).toBe("1");
  });
});
