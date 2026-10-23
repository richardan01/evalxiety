/**
 * HTTP adapter against a real local server (real sockets): status codes, bodies, timeouts, refused connections,
 * redirects (refused, so a token can't follow them) and the response size cap.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { assertSafeConnection, callAgent, mapLimit, MAX_RESPONSE_BYTES, UnsafeConnectionError } from "./http";
import { HttpConnection, type AgentCase } from "./schemas";

let server: http.Server;
let base: string;
const seen: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url!, headers: req.headers, body });
      switch (req.url) {
        case "/ok":
          return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ output: { answer: "hi" }, evidence: [{ id: "e1", text: "t" }], cost_usd: 0.01 }));
        case "/text":
          return res.writeHead(200, { "Content-Type": "text/plain" }).end("plain answer");
        case "/empty":
          return res.writeHead(200).end("");
        case "/500":
          return res.writeHead(500).end("boom");
        case "/slow":
          return setTimeout(() => res.writeHead(200).end("late"), 2000);
        case "/redirect":
          return res.writeHead(302, { Location: `${base}/ok` }).end();
        case "/huge":
          res.writeHead(200, { "Content-Type": "text/plain" });
          return res.end("x".repeat(MAX_RESPONSE_BYTES + 1024));
        default:
          return res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const tc: AgentCase = { case_id: "c1", input: { question: "q" }, split: "dev" };
const conn = (path: string, over: Partial<HttpConnection> = {}) => HttpConnection.parse({ type: "http", url: `${base}${path}`, ...over });

describe("callAgent over a real socket", () => {
  it("sends {case_id, input} with the resolved headers and maps a structured reply", async () => {
    const r = await callAgent(conn("/ok"), tc, { Authorization: "Bearer t0k" });
    expect(r.error).toBeNull();
    expect(r.output).toEqual({ answer: "hi" });
    expect(r.evidence).toEqual([{ id: "e1", text: "t" }]);
    expect(r.cost_usd).toBe(0.01);
    const req = seen.find((s) => s.url === "/ok")!;
    expect(JSON.parse(req.body)).toEqual({ case_id: "c1", input: { question: "q" } });
    expect(req.headers.authorization).toBe("Bearer t0k");
  });

  it("plain text is the output; an empty body is an error", async () => {
    expect((await callAgent(conn("/text"), tc, {})).output).toBe("plain answer");
    const empty = await callAgent(conn("/empty"), tc, {});
    expect(empty.output).toBeNull();
    expect(empty.error).toMatch(/empty/);
  });

  it("a non-2xx response is an error that includes the status and body", async () => {
    const r = await callAgent(conn("/500"), tc, {});
    expect(r.output).toBeNull();
    expect(r.error).toBe("HTTP 500: boom");
  });

  it("times out", async () => {
    const r = await callAgent(conn("/slow", { timeout_ms: 200 }), tc, {});
    expect(r.error).toBe("Timed out after 200 ms");
  });

  it("refuses to follow a redirect (a token must not be forwarded)", async () => {
    const before = seen.filter((s) => s.url === "/ok").length;
    const r = await callAgent(conn("/redirect"), tc, { Authorization: "Bearer t0k" });
    expect(r.output).toBeNull();
    expect(r.error).not.toBeNull();
    expect(seen.filter((s) => s.url === "/ok").length).toBe(before); // the redirect target was never called
  });

  it("caps the response size", async () => {
    const r = await callAgent(conn("/huge"), tc, {});
    expect(r.output).toBeNull();
    expect(r.error).toMatch(/larger than 2 MB/);
  });

  it("explains a refused connection", async () => {
    const port = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    const r = await callAgent(HttpConnection.parse({ type: "http", url: `http://127.0.0.1:${port}/x` }), tc, {});
    expect(r.error).toMatch(/Connection refused .* is your agent running\?/);
  });
});

describe("mapLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
});

describe("metadata endpoints are refused", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://2852039166/", // decimal form of 169.254.169.254
    "http://0xa9fea9fe/", // hex form
    "http://[::ffff:169.254.169.254]/", // IPv4-mapped IPv6
    "http://[fe80::1]/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://100.100.100.200/",
  ])("%s", (url) => {
    expect(() => assertSafeConnection("my-bot", url, {})).toThrow(UnsafeConnectionError);
  });

  it.each(["http://localhost:3000/", "http://127.0.0.1:8080/run", "https://agent.example.com/run", "http://10.0.0.5/run", "http://192.168.1.20:9000/"])(
    "%s is allowed",
    (url) => {
      expect(() => assertSafeConnection("my-bot", url, {})).not.toThrow();
    },
  );
});
