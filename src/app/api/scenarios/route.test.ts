import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { SPLIT_ASSIGNMENT } from "@/lib/domain/scenarios";
import { revealHeldout } from "@/lib/storage/repos";
import { GET } from "./route";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "evalxiety-scen-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const heldoutIds = Object.entries(SPLIT_ASSIGNMENT).filter(([, s]) => s === "heldout").map(([id]) => id);

describe("GET /api/scenarios and the held-out set", () => {
  it("does not serve held-out case content before the audited reveal", async () => {
    const { scenarios } = await (await GET()).json();
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.filter((s: { case_id: string }) => heldoutIds.includes(s.case_id))).toEqual([]);
  });

  it("serves it after the reveal", async () => {
    await revealHeldout("tester", "unit test");
    const { scenarios } = await (await GET()).json();
    expect(scenarios.filter((s: { case_id: string }) => heldoutIds.includes(s.case_id))).toHaveLength(heldoutIds.length);
  });
});
