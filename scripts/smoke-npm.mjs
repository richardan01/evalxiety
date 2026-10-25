#!/usr/bin/env node
/**
 * Starts the built npm package (dist/npm, from `npm run build:npm`) the way `npx evalxiety` does, on a temporary
 * folder, and checks what a first-time user gets. Runs in CI after the package build.
 *
 *   npm run build:npm && npm run smoke:npm
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "dist", "npm", "bin", "evalxiety.mjs");
if (!existsSync(BIN)) {
  console.error("✕ No package to try: run npm run build:npm first.");
  process.exit(1);
}
const home = mkdtempSync(path.join(os.tmpdir(), "evalxiety-smoke-"));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✕"} ${what}`);
  if (!ok) failures.push(what);
};
// No Claude API key, whatever the machine has: a first run must work without one.
const env = { ...process.env, ANTHROPIC_API_KEY: "", MOCK_MODE: "", CI: "1" };
const run = (...args) => spawnSync(process.execPath, [BIN, ...args, "--data", home], { encoding: "utf8", env });

const app = spawn(process.execPath, [BIN, "--data", home, "--no-open"], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
app.stdout.on("data", (b) => (out += b));
app.stderr.on("data", (b) => (out += b));
const url = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), 90_000);
  const look = () => {
    const m = out.match(/running at (http:\/\/127\.0\.0\.1:\d+)/);
    if (m) {
      clearTimeout(t);
      resolve(m[1]);
    }
  };
  app.stdout.on("data", look);
  app.on("exit", () => resolve(null));
});

try {
  check(Boolean(url), `starts and says where (${url ?? out.trim().slice(-300)})`);
  if (url) {
    const get = async (p) => {
      const res = await fetch(url + p);
      return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
    };
    for (const p of ["/", "/agents", "/demo", "/agents/example-support-bot", "/connect"]) check((await get(p)).status === 200, `page ${p}`);
    const agents = await get("/api/agents");
    check(agents.body.agents?.some((a) => a.agent_id === "example-support-bot"), "the starter kit is there");
    check(agents.body.agents_dir === path.join(home, "agents"), "agents are read from your folder");
    const demo = await get("/api/overview");
    check(demo.status === 200, "the demo's data is there");
    const mode = await get("/api/mode");
    check(mode.body.mode === "mock" && mode.body.ledger?.total_estimated_usd === 0, "no Claude API calls, and spend starts at $0");
    const connect = await get("/api/connect");
    check(connect.body.launcher === "npx" && connect.body.command?.args?.join(" ") === "-y evalxiety mcp" && connect.body.server_exists, "Connect gives npx's MCP setup");
    // fetch can't set Host, so ask the way a DNS-rebinding page would: a plain request naming another host.
    const foreign = await new Promise((resolve) => {
      const r = http.get(`${url}/api/agents`, { headers: { host: "evil.example" } }, (res) => (res.resume(), resolve(res.statusCode)));
      r.on("error", () => resolve(null));
    });
    check(foreign === 403, "refuses a foreign Host");
    check(JSON.parse(readFileSync(path.join(home, ".server.json"), "utf8")).url === url, "records where it runs (for npx evalxiety mcp)");

    const where = run("where");
    check(where.status === 0 && where.stdout.includes(`Running      ${url}`), "npx evalxiety where");
    const validate = run("validate", "example-support-bot");
    check(validate.status === 0 && validate.stdout.includes("✓ agents/example-support-bot"), "npx evalxiety validate");

    // The read-only MCP server finds the running app by itself.
    const mcp = spawnSync(process.execPath, [BIN, "mcp", "--data", home], {
      env,
      encoding: "utf8",
      timeout: 20_000,
      input:
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_my_agents", arguments: {} } },
        ]
          .map((m) => JSON.stringify(m))
          .join("\n") + "\n",
    });
    check(mcp.stdout.includes("example-support-bot"), "npx evalxiety mcp answers from the running app");
  }
} finally {
  app.kill("SIGINT");
  await new Promise((r) => (app.exitCode !== null ? r() : app.on("exit", r)));
  check(!existsSync(path.join(home, ".server.json")), "stops cleanly");
  rmSync(home, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\n✕ ${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ The npm package works for a first-time user.");
