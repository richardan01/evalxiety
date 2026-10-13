/**
 * Integration test for the /api/experiments route handlers against a temporary
 * data directory. next/server's `connection` and `after` are stubbed (no
 * request scope in vitest); live mode is simulated only to exercise the 409
 * confirmation path, which throws before any API call is made.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { NextRequest } from "next/server";

const pending: Array<Promise<unknown>> = [];
const modeState: { mode: "live" | "mock" } = { mode: "mock" };

vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return {
    ...actual,
    connection: async () => undefined,
    after: (fn: () => unknown) => {
      pending.push(Promise.resolve().then(fn));
    },
  };
});

vi.mock("@/lib/llm/client", async (orig) => {
  const actual = await orig<typeof import("@/lib/llm/client")>();
  return {
    ...actual,
    modeInfo: () =>
      modeState.mode === "live"
        ? { mode: "live" as const, reason: "test: simulated live", spend_cap_usd: 10 }
        : { mode: "mock" as const, reason: "test: mock", spend_cap_usd: 10 },
  };
});

let tmp = "";

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-exp-"));
  process.env.AGENTTRUST_DATA_DIR = tmp;
});

afterAll(async () => {
  delete process.env.AGENTTRUST_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const ctx = <T extends object>(params: T) => ({ params: Promise.resolve(params) });
const drain = async () => {
  while (pending.length) await pending.shift();
};

describe("experiments API", () => {
  it("GET lists configs with system prompts, frozen sets with held-out flag, estimates and mode", async () => {
    const { GET } = await import("@/app/api/experiments/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toEqual([]);
    expect(body.agent_configs).toHaveLength(2);
    expect(body.agent_configs[0].system_prompt).toContain("merchant pricing analyst");
    const full = body.frozen_sets.find((s: { frozen_set_id: string }) => s.frozen_set_id === "FROZEN-FULL-v1");
    const dev = body.frozen_sets.find((s: { frozen_set_id: string }) => s.frozen_set_id === "FROZEN-DEV-v1");
    expect(full.includesHeldout).toBe(true);
    expect(dev.includesHeldout).toBe(false);
    expect(body.heldout.revealed).toBe(false);
    expect(body.estimate_per_case).toEqual({ agent: expect.any(Number), judge: expect.any(Number) });
    expect(body.mode.mode).toBe("mock");
  });

  it("POST validates the actor, maps held-out lock to 423 and live batches to 409 with an estimate", async () => {
    const { POST } = await import("@/app/api/experiments/route");
    const noActor = await POST(post("/api/experiments", { config_id: "pricing-agent@baseline-v1", frozen_set_id: "FROZEN-DEV-v1", actor: "  " }));
    expect(noActor.status).toBe(400);

    const locked = await POST(post("/api/experiments", { config_id: "pricing-agent@baseline-v1", frozen_set_id: "FROZEN-FULL-v1", actor: "Tester" }));
    expect(locked.status).toBe(423);
    expect((await locked.json()).error).toMatch(/held-out/i);

    const unknown = await POST(post("/api/experiments", { config_id: "pricing-agent@baseline-v1", frozen_set_id: "NOPE", actor: "Tester" }));
    expect(unknown.status).toBe(400);

    modeState.mode = "live";
    try {
      const paid = await POST(post("/api/experiments", { config_id: "pricing-agent@baseline-v1", frozen_set_id: "FROZEN-DEV-v1", actor: "Tester" }));
      expect(paid.status).toBe(409);
      const body = await paid.json();
      expect(body.estimate.agent_calls).toBe(12);
      expect(body.estimate.judge_calls).toBe(12);
      expect(body.estimate.estimated_max_usd).toBeGreaterThan(0);
      expect(pending).toHaveLength(0); // nothing scheduled without confirmation
    } finally {
      modeState.mode = "mock";
    }
  });

  it("runs baseline and corrected (mock), lists progress/summary, returns run detail, compares, and judges missing traces", async () => {
    const { GET, POST } = await import("@/app/api/experiments/route");
    const detailRoute = await import("@/app/api/experiments/[id]/route");
    const compareRoute = await import("@/app/api/experiments/compare/route");
    const judgeRoute = await import("@/app/api/experiments/[id]/judge/route");

    const b = await POST(post("/api/experiments", { config_id: "pricing-agent@baseline-v1", frozen_set_id: "FROZEN-DEV-v1", actor: "Tester", run_judge: false }));
    expect(b.status).toBe(200);
    const bRun = (await b.json()).run;
    expect(bRun.status).toBe("running");
    expect(bRun.execution_mode).toBe("mock");
    await drain();

    const c = await POST(post("/api/experiments", { config_id: "pricing-agent@corrected-v2", frozen_set_id: "FROZEN-DEV-v1", actor: "Tester" }));
    const cRun = (await c.json()).run;
    await drain();

    const list = await (await GET()).json();
    expect(list.runs).toHaveLength(2);
    for (const r of list.runs) {
      expect(r.run.status).toBe("completed");
      expect(r.progress).toEqual({ traces_done: 12, cases: 12 });
      expect(r.summary.n_cases).toBe(12);
    }
    const bRow = list.runs.find((r: { run: { run_id: string } }) => r.run.run_id === bRun.run_id);
    expect(bRow.config_label).toBe("Baseline");
    expect(bRow.summary.judge.not_run).toBe(12);

    const detail = await detailRoute.GET(new NextRequest(`http://localhost/api/experiments/${bRun.run_id}`), ctx({ id: bRun.run_id }));
    expect(detail.status).toBe(200);
    expect((await detail.json()).evals).toHaveLength(12);
    const missing = await detailRoute.GET(new NextRequest("http://localhost/api/experiments/run_nope"), ctx({ id: "run_nope" }));
    expect(missing.status).toBe(404);

    const cmpRes = await compareRoute.GET(new NextRequest(`http://localhost/api/experiments/compare?baseline=${bRun.run_id}&candidate=${cRun.run_id}`));
    expect(cmpRes.status).toBe(200);
    const cmp = await cmpRes.json();
    expect(cmp.comparison.pairs).toHaveLength(12);
    expect(cmp.mode_mismatch).toBe(false);
    expect(Object.keys(cmp.case_meta)).toHaveLength(12);
    const total = ["fixed", "regressed", "still_failing", "still_passing", "incomplete"].reduce((n, k) => n + cmp.comparison[k].length, 0);
    expect(total).toBe(12);

    const badCmp = await compareRoute.GET(new NextRequest(`http://localhost/api/experiments/compare?baseline=${bRun.run_id}`));
    expect(badCmp.status).toBe(400);

    const noActor = await judgeRoute.POST(post(`/api/experiments/${bRun.run_id}/judge`, { actor: "" }), ctx({ id: bRun.run_id }));
    expect(noActor.status).toBe(400);
    const judged = await judgeRoute.POST(post(`/api/experiments/${bRun.run_id}/judge`, { actor: "Tester" }), ctx({ id: bRun.run_id }));
    expect(judged.status).toBe(200);
    expect(await judged.json()).toMatchObject({ judged: 12, skipped: 0 });
    const again = await judgeRoute.POST(post(`/api/experiments/${bRun.run_id}/judge`, { actor: "Tester" }), ctx({ id: bRun.run_id }));
    expect(await again.json()).toMatchObject({ judged: 0, skipped: 12 });
    const noRun = await judgeRoute.POST(post(`/api/experiments/run_nope/judge`, { actor: "Tester" }), ctx({ id: "run_nope" }));
    expect(noRun.status).toBe(404);
  });

  it("refuses to compare runs over different frozen sets", async () => {
    const { revealHeldout } = await import("@/lib/storage/repos");
    await revealHeldout("Tester", "test: final check");
    const { GET, POST } = await import("@/app/api/experiments/route");
    const compareRoute = await import("@/app/api/experiments/compare/route");
    const h = await POST(post("/api/experiments", { config_id: "pricing-agent@corrected-v2", frozen_set_id: "FROZEN-HELDOUT-v1", actor: "Tester", run_judge: false }));
    expect(h.status).toBe(200);
    const hRun = (await h.json()).run;
    await drain();
    const list = await (await GET()).json();
    const devRun = list.runs.find((r: { run: { frozen_set_id: string } }) => r.run.frozen_set_id === "FROZEN-DEV-v1").run;
    const res = await compareRoute.GET(new NextRequest(`http://localhost/api/experiments/compare?baseline=${devRun.run_id}&candidate=${hRun.run_id}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/different frozen sets/);
  });
});
