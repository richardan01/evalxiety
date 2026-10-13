import { connection, type NextRequest } from "next/server";
import { handle, ok, fail } from "@/lib/api/http";
import { getTrace } from "@/lib/storage/repos";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/traces/[id]">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const trace = await getTrace(id);
    return trace ? ok({ trace }) : fail(404, `Trace ${id} not found`);
  });
}
