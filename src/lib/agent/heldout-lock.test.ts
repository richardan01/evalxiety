import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runPricingAgent } from "./runner";
import { HeldoutAccessError, heldoutCaseFor } from "./heldout-lock";
import { SCENARIOS, SPLIT_ASSIGNMENT, getScenario } from "../domain/scenarios";
import { listTraces, revealHeldout } from "../storage/repos";
import { POST as runRoute } from "@/app/api/run/route";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});

const HELD = SCENARIOS.find((s) => SPLIT_ASSIGNMENT[s.case_id] === "heldout")!;
const DEV = SCENARIOS.find((s) => SPLIT_ASSIGNMENT[s.case_id] === "dev")!;
const CONFIG = "pricing-agent@corrected-v2";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-heldout-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const post = (body: object) => runRoute(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ actor: "tester", ...body }) }));

describe("held-out lock on single-case execution", () => {
  it("identifies held-out cases by ID and by copied content", () => {
    expect(heldoutCaseFor(HELD)).toBe(HELD.case_id);
    expect(heldoutCaseFor({ ...HELD, case_id: "CUSTOM-copy", variation: null, data_origin: "user_supplied" })).toBe(HELD.case_id);
    expect(heldoutCaseFor(DEV)).toBeNull();
  });

  it("POST /api/run refuses an unattributed run: live spend needs a named actor", async () => {
    const res = await runRoute(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ config_id: CONFIG, case_id: DEV.case_id }) }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("actor");
    expect((await listTraces()).length).toBe(0);
  });

  it("runPricingAgent refuses a held-out case before reveal (mock mode too) and writes no trace", async () => {
    await expect(runPricingAgent(getScenario(HELD.case_id)!, CONFIG)).rejects.toBeInstanceOf(HeldoutAccessError);
    expect((await listTraces()).some((t) => t.case_id === HELD.case_id)).toBe(false);
  });

  it("POST /api/run returns 403 for a held-out case_id", async () => {
    const res = await post({ config_id: CONFIG, case_id: HELD.case_id });
    expect(res.status).toBe(403);
  });

  it("POST /api/run returns 403 for a custom scenario that copies a held-out case", async () => {
    const res = await post({ config_id: CONFIG, scenario: { ...HELD, case_id: "sneaky" } });
    expect(res.status).toBe(403);
    expect((await listTraces()).length).toBe(0);
  });

  it("dev cases still run", async () => {
    const res = await post({ config_id: CONFIG, case_id: DEV.case_id });
    expect(res.status).toBe(200);
  });

  it("held-out cases run after the audited reveal", async () => {
    await revealHeldout("tester", "final evaluation");
    const res = await post({ config_id: CONFIG, case_id: HELD.case_id });
    expect(res.status).toBe(200);
  });
});
