/**
 * Server-render smoke tests for the Evaluators tab components using real (mock-mode) data.
 * Checks credibility invariants: MOCK labels, "undefined" ratios, exact status label, axis labels.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { executeRun, prepareRun } from "@/lib/experiments/runner";
import { getExperimentRun, upsertAnnotation, listAnnotations } from "@/lib/storage/repos";
import { calibrationView, latestJudgeByTrace, promoteToGold } from "@/lib/services";
import { listJudgeResults, listTraces } from "@/lib/storage/repos";
import { DETERMINISTIC_EVALUATORS, evaluateTrace } from "@/lib/evaluators/deterministic";
import { splitOf } from "@/lib/domain/scenarios";
import { EvaluatorDefinitions } from "./EvaluatorDefinitions";
import { ResultsMatrix } from "./ResultsMatrix";
import { CalibrationBody } from "./JudgeCalibration";
import { HeldoutReveal } from "./HeldoutReveal";
import type { CalibrationUnlocked, EvaluatorsResponse } from "./types";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-render-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const judgeDef = {
  id: "unsupported_pricing_justification",
  question: "q",
  system_prompt: "prompt",
  prompt_version: "upj-prompt-v1",
  live_version: "live-v",
  mock_version: "mock-v",
  status: "experimental" as const,
};

describe("render", () => {
  it("shows an empty calibration with undefined ratios (never 0%/100%) before any labels", async () => {
    const view = (await calibrationView({ split: "dev", mode: "live" })) as CalibrationUnlocked;
    const html = renderToStaticMarkup(createElement(CalibrationBody, { view }));
    expect(html).toContain("Experimental — insufficient validation data.");
    expect(html).toContain("EXPERIMENTAL");
    expect(html).toContain("Label a few traces in");
    expect(html).toContain("then this shows how often the judge agrees with you.");
    expect(html).not.toMatch(/\b(0|100)\.0%/);
  });

  it("renders definitions, matrix and a populated calibration from mock data", async () => {
    const opts = { config_id: "pricing-agent@baseline-v1", frozen_set_id: "FROZEN-DEV-v1", actor: "tester" };
    const r = await prepareRun(opts);
    await executeRun(r, opts);
    const run = (await getExperimentRun(r.run_id))!;
    const entries = Object.entries(run.trace_ids).slice(0, 4);
    for (const [i, [caseId, traceId]] of entries.entries()) {
      await upsertAnnotation({
        trace_id: traceId,
        case_id: caseId,
        reviewer: "rich",
        open_coding_notes: `note ${i}`,
        task_outcome: i % 2 === 0 ? "fail" : "pass",
        first_failure: i % 2 === 0 ? { description: "Unsupported claim", failure_mode_id: null } : null,
        additional_failure_mode_ids: [],
        severity: i % 2 === 0 ? "major" : null,
        unsupported_justification_label: i % 2 === 0 ? "present" : "absent",
        taxonomy_version: 1,
      });
    }
    for (const a of await listAnnotations()) await promoteToGold({ annotation_id: a.annotation_id, promoted_by: "rich" });

    const view = (await calibrationView({ split: "dev", mode: "mock" })) as CalibrationUnlocked;
    const cal = renderToStaticMarkup(createElement(CalibrationBody, { view }));
    expect(cal).toContain("Experimental — insufficient validation data.");
    expect(cal).toContain("You said");
    expect(cal).toContain("Judge said");
    for (const caption of ["Both found a problem", "Judge missed it", "False alarm", "Both said fine"]) expect(cal).toContain(caption);
    expect(cal).toContain("Catches real problems");
    expect(cal).toContain("Avoids false alarms");
    expect(cal).toContain("MOCK");
    expect(cal).toContain(`${view.report.matrix.tp}/${view.report.matrix.positives}`);
    expect(cal).toContain(`${view.report.matrix.tn}/${view.report.matrix.negatives}`);
    expect(cal).not.toMatch(/reliable|production certified/i);

    const traces = await listTraces();
    const latest = latestJudgeByTrace(await listJudgeResults(), traces);
    const data: EvaluatorsResponse = {
      deterministic: DETERMINISTIC_EVALUATORS,
      judge: judgeDef,
      results: traces.map((t) => ({
        trace_id: t.trace_id,
        case_id: t.case_id,
        agent_version: t.agent_version,
        execution_mode: t.execution_mode,
        experiment_run_id: t.experiment_run_id,
        timestamp: t.timestamp,
        split: splitOf(t.case_id),
        execution_error: t.execution_error,
        deterministic: evaluateTrace(t),
        judge: latest.get(t.trace_id) ?? null,
      })),
      run_ids: [r.run_id],
      filter: { run_id: null },
    };
    const matrix = renderToStaticMarkup(createElement(ResultsMatrix, { data, initialRunId: null }));
    expect(matrix).toContain("Show results for every trace");
    expect(matrix).not.toMatch(/<details[^>]*\sopen/); // collapsed by default
    expect(matrix).toContain(`/review/${traces[0].trace_id}`);
    expect(matrix).toContain("EXPERIMENTAL");
    expect(renderToStaticMarkup(createElement(ResultsMatrix, { data, initialRunId: r.run_id }))).toMatch(/<details[^>]*\sopen/);

    const defs = renderToStaticMarkup(createElement(EvaluatorDefinitions, { deterministic: DETERMINISTIC_EVALUATORS, judge: judgeDef, rows: data.results }));
    for (const name of ["Right policy for the date", "Margin math", "Margin floor", "Required approvals", "Reasons backed by evidence"]) {
      expect(defs).toContain(name);
    }
    expect(defs).toContain("CODE · validated by tests");
    expect(defs).toContain("AI JUDGE · experimental");
    expect(defs).toContain(`/${traces.length}`);
    expect(defs).toContain("stale_policy_used"); // technical id kept behind the info tip
    expect(defs).toContain("never used as gold truth");
    expect(defs).toContain("src/lib/evaluators/deterministic.test.ts");
    expect(defs).toContain("REQUIRES REVIEW");

    const lock = renderToStaticMarkup(createElement(HeldoutReveal, { onRevealed: () => undefined }));
    expect(lock).toContain("Held-out is locked");
    expect(lock).toContain("Reveal held-out (final check)");
  });
});
