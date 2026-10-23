/**
 * Demo labels (placeholders seeded to exercise the UI) must never count as validation evidence:
 * calibration and the release gate leave them out unless calibration is explicitly asked to include them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { makeTrace } from "../testing/fixtures";
import { listAnnotations, saveTrace, upsertAnnotation } from "../storage/repos";
import { calibrationView, overviewView, promoteToGold, releaseView } from "./index";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-demo-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const label = (trace_id: string, reviewer: string, demo?: boolean) => ({
  trace_id,
  case_id: "C01",
  reviewer,
  open_coding_notes: "",
  task_outcome: "pass" as const,
  first_failure: null,
  additional_failure_mode_ids: [],
  severity: null,
  unsupported_justification_label: "absent" as const,
  taxonomy_version: null,
  ...(demo === undefined ? {} : { demo }),
});

describe("demo labels", () => {
  it("default to not-demo, and keep their flag when an edit omits it", async () => {
    const t = makeTrace("C01");
    await saveTrace(t);
    const real = await upsertAnnotation(label(t.trace_id, "expert"));
    expect(real.demo).toBe(false);
    const demo = await upsertAnnotation(label(t.trace_id, "demo-reviewer", true));
    expect(demo.demo).toBe(true);
    const edited = await upsertAnnotation({ ...label(t.trace_id, "demo-reviewer"), open_coding_notes: "edited" });
    expect(edited.demo).toBe(true);
    const flags = Object.fromEntries((await listAnnotations()).filter((x) => x.trace_id === t.trace_id).map((x) => [x.reviewer, x.demo]));
    expect(flags).toEqual({ expert: false, "demo-reviewer": true });
  });

  it("are carried into gold and left out of calibration unless asked for", async () => {
    const t = makeTrace("C02");
    await saveTrace(t);
    const a = await upsertAnnotation({ ...label(t.trace_id, "demo-reviewer", true), case_id: "C02" });
    const gold = await promoteToGold({ annotation_id: a.annotation_id, promoted_by: "tester" });
    expect(gold.demo).toBe(true);

    const hidden = await calibrationView({ split: "dev", mode: "live" });
    if (hidden.locked) throw new Error("dev split is never locked");
    expect(hidden.labelled_examples).toBe(0);
    expect(hidden.demo_excluded).toBe(1);
    expect(hidden.demo_included).toBe(0);
    expect(hidden.report.status_label).toBe("Experimental — insufficient validation data.");

    const shown = await calibrationView({ split: "dev", mode: "live", include_demo: true });
    if (shown.locked) throw new Error("dev split is never locked");
    expect(shown.labelled_examples).toBe(1);
    expect(shown.demo_included).toBe(1);
    expect(shown.demo_excluded).toBe(0);
    expect(shown.report.status_label).toBe("Demo data — not validation evidence.");
    expect(shown.report.insufficient).toBe(true);
  });

  it("do not count toward review coverage, gold targets or the release gate", async () => {
    const ov = await overviewView();
    // Only the non-demo "expert" label from the first test exists.
    expect(ov.review.reviewed_traces).toBe(1);
    expect(ov.review.gold_examples).toBe(0);
    expect(ov.review.demo_gold).toBe(1);
    expect(ov.review.demo_labels).toBe(2); // demo-reviewer labelled C01 and C02
    const rel = await releaseView();
    // 1 real label is below the minimum, so the gate must still ask for human review (demo labels cannot fill the gap).
    expect(rel.gate.reasons.map((r) => r.code)).toContain("insufficient_human_review");
  });
});
