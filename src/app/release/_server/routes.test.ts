/**
 * Route-level contract for /api/release, /api/release/approve, /api/overview and /api/audit
 * (status codes and body shapes). `connection()` needs a Next request context, so it is stubbed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

import { GET as getRelease } from "@/app/api/release/route";
import { POST as approve } from "@/app/api/release/approve/route";
import { GET as getOverview } from "@/app/api/overview/route";
import { GET as getAudit } from "@/app/api/audit/route";
import { audit } from "@/lib/storage/repos";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-routes-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  approve(new Request("http://localhost/api/release/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("release routes", () => {
  it("GET /api/release on an empty store → INSUFFICIENT_EVIDENCE with no candidate", async () => {
    const res = await getRelease(new NextRequest("http://localhost/api/release"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gate.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(body.candidate_run).toBeNull();
    expect(typeof body.evidence_snapshot_hash).toBe("string");
  });

  it("GET /api/release with an unknown run id → 404", async () => {
    const res = await getRelease(new NextRequest("http://localhost/api/release?candidate=run_missing"));
    expect(res.status).toBe(404);
  });

  it("POST /api/release/approve validates the body (named approver, notes on reject)", async () => {
    expect((await post({ approver: "", decision: "approved", candidate_run_id: "run_x" })).status).toBe(400);
    const res = await post({ approver: "rich", decision: "rejected", notes: "", candidate_run_id: "run_x" });
    expect(res.status).toBe(400);
    expect((await res.json()).details.join(" ")).toContain("notes");
  });

  it("POST /api/release/approve for an unknown candidate → 404", async () => {
    expect((await post({ approver: "rich", decision: "rejected", notes: "no", candidate_run_id: "run_x" })).status).toBe(404);
  });

  it("GET /api/overview returns the dashboard read model", async () => {
    const res = await getOverview();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.executions.total).toBe(0);
    expect(body.pass_all_rate).toBeNull();
    expect(body.critical_failures).toBeNull();
  });

  it("GET /api/audit returns newest first, capped at 200", async () => {
    for (let i = 0; i < 205; i++) await audit("tester", "test.event", { i });
    const res = await getAudit();
    const body = await res.json();
    expect(body.total).toBe(205);
    expect(body.events).toHaveLength(200);
    expect(body.events[0].details.i).toBe(204);
    expect(body.events[199].details.i).toBe(5);
  });
});
