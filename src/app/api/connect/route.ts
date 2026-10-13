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

/**
 * GET /api/connect → everything the Connect page needs to wire Claude Desktop / Claude Code to the
 * read-only MCP server in mcp/server.mjs: its absolute path, whether it exists, the API base URL it
 * calls, its tool list (from mcp/tools.json, the server's own source of truth) and the current mode.
 */
export async function GET(req: Request) {
  await connection();
  return handle(async () => {
    const mcpDir = path.join(process.cwd(), "mcp");
    const serverPath = path.join(mcpDir, "server.mjs");
    const tools = await readFile(path.join(mcpDir, "tools.json"), "utf8")
      .then((raw) => JSON.parse(raw) as ToolEntry[])
      .catch(() => [] as ToolEntry[]);
    return ok({
      server_path: serverPath,
      server_exists: await exists(serverPath),
      // Claude Desktop does not inherit your shell PATH, so its config should name node by absolute path.
      node_path: process.execPath,
      sdk_installed: await exists(path.join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "package.json")),
      api_base_url: baseUrl(req),
      tools: tools.map((t) => ({ name: t.name, description: t.summary })),
      mode: { ...modeInfo(), model_id: MODEL_ID },
    });
  });
}
