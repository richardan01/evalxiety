import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { listTraces } from "@/lib/storage/repos";

export async function GET() {
  await connection();
  return handle(async () => ok({ traces: await listTraces() }));
}
