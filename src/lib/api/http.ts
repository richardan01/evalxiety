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
    return fail(500, message);
  }
}
