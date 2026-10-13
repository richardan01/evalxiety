import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { MODEL_ID, modeInfo, readLedger } from "@/lib/llm/client";

export async function GET() {
  await connection();
  return handle(async () => ok({ ...modeInfo(), model_id: MODEL_ID, ledger: await readLedger() }));
}
