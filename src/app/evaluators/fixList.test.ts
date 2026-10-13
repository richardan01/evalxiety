import { describe, expect, it } from "vitest";
import { fixList, JUDGE_CHECK_ID } from "./fixList";
import type { EvaluatorResultRow } from "./types";

const row = (over: Partial<EvaluatorResultRow> & { fail?: boolean; at?: string }): EvaluatorResultRow => ({
  trace_id: `t_${over.case_id}_${over.agent_version}_${over.at}`,
  case_id: "C01",
  agent_version: "pricing-agent@corrected-v2",
  execution_mode: "live",
  experiment_run_id: "r",
  timestamp: over.at ?? "2026-10-13T08:00:00Z",
  split: "dev",
  execution_error: null,
  deterministic: [
    { evaluator_id: "missing_mandatory_approval", evaluator_version: "1", outcome: over.fail ? "FAIL" : "PASS", severity: "critical", summary: over.fail ? "Missing: cfo_delegate" : "ok", details: {} },
  ],
  judge: null,
  ...over,
});

describe("fix list", () => {
  it("keeps only the latest answer per case+version and counts repeated failures", () => {
    const items = fixList(
      [
        row({ case_id: "C13", fail: true, at: "2026-10-13T07:00:00Z" }),
        row({ case_id: "C13", fail: true, at: "2026-10-13T08:00:00Z" }),
        row({ case_id: "C02", fail: true, at: "2026-10-13T07:00:00Z" }),
        row({ case_id: "C02", fail: false, at: "2026-10-13T08:00:00Z" }), // fixed in the latest run → not listed
      ],
      "missing_mandatory_approval",
    );
    expect(items.map((i) => i.case_id)).toEqual(["C13"]);
    expect(items[0]).toMatchObject({ occurrences: 2, reason: "Missing: cfo_delegate", role: "corrected" });
    expect(items[0].trace_id).toContain("08:00");
  });

  it("puts the version you'd ship first, then critical failures", () => {
    const items = fixList(
      [row({ case_id: "C04", agent_version: "pricing-agent@baseline-v1", fail: true }), row({ case_id: "C07", fail: true })],
      "missing_mandatory_approval",
    );
    expect(items.map((i) => `${i.role}:${i.case_id}`)).toEqual(["corrected:C07", "baseline:C04"]);
  });

  it("ignores mock traces when live ones exist", () => {
    const items = fixList([row({ case_id: "C01", fail: true, execution_mode: "mock" }), row({ case_id: "C02" })], "missing_mandatory_approval");
    expect(items).toEqual([]);
  });

  it("lists judge flags and unsure verdicts with the flagged claim", () => {
    const j = (verdict: "FAIL" | "REQUIRES_REVIEW") =>
      ({ judge_result_id: "j", judge_version: "v", model_id: "m", verdict, error: null, execution_mode: "live", created_at: "",
        output: { relevant_claims: ["Approval must be finalized before expiry"], evidence_ids: [], explanation: "", uncertainty_reason: verdict === "REQUIRES_REVIEW" ? "ambiguous" : null, failure_detected: verdict === "FAIL" } }) as EvaluatorResultRow["judge"];
    const items = fixList([row({ case_id: "C18", judge: j("FAIL") }), row({ case_id: "C08", judge: j("REQUIRES_REVIEW") })], JUDGE_CHECK_ID);
    expect(items.map((i) => i.outcome).sort()).toEqual(["FAIL", "REQUIRES_REVIEW"]);
    expect(items.find((i) => i.case_id === "C18")!.reason).toContain("finalized before expiry");
    expect(items.find((i) => i.case_id === "C08")!.reason).toContain("unsure");
  });
});
