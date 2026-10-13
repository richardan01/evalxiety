import { describe, expect, it } from "vitest";
import { postReveal } from "./HeldoutReveal";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const revealed = { revealed: true, revealed_at: "2026-10-13T00:00:00.000Z", revealed_by: "rich", reason: "Judge prompt frozen" };

describe("postReveal", () => {
  it("returns the new state on success", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return json(200, revealed);
    }) as typeof fetch;
    await expect(postReveal(" rich ", " Judge prompt frozen ", fetcher)).resolves.toEqual(revealed);
    expect(calls).toEqual(["POST /api/heldout"]);
  });

  it("treats 409 (already revealed elsewhere) as revealed and returns the current state", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return init?.method === "POST" ? json(409, { error: "already revealed" }) : json(200, revealed);
    }) as typeof fetch;
    await expect(postReveal("someone", "a long enough reason", fetcher)).resolves.toEqual(revealed);
    expect(calls).toEqual(["POST /api/heldout", "GET /api/heldout"]);
  });

  it("throws the API error on other failures", async () => {
    const fetcher = (async () => json(400, { error: "Invalid request", details: ["reason: too short"] })) as unknown as typeof fetch;
    await expect(postReveal("rich", "short", fetcher)).rejects.toThrow("Invalid request: reason: too short");
  });
});
