import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { agentsDir } from "@/lib/agents/config";
import { agentsList } from "@/lib/agents/services";

/** GET /api/agents → { agents, problems, agents_dir } — every agent folder found, plus config problems by file/line. */
export async function GET() {
  await connection();
  return handle(async () => ok({ ...(await agentsList()), agents_dir: agentsDir() }));
}
