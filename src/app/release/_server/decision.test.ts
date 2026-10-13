/**
 * Release decision recording against a real (temp-dir) store.
 * Seeds an otherwise-eligible LIVE-labelled candidate/baseline pair from test
 * fixtures (no API calls), then walks blocked → rejected → eligible → approved → stale.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { ExperimentRun } from "@/lib/domain/schemas";
import { getScenario } from "@/lib/domain/scenarios";
import { getFrozenSet } from "@/lib/experiments/frozen";
import { evaluateCase } from "@/lib/metrics/experiments";
import { judgeVersion } from "@/lib/judge/judge";
import { makeTrace, withPrice } from "@/lib/testing/fixtures";
import { listApprovals, listAudit, saveExperimentRun, saveJudgeResult, saveTrace, upsertAnnotation } from "@/lib/storage/repos";
import { releaseView } from "@/lib/services";
import { DecisionBody, recordReleaseDecision } from "./decision";

const FULL = getFrozenSet("FROZEN-FULL-v1")!;
let dir: string;
let baselineTraces: Record<string, string> = {};
let candidateTraces: Record<string, string> = {};

async function seedRun(runId: string, configId: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const caseId of FULL.case_ids) {
    const s = getScenario(caseId)!;
    let t = makeTrace(caseId, undefined, { agent_version: configId, experiment_run_id: runId });
    if (evaluateCase(caseId, t).pass_all !== true) {
      t = makeTrace(caseId, withPrice(s, { rate_bps: 300, per_txn_fee_usd: 0.3 }), { agent_version: configId, experiment_run_id: runId });
    }
    await saveTrace(t);
    await saveJudgeResult({
      judge_result_id: `jr_${t.trace_id}`,
      judge_id: "unsupported_pricing_justification",
      judge_version: judgeVersion("live"),
      model_id: "test",
      served_model_id: null,
      trace_id: t.trace_id,
      case_id: caseId,
      verdict: "PASS",
      output: null,
      raw_response: null,
      error: null,
      execution_mode: "live",
      label_source: "llm_judge",
      token_usage: null,
      latency_ms: 1,
      created_at: new Date().toISOString(),
    });
    ids[caseId] = t.trace_id;
  }
  const run: ExperimentRun = {
    run_id: runId,
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    agent_config_id: configId,
    frozen_set_id: FULL.frozen_set_id,
    frozen_set_hash: FULL.content_hash,
    case_ids: FULL.case_ids,
    execution_mode: "live",
    status: "completed",
    trace_ids: ids,
    notes: null,
  };
  await saveExperimentRun(run);
  return ids;
}

async function annotate(traceId: string, caseId: string) {
  await upsertAnnotation({
    trace_id: traceId,
    case_id: caseId,
    reviewer: "rich",
    open_coding_notes: "looks right",
    task_outcome: "pass",
    first_failure: null,
    additional_failure_mode_ids: [],
    severity: null,
    unsupported_justification_label: "not_assessed",
    taxonomy_version: null,
  });
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-release-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
  process.env.MOCK_MODE = "true";
  baselineTraces = await seedRun("run_base", "pricing-agent@baseline-v1");
  candidateTraces = await seedRun("run_cand", "pricing-agent@corrected-v2");
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const body = (b: Partial<DecisionBody> & Pick<DecisionBody, "decision">) =>
  DecisionBody.parse({ approver: "rich", candidate_run_id: "run_cand", notes: "", ...b });

describe("recordReleaseDecision", () => {
  it("defaults to the latest completed FULL-set runs and is not yet eligible (too little human review)", async () => {
    const v = await releaseView();
    expect(v.candidate_run?.run_id).toBe("run_cand");
    expect(v.baseline_run?.run_id).toBe("run_base");
    expect(v.gate.evaluation_status).toBe("INSUFFICIENT_EVIDENCE");
    // Every candidate case also needs a human review while the judge is unvalidated.
    expect(v.gate.reasons.map((r) => r.code).sort()).toEqual(["insufficient_human_review", "unresolved_required_reviews"]);
  });

  it("refuses to approve a non-eligible candidate, records nothing, and audits the attempt", async () => {
    const out = await recordReleaseDecision(body({ decision: "approved" }));
    expect(out.kind).toBe("blocked");
    expect(await listApprovals()).toHaveLength(0);
    expect((await listAudit()).some((e) => e.action === "release.approval_blocked")).toBe(true);
  });

  it("requires notes and a named approver for a rejection", () => {
    expect(DecisionBody.safeParse({ approver: "rich", decision: "rejected", notes: "  ", candidate_run_id: "run_cand" }).success).toBe(false);
    expect(DecisionBody.safeParse({ approver: " ", decision: "rejected", notes: "no", candidate_run_id: "run_cand" }).success).toBe(false);
  });

  it("always records a rejection, bound to the recomputed snapshot and the effective baseline", async () => {
    const out = await recordReleaseDecision(body({ decision: "rejected", notes: "Not enough review yet." }));
    if (out.kind !== "recorded") throw new Error(out.kind);
    expect(out.approval.baseline_run_id).toBe("run_base");
    expect(out.approval.status_at_approval).toBe("INSUFFICIENT_EVIDENCE");
    expect(out.approval.evidence_snapshot_hash).toBe(out.view.evidence_snapshot_hash);
    expect(out.approval.approval_id).toMatch(/^appr_/);
    expect(out.view.gate.approval_state).toBe("rejected");
    expect((await listAudit()).some((e) => e.action === "release.approval" && e.details.decision === "rejected")).toBe(true);
  });

  it("becomes eligible after human review; the old rejection is stale", async () => {
    for (const [caseId, traceId] of Object.entries(baselineTraces).slice(0, 10)) await annotate(traceId, caseId);
    // Reviewing the baseline alone is not enough: every candidate case needs a human label.
    expect((await releaseView()).gate.reasons.map((r) => r.code)).toContain("unresolved_required_reviews");
    for (const [caseId, traceId] of Object.entries(candidateTraces)) await annotate(traceId, caseId);
    const v = await releaseView();
    expect(v.gate.evaluation_status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
    expect(v.gate.approval_state).toBe("stale");
    expect(v.gate.status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
  });

  it("records nothing when the evidence changed since the approver loaded it", async () => {
    const out = await recordReleaseDecision(body({ decision: "approved", expected_evidence_snapshot_hash: "deadbeef" }));
    expect(out.kind).toBe("snapshot_changed");
    expect(await listApprovals()).toHaveLength(1);
  });

  it("approves an eligible candidate → APPROVED_FOR_DEMO; new evidence makes the approval stale", async () => {
    const before = await releaseView();
    const out = await recordReleaseDecision(
      body({ decision: "approved", baseline_run_id: "run_base", expected_evidence_snapshot_hash: before.evidence_snapshot_hash }),
    );
    if (out.kind !== "recorded") throw new Error(out.kind);
    expect(out.view.gate.status).toBe("APPROVED_FOR_DEMO");
    expect(out.approval.status_at_approval).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");

    const [caseId, traceId] = Object.entries(candidateTraces)[0];
    await annotate(traceId, caseId);
    const after = await releaseView();
    expect(after.evidence_snapshot_hash).not.toBe(before.evidence_snapshot_hash);
    expect(after.gate.approval_state).toBe("stale");
    expect(after.gate.status).toBe("ELIGIBLE_FOR_DEMO_APPROVAL");
  });

  it("404s on unknown runs", async () => {
    expect((await recordReleaseDecision(body({ decision: "rejected", notes: "x", candidate_run_id: "run_nope" }))).kind).toBe("not_found");
    expect((await recordReleaseDecision(body({ decision: "rejected", notes: "x", baseline_run_id: "run_nope" }))).kind).toBe("not_found");
  });
});
