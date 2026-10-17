import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { hostAllowed, proxy } from "./proxy";

const req = (host: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(new URL(`http://${host}/api/agents`), { method: init.method ?? "GET", headers: { host, ...(init.headers ?? {}) } });

describe("proxy", () => {
  it("answers only to local host names (blocks DNS rebinding)", () => {
    expect(hostAllowed("localhost:3123")).toBe(true);
    expect(hostAllowed("127.0.0.1:3123")).toBe(true);
    expect(hostAllowed("[::1]:3123")).toBe(true);
    expect(hostAllowed("evil.example:3123")).toBe(false);
    expect(hostAllowed(null)).toBe(false);
    expect(hostAllowed("devbox.lan:3123", "devbox.lan, other")).toBe(true);
    expect(proxy(req("evil.example:3123")).status).toBe(403);
    expect(proxy(req("127.0.0.1:3123")).headers.get("x-middleware-next")).toBe("1");
  });

  it("still blocks cross-site and non-JSON writes from a local host", () => {
    expect(proxy(req("127.0.0.1:3123", { method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" } })).status).toBe(403);
    expect(proxy(req("127.0.0.1:3123", { method: "POST", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(proxy(req("127.0.0.1:3123", { method: "POST", headers: { "content-type": "application/json" } })).headers.get("x-middleware-next")).toBe("1");
  });
});
