import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { overviewView } from "@/lib/services";

/** GET /api/overview — dashboard stats (counts, latest candidate run, release status). */
export async function GET() {
  await connection();
  return handle(async () => ok(await overviewView()));
}
