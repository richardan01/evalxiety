import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { MODEL_ID, modeInfo } from "@/lib/llm/client";

interface ToolEntry {
  name: string;
  summary: string;
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** Origin as the browser addressed it (Next normalises req.url to "localhost", which may not resolve to the bound 127.0.0.1). */
function baseUrl(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("host");
  return host ? `${url.protocol}//${host}` : url.origin;
}

/** Is the MCP SDK installed where Node will look for it from the server's folder (any node_modules above it)? */
async function sdkReachable(fromDir: string): Promise<boolean> {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (await exists(path.join(dir, "node_modules", "@modelcontextprotocol", "sdk", "package.json"))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/**
 * GET /api/connect → everything the Connect page needs to wire Claude Desktop / Claude Code to the
 * read-only MCP server in mcp/server.mjs: the command that starts it, whether it's there, the API base URL it
 * calls, its tool list (from mcp/tools.json, the server's own source of truth) and the current mode.
 *
 * Started with `npx evalxiety`, the command is `npx -y evalxiety mcp` (the npx cache can be cleared, so its paths
 * aren't stable); in a clone it's node with the absolute path of mcp/server.mjs.
 */
export async function GET(req: Request) {
  await connection();
  return handle(async () => {
    const npx = process.env.EVALXIETY_LAUNCHER === "npx";
    const mcpDir = process.env.EVALXIETY_MCP_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "mcp");
    const serverPath = path.join(mcpDir, "server.mjs");
    const tools = await readFile(path.join(mcpDir, "tools.json"), "utf8")
      .then((raw) => JSON.parse(raw) as ToolEntry[])
      .catch(() => [] as ToolEntry[]);
    // Claude Desktop does not inherit your shell PATH, so its config names node (or npx next to it) by absolute path.
    const npxPath = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npx.cmd" : "npx");
    const command = npx ? { command: (await exists(npxPath)) ? npxPath : "npx", args: ["-y", "evalxiety", "mcp"] } : { command: process.execPath, args: [serverPath] };
    return ok({
      launcher: npx ? "npx" : "repo",
      server_path: serverPath,
      server_exists: await exists(serverPath),
      command,
      sdk_installed: await sdkReachable(mcpDir),
      api_base_url: baseUrl(req),
      tools: tools.map((t) => ({ name: t.name, description: t.summary })),
      mode: { ...modeInfo(), model_id: MODEL_ID },
    });
  });
}
