import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runPricingAgent } from "./runner";
import { getScenario } from "../domain/scenarios";
import { getTrace, listTraces, revealHeldout } from "../storage/repos";
import { Trace } from "../domain/schemas";
import { retrievePolicies } from "./configs";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("pricing agent runner (mock mode)", () => {
  it("executes a case and persists a schema-valid, mock-labelled trace", async () => {
    const trace = await runPricingAgent(getScenario("C01")!, "pricing-agent@corrected-v2");
    Trace.parse(trace);
    expect(trace.execution_mode).toBe("mock");
    expect(trace.model_id).toBe("mock-pricing-agent");
    expect(trace.token_usage).toBeNull();
    expect(trace.parsed_structured_output?.explanation).toContain("[MOCK OUTPUT]");
    expect(trace.selected_policy_id).toBe("PRC-2026.2");
    expect(await getTrace(trace.trace_id)).toEqual(trace);
    expect((await listTraces()).map((t) => t.trace_id)).toContain(trace.trace_id);
  });

  it("baseline retrieval omits the current policy (stale index)", async () => {
    const trace = await runPricingAgent(getScenario("C01")!, "pricing-agent@baseline-v1");
    expect(trace.policy_context.map((p) => p.policy_id)).toEqual(["PRC-2026.1", "PRC-2025.1"]);
    expect(trace.selected_policy_id).not.toBe("PRC-2026.2");
  });

  it("corrected retrieval supplies only the policy effective on the decision date", () => {
    expect(retrievePolicies("effective_date_filtered", "2026-08-31").map((p) => p.policy_id)).toEqual(["PRC-2026.1"]);
    expect(retrievePolicies("effective_date_filtered", "2026-09-01").map((p) => p.policy_id)).toEqual(["PRC-2026.2"]);
    expect(retrievePolicies("effective_date_filtered", "2024-01-01")).toEqual([]);
  });

  it("evidence pack lists every merchant fact and policy section the agent saw", async () => {
    // C08 is held-out: executing it requires the audited reveal first.
    await revealHeldout("tester", "runner test needs a held-out case");
    const trace = await runPricingAgent(getScenario("C08")!, "pricing-agent@corrected-v2");
    const ids = trace.evidence_pack.map((e) => e.evidence_id);
    expect(ids).toContain("FACT-cost");
    expect(ids).toContain("PRC-2026.2§8");
    expect(trace.user_prompt).toContain("UNAVAILABLE");
  });
});
