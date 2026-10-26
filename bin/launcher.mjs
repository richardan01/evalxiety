/**
 * `npx evalxiety`: start Evalxiety on this computer with one command.
 *
 * The npm package ships a prebuilt server (app/), the read-only MCP server (mcp/), the offline checker (cli/) and the
 * seed: the demo's data and the starter kit (seed/). Your files live in one folder, ~/Evalxiety unless --data says
 * otherwise:
 *   agents/       your agents (one folder each), plus the starter kit and the blank template, refreshed on every start
 *   data/         tests, reviews, approvals, audit logs, a connected API key (private/, mode 0600); seeded once
 *   settings.env  optional settings (MOCK_MODE, LIVE_SPEND_CAP_USD, …), one NAME=value per line
 *
 * The server listens on 127.0.0.1 only. Nothing calls the Claude API until you connect a key on the Connect page (or
 * set MOCK_MODE=false and ANTHROPIC_API_KEY in settings.env). Only Node's own modules are used here.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_NODE = [22, 12];
const DEFAULT_PORT = 3123; // what the MCP server and the docs assume
const HOST = "127.0.0.1";

export function version() {
  try {
    return JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

export function nodeTooOld(v = process.versions.node) {
  const [major, minor] = v.split(".").map(Number);
  return major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1]);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const COMMANDS = ["start", "mcp", "validate", "example-agent", "where", "help"];

/**
 * { command, data, port, open, url, rest }. --data works everywhere; --port, --no-open, --help and --version belong to
 * starting the app; --url to mcp. Anything else after a subcommand is that subcommand's (validate's agent id and file,
 * the toy agent's --version=v2), passed on untouched.
 */
export function parseArgs(argv) {
  const out = { command: "start", data: null, port: null, open: true, url: null, rest: [], version: false };
  const args = [...argv];
  if (args[0] && COMMANDS.includes(args[0])) out.command = args.shift();
  const own = out.command === "start" ? ["--data", "--port", "--no-open", "--help", "-h", "--version", "-v"] : out.command === "mcp" ? ["--data", "--url"] : ["--data"];
  while (args.length) {
    const a = args.shift();
    const [flag, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, null];
    if (!own.includes(flag)) {
      out.rest.push(a);
      continue;
    }
    const value = () => {
      const v = inline ?? args.shift();
      if (v === undefined || v === "") throw new UsageError(`${flag} needs a value.`);
      return v;
    };
    if (flag === "--data") out.data = value();
    else if (flag === "--port") {
      const p = Number(value());
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new UsageError("--port takes a port number, like 3123.");
      out.port = p;
    } else if (flag === "--url") out.url = value();
    else if (flag === "--no-open") out.open = false;
    else if (flag === "--help" || flag === "-h") out.command = "help";
    else if (flag === "--version" || flag === "-v") out.version = true;
  }
  if (out.command === "start" && out.rest.length) throw new UsageError(`Unknown option or command: ${out.rest[0]}. Run npx evalxiety --help.`);
  return out;
}

export class UsageError extends Error {}

export const HELP = `Evalxiety: decide whether your AI agent's new version is ready to ship.

  npx evalxiety                 start it and open it in your browser
  npx evalxiety where           show where your files are
  npx evalxiety mcp             the read-only connection for Claude Desktop / Claude Code
  npx evalxiety validate <agent> [answers.jsonl]
                                check an agent folder (and a file of answers) without starting it
  npx evalxiety example-agent [--version=v1|v2]
                                run the starter kit's toy agent, to try "Call my agent (HTTP)"

Options:
  --data <folder>   keep your files there instead of ~/Evalxiety (or set EVALXIETY_HOME)
  --port <number>   use this port (default: 3123, or the next free one)
  --no-open         don't open the browser
  --version         print the version

Everything stays on this computer. Nothing calls the Claude API until you connect a key on the Connect page.`;

// ---------------------------------------------------------------------------
// Your folder
// ---------------------------------------------------------------------------

export function homeDir(opts, env = process.env) {
  const raw = opts.data ?? env.EVALXIETY_HOME ?? path.join(os.homedir(), "Evalxiety");
  return path.resolve(raw.replace(/^~(?=$|[\\/])/, os.homedir()));
}

export const layout = (home) => ({
  home,
  data: path.join(home, "data"),
  agents: path.join(home, "agents"),
  settings: path.join(home, "settings.env"),
  server: path.join(home, ".server.json"),
});

const isEmptyDir = (dir) => !existsSync(dir) || readdirSync(dir).length === 0;

/**
 * Copy the demo's data into a new data folder, once. An existing folder is never touched: it holds your work. The copy
 * goes to a temporary folder first, so an interrupted first run never leaves half a seed behind. Temporary files are
 * skipped.
 */
export function seedData(fromDir, toDir) {
  if (!isEmptyDir(toDir)) return false;
  if (!existsSync(fromDir)) {
    mkdirSync(toDir, { recursive: true });
    return true;
  }
  const tmp = `${toDir}.seeding-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(fromDir, tmp, { recursive: true, filter: (src) => !src.endsWith(".tmp") });
  rmSync(toDir, { recursive: true, force: true }); // an empty folder, checked above
  renameSync(tmp, toDir);
  return true;
}

/** The starter kit and the blank template belong to Evalxiety: they're replaced on every start (yours are left alone). */
export const OWNED_AGENTS = ["example-support-bot", "_template"];

export function refreshStarterKit(seedAgents, agentsDir) {
  mkdirSync(agentsDir, { recursive: true });
  for (const name of OWNED_AGENTS) {
    const from = path.join(seedAgents, name);
    if (!existsSync(from)) continue;
    const to = path.join(agentsDir, name);
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
}

const FOLDER_README = `This folder holds everything Evalxiety knows. Nothing in it is sent anywhere.

  agents/        one folder per agent: agent.json (rules, AI reviewer question, how to call it) and cases.jsonl
                 (test cases). example-support-bot/ and _template/ are replaced on every start: don't edit them.
  data/          tests, answers, reviews, approvals and audit logs. data/private/ holds a connected API key and agent
                 tokens. Back this folder up; delete data/ to start over (the demo comes back on the next start).
  settings.env   optional: one NAME=value per line, e.g. LIVE_SPEND_CAP_USD=5

Start Evalxiety with: npx evalxiety
`;

export function prepareHome(home, seedDir = path.join(PACKAGE_DIR, "seed")) {
  const l = layout(home);
  mkdirSync(home, { recursive: true });
  const seeded = seedData(path.join(seedDir, "data"), l.data);
  refreshStarterKit(path.join(seedDir, "agents"), l.agents);
  if (!existsSync(path.join(home, "README.txt"))) writeFileSync(path.join(home, "README.txt"), FOLDER_README);
  return { ...l, seeded };
}

/** settings.env: NAME=value lines; # comments; optional quotes. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const quoted = m[2].match(/^(['"])(.*)\1$/);
    out[m[1]] = quoted ? quoted[2] : m[2].replace(/\s+#.*$/, "");
  }
  return out;
}

const readSettings = (file) => (existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {});

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

export function portFree(port, host = HOST) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

/** The port asked for (refused if taken), or 3123, or the next free one up to 3199. */
export async function pickPort(wanted) {
  if (wanted) {
    if (await portFree(wanted)) return wanted;
    throw new UsageError(`Port ${wanted} is in use. Pick another with --port, or leave it out to use a free one.`);
  }
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + 77; p++) if (await portFree(p)) return p;
  throw new UsageError(`Ports ${DEFAULT_PORT}–${DEFAULT_PORT + 76} are all in use. Pick one with --port.`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The Evalxiety already serving this folder, if any. */
export function runningServer(serverFile) {
  try {
    const s = JSON.parse(readFileSync(serverFile, "utf8"));
    return typeof s.url === "string" && Number.isInteger(s.pid) && pidAlive(s.pid) ? s : null;
  } catch {
    return null;
  }
}

async function waitUntilUp(url, child, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${url}/api/mode`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const p = spawn(cmd, args, { stdio: "ignore", detached: true });
    p.on("error", () => {}); // no browser here (a server, CI): the URL is printed anyway
    p.unref();
  } catch {
    /* same */
  }
}

/** What the prebuilt server gets: your folders, loopback only, production. Your own environment wins over settings.env. */
export function serverEnv(l, port, env = process.env) {
  return {
    ...readSettings(l.settings),
    ...env,
    EVALXIETY_DATA_DIR: l.data,
    EVALXIETY_AGENTS_DIR: l.agents,
    EVALXIETY_MCP_DIR: path.join(PACKAGE_DIR, "mcp"),
    EVALXIETY_LAUNCHER: "npx",
    // Next's standalone server binds to HOSTNAME, which many shells set to the machine's name: always loopback.
    HOSTNAME: HOST,
    PORT: String(port),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

async function start(opts) {
  const serverJs = path.join(PACKAGE_DIR, "app", "server.js");
  if (!existsSync(serverJs)) {
    throw new UsageError("This copy of Evalxiety has no prebuilt server (app/server.js). In a clone of the repository, run npm run dev instead.");
  }
  const l = prepareHome(homeDir(opts));
  const already = runningServer(l.server);
  if (already) {
    console.log(`Evalxiety is already running for ${l.home} at ${already.url}`);
    if (opts.open) openBrowser(already.url);
    return 0;
  }
  const port = await pickPort(opts.port);
  const url = `http://${HOST}:${port}`;
  const env = serverEnv(l, port);
  console.log(`Starting Evalxiety ${version()}…`);
  const child = spawn(process.execPath, [serverJs], { cwd: path.dirname(serverJs), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  const keep = (b) => {
    log.push(String(b));
    if (log.length > 200) log.shift();
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const stop = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (!(await waitUntilUp(url, child))) {
    stop();
    console.error(`Evalxiety didn't start. What the server said:\n${log.join("").trim() || "(nothing)"}`);
    return 1;
  }
  writeFileSync(l.server, JSON.stringify({ url, pid: child.pid, launcher_pid: process.pid, version: version(), started_at: new Date().toISOString() }, null, 2));
  const live = env.MOCK_MODE?.toLowerCase() === "false" && Boolean(env.ANTHROPIC_API_KEY);
  console.log(
    [
      "",
      `  Evalxiety is running at ${url}`,
      "",
      `  Your files   ${l.home}${l.seeded ? "  (new: the demo and the starter kit are in it)" : ""}`,
      `  Claude API   ${live ? "live: billed calls, capped by LIVE_SPEND_CAP_USD" : "not called until you connect a key on the Connect page"}`,
      "  Stop         Ctrl+C",
      "",
    ].join("\n"),
  );
  if (opts.open && !process.env.CI) openBrowser(url);
  child.stdout.off("data", keep);
  child.stderr.off("data", keep);
  child.stderr.on("data", (b) => process.stderr.write(b)); // real errors from now on, not the startup chatter

  const code = await new Promise((resolve) => child.on("exit", (c, signal) => resolve(signal ? 0 : c ?? 0)));
  try {
    if (JSON.parse(readFileSync(l.server, "utf8")).pid === child.pid) rmSync(l.server, { force: true });
  } catch {
    /* gone already */
  }
  return code;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/** The MCP server talks JSON-RPC on stdout, so nothing else may print there. */
async function mcp(opts) {
  const l = layout(homeDir(opts));
  process.env.AGENTTRUST_URL ||= opts.url ?? runningServer(l.server)?.url ?? `http://${HOST}:${DEFAULT_PORT}`;
  await import(pathToFileURL(path.join(PACKAGE_DIR, "mcp", "server.mjs")).href);
  return null; // keeps running on stdio
}

async function validate(opts) {
  if (!opts.rest.length) throw new UsageError("Usage: npx evalxiety validate <agent-id> [answers.jsonl]");
  const l = prepareHome(homeDir(opts));
  process.env.EVALXIETY_AGENTS_DIR ||= l.agents;
  process.env.EVALXIETY_DATA_DIR ||= l.data;
  process.argv = [process.argv[0], "validate", ...opts.rest];
  await import(pathToFileURL(path.join(PACKAGE_DIR, "cli", "validate.mjs")).href);
  return null; // it sets the exit code
}

function exampleAgent(opts) {
  const l = prepareHome(homeDir(opts));
  const script = path.join(l.agents, "example-support-bot", "server.mjs");
  const child = spawn(process.execPath, [script, ...opts.rest], { stdio: "inherit" });
  return new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 0)));
}

function where(opts) {
  const l = layout(homeDir(opts));
  const running = runningServer(l.server);
  console.log(
    [
      `Your files   ${l.home}`,
      `  agents     ${l.agents}`,
      `  data       ${l.data}`,
      `  settings   ${l.settings}${existsSync(l.settings) ? "" : " (not created; optional)"}`,
      `Running      ${running ? running.url : "no"}`,
      `Version      ${version()}`,
    ].join("\n"),
  );
  return 0;
}

export async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.version) return console.log(version()), 0;
    switch (opts.command) {
      case "help":
        console.log(HELP);
        return 0;
      case "where":
        return where(opts);
      case "mcp":
        return await mcp(opts);
      case "validate":
        return await validate(opts);
      case "example-agent":
        return await exampleAgent(opts);
      default:
        return await start(opts);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}
