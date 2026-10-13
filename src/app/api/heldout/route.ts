import { connection } from "next/server";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/http";
import { getHeldoutState, revealHeldout } from "@/lib/storage/repos";

const Body = z.object({
  actor: z.string().trim().min(1, "actor (your name) is required"),
  reason: z.string().trim().min(10, "reason must be at least 10 characters"),
});

/** Held-out access state: { revealed, revealed_at, revealed_by, reason }. */
export async function GET() {
  await connection();
  return handle(async () => ok(await getHeldoutState()));
}

/**
 * Audited, irreversible reveal of the held-out split for the FINAL judge check.
 * A second reveal is refused (409) so the original audit record is never overwritten.
 */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = Body.parse(await req.json().catch(() => null));
    const current = await getHeldoutState();
    if (current.revealed) {
      return fail(
        409,
        `Held-out split was already revealed by ${current.revealed_by ?? "unknown"} at ${current.revealed_at ?? "unknown time"}; the reveal is irreversible and is not repeated.`,
      );
    }
    return ok(await revealHeldout(body.actor, body.reason));
  });
}
