/**
 * Route-level tests for /api/evaluators, /api/calibration and /api/heldout (mock mode, temp data dir).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});

import { executeRun, prepareRun } from "@/lib/experiments/runner";
import { getExperimentRun, listAnnotations, listAudit, upsertAnnotation } from "@/lib/storage/repos";
import { promoteToGold } from "@/lib/services";
import { GET as getEvaluators } from "@/app/api/evaluators/route";
import { GET as getCalibration } from "@/app/api/calibration/route";
import { GET as getHeldout, POST as postHeldout } from "@/app/api/heldout/route";
import type { CalibrationResponse, EvaluatorsResponse, HeldoutState } from "./types";

let dir: string;
let runId: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-evaluators-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
  const opts = { config_id: "pricing-agent@baseline-v1", frozen_set_id: "FROZEN-DEV-v1", actor: "tester" };
  const r = await prepareRun(opts);
  await executeRun(r, opts);
  runId = r.run_id;
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost"), init);
const post = (body: unknown) =>
  postHeldout(req("/api/heldout", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

describe("GET /api/evaluators", () => {
  it("returns 4 deterministic definitions, the experimental judge, and one row per trace", async () => {
    const res = await getEvaluators(req("/api/evaluators"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EvaluatorsResponse;
    expect(body.deterministic).toHaveLength(4);
    expect(body.judge.status).toBe("experimental");
    expect(body.judge.mock_version).toContain("mock");
    expect(body.results).toHaveLength(12);
    const row = body.results[0];
    expect(row.deterministic.map((d) => d.evaluator_id)).toEqual(body.deterministic.map((d) => d.evaluator_id));
    expect(row.split).toBe("dev");
    expect(row.execution_mode).toBe("mock");
    expect(row.judge?.execution_mode).toBe("mock");
    expect(body.run_ids).toEqual([runId]);
  });

  it("filters by ?run_id=", async () => {
    const none = (await (await getEvaluators(req("/api/evaluators?run_id=nope"))).json()) as EvaluatorsResponse;
    expect(none.results).toHaveLength(0);
    expect(none.run_ids).toEqual([runId]);
    const one = (await (await getEvaluators(req(`/api/evaluators?run_id=${runId}`))).json()) as EvaluatorsResponse;
    expect(one.results).toHaveLength(12);
    expect(one.filter.run_id).toBe(runId);
  });
});

describe("GET /api/calibration + /api/heldout", () => {
  it("defaults to dev/live and validates query params", async () => {
    const res = await getCalibration(req("/api/calibration"));
    const body = (await res.json()) as CalibrationResponse;
    expect(body.locked).toBe(false);
    if (!body.locked) {
      expect(body.split).toBe("dev");
      expect(body.mode).toBe("live");
      expect(body.report.tpr).toBeNull();
    }
    expect((await getCalibration(req("/api/calibration?split=test"))).status).toBe(400);
  });

  it("computes mock calibration from promoted human gold", async () => {
    const run = (await getExperimentRun(runId))!;
    const [first, second] = Object.entries(run.trace_ids);
    for (const [i, [caseId, traceId]] of [first, second].entries()) {
      await upsertAnnotation({
        trace_id: traceId,
        case_id: caseId,
        reviewer: "rich",
        open_coding_notes: `note ${i}`,
        task_outcome: i === 0 ? "fail" : "pass",
        first_failure: i === 0 ? { description: "Cites a market average not in evidence", failure_mode_id: null } : null,
        additional_failure_mode_ids: [],
        severity: i === 0 ? "major" : null,
        unsupported_justification_label: i === 0 ? "present" : "absent",
        taxonomy_version: 1,
      });
    }
    for (const a of await listAnnotations()) await promoteToGold({ annotation_id: a.annotation_id, promoted_by: "rich" });
    const body = (await (await getCalibration(req("/api/calibration?split=dev&mode=mock"))).json()) as CalibrationResponse;
    expect(body.locked).toBe(false);
    if (!body.locked) {
      expect(body.labelled_examples).toBe(2);
      const m = body.report.matrix;
      expect(m.n + m.excluded_error + m.excluded_requires_review + body.not_judged_trace_ids.length).toBe(2);
      expect(body.report.status_label).toBe("Experimental — insufficient validation data.");
    }
  });

  it("locks held-out until an audited reveal; refuses bad input and a second reveal", async () => {
    const locked = (await (await getCalibration(req("/api/calibration?split=heldout&mode=mock"))).json()) as CalibrationResponse;
    expect(locked.locked).toBe(true);
    expect(((await (await getHeldout()).json()) as HeldoutState).revealed).toBe(false);

    expect((await post({ actor: "rich", reason: "short" })).status).toBe(400);
    expect((await post({ actor: "  ", reason: "a long enough reason" })).status).toBe(400);
    expect((await postHeldout(req("/api/heldout", { method: "POST", body: "not json" }))).status).toBe(400);

    const ok = await post({ actor: "rich", reason: "Judge prompt frozen; final check" });
    expect(ok.status).toBe(200);
    const state = (await ok.json()) as HeldoutState;
    expect(state).toMatchObject({ revealed: true, revealed_by: "rich", reason: "Judge prompt frozen; final check" });

    const again = await post({ actor: "someone-else", reason: "trying to reveal again" });
    expect(again.status).toBe(409);
    expect(((await (await getHeldout()).json()) as HeldoutState).revealed_by).toBe("rich");

    const unlocked = (await (await getCalibration(req("/api/calibration?split=heldout&mode=mock"))).json()) as CalibrationResponse;
    expect(unlocked.locked).toBe(false);
    expect((await listAudit()).filter((e) => e.action === "heldout.revealed")).toHaveLength(1);
  });
});
