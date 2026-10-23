import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export function fail(status: number, error: string, details?: unknown) {
  return NextResponse.json({ error, details }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Wrap a handler: Zod errors → 400, everything else → 500 with the message. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      return fail(400, "Invalid request", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    }
    const message = err instanceof Error ? err.message : String(err);
    // File-system and parse errors carry local paths and file contents: log them, return a reference instead.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (err instanceof SyntaxError || typeof code === "string" || message.includes(process.cwd())) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`[api] internal error ${ref}:`, err);
      return fail(500, `Internal error (ref ${ref}). The details are in the server log.`);
    }
    return fail(500, message);
  }
}
