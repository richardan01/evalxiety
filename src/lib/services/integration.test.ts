/**
 * End-to-end (mock mode): execute → annotate → taxonomy → gold → judge →
 * calibration → experiments → release gate. Uses a temp data directory.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { executeRun, prepareRun, HeldoutLockedError } from "../experiments/runner";
import {
  appendTaxonomyVersion,
  getExperimentRun,
  latestTaxonomy,
  listAnnotations,
  listAudit,
  listJudgeResults,
  revealHeldout,
  upsertAnnotation,
} from "../storage/repos";
import { calibrationView, compareRunIds, overviewView, promoteToGold, releaseView, taxonomyView } from "./index";
import { addMode } from "../taxonomy/ops";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-int-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function run(configId: string, setId: string) {
  const opts = { config_id: configId, frozen_set_id: setId, actor: "tester" };
  const r = await prepareRun(opts);
  await executeRun(r, opts);
  return (await getExperimentRun(r.run_id))!;
}

describe("AgentTrust workflow (mock)", () => {
  it("refuses to run held-out cases before the held-out reveal", async () => {
    await expect(prepareRun({ config_id: "pricing-agent@baseline-v1", frozen_set_id: "FROZEN-FULL-v1", actor: "t" })).rejects.toBeInstanceOf(
      HeldoutLockedError,
    );
  });

  it("runs baseline and corrected on the frozen dev set and compares them case by case", async () => {
    const base = await run("pricing-agent@baseline-v1", "FROZEN-DEV-v1");
    const corr = await run("pricing-agent@corrected-v2", "FROZEN-DEV-v1");
    expect(base.status).toBe("completed");
    expect(Object.keys(corr.trace_ids)).toHaveLength(12);
    const cmp = await compareRunIds(base.run_id, corr.run_id);
    // Corrected retrieval should eliminate stale-policy failures on v3-dated cases.
    const staleBase = cmp.comparison.per_evaluator.stale_policy_used.baseline.fail;
    const staleCorr = cmp.comparison.per_evaluator.stale_policy_used.candidate.fail;
    expect(staleBase).toBeGreaterThan(0);
    expect(staleCorr).toBe(0);
    expect((await listJudgeResults()).length).toBe(24);
  });

  it("human annotation → taxonomy version → gold with provenance → calibration", async () => {
    const corr = (await releaseView()).runs.find((r) => r.agent_config_id === "pricing-agent@corrected-v2")!;
    const runRec = (await getExperimentRun(corr.run_id))!;
    const traceIds = Object.values(runRec.trace_ids).slice(0, 3);
    for (const [i, traceId] of traceIds.entries()) {
      await upsertAnnotation({
        trace_id: traceId,
        case_id: Object.entries(runRec.trace_ids).find(([, t]) => t === traceId)![0],
        reviewer: "rich",
        open_coding_notes: `note ${i}`,
        task_outcome: i === 0 ? "fail" : "pass",
        first_failure: i === 0 ? { description: "Cites a competitor average not in evidence", failure_mode_id: "unsupported_pricing_explanation" } : null,
        additional_failure_mode_ids: [],
        severity: i === 0 ? "major" : null,
        unsupported_justification_label: i === 0 ? "present" : "absent",
        taxonomy_version: 1,
      });
    }
    const anns = await listAnnotations();
    expect(anns.every((a) => a.label_source === "human")).toBe(true);

    const tax = await latestTaxonomy();
    const v2 = await appendTaxonomyVersion("rich", "add expired promo mode", addMode(tax.failure_modes, { name: "Expired promo applied", definition: "x", severity: "major" }));
    expect(v2.version).toBe(2);
    const view = await taxonomyView();
    expect(view.frequencies.find((f) => f.failure_mode_id === "unsupported_pricing_explanation")!.any_count).toBe(1);
    expect(view.frequencies.find((f) => f.failure_mode_id === "wrong_policy_version")!.any_count).toBe(0);

    for (const a of anns) await promoteToGold({ annotation_id: a.annotation_id, promoted_by: "rich" });
    const cal = await calibrationView({ split: "dev", mode: "mock" });
    expect(cal.locked).toBe(false);
    if (!cal.locked) {
      expect(cal.labelled_examples).toBe(3);
      expect(cal.report.matrix.n).toBe(3);
      expect(cal.report.status_label).toBe("Experimental — insufficient validation data.");
    }
    expect((await calibrationView({ split: "heldout", mode: "mock" })).locked).toBe(true);
  });

  it("release gate: mock-only evidence is never eligible", async () => {
    await revealHeldout("rich", "final check");
    await run("pricing-agent@baseline-v1", "FROZEN-FULL-v1");
    await run("pricing-agent@corrected-v2", "FROZEN-FULL-v1");
    const rel = await releaseView();
    expect(rel.gate.status).not.toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
    expect(rel.gate.status).not.toBe("APPROVED_FOR_DEMO");
    expect(rel.gate.reasons.map((r) => r.code)).toContain("mock_results");
    const ov = await overviewView();
    expect(ov.executions.mock).toBeGreaterThan(0);
    expect(ov.executions.live).toBe(0);
    const audit = await listAudit();
    expect(audit.map((e) => e.action)).toEqual(expect.arrayContaining(["experiment.started", "heldout.revealed", "gold.promoted"]));
  });
});
