/**
 * Static-render smoke tests for the review UI (no Next server needed). Effects don't run under
 * renderToStaticMarkup, so these check the first paint of each presentational component.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTrace } from "@/lib/testing/fixtures";
import { evaluateTrace, DETERMINISTIC_EVALUATORS } from "@/lib/evaluators/deterministic";
import { mockJudge, judgeVersion } from "@/lib/judge/judge";
import { SEED_TAXONOMY } from "@/lib/taxonomy/seed";
import type { Annotation, JudgeResult } from "@/lib/domain/schemas";
import { AnnotationForm } from "../[traceId]/AnnotationForm";
import { AutomatedChecks, HiddenChecks } from "../[traceId]/AutomatedChecks";
import { OtherAnnotations } from "../[traceId]/OtherAnnotations";
import { TraceDetail } from "../[traceId]/TraceDetail";
import { AnnotationQueue } from "./AnnotationQueue";
import { EMPTY_FORM } from "./annotationForm";
import type { EvaluationsResponse } from "./types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

const trace = makeTrace("C01", undefined, { execution_mode: "mock" });
const reviewer = { value: "Ada", setValue: () => undefined, commit: () => "Ada", stored: "Ada" };
const ann: Annotation = {
  annotation_id: "ann_1",
  trace_id: trace.trace_id,
  case_id: "C01",
  reviewer: "Grace",
  label_source: "human", checklist: {}, rubric_version: null, demo: false,
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
  open_coding_notes: "Observed X.",
  task_outcome: "fail",
  first_failure: { description: "First thing", failure_mode_id: "wrong_policy_version" },
  additional_failure_mode_ids: ["gone_mode"],
  severity: "critical",
  unsupported_justification_label: "present",
  taxonomy_version: 1,
};

describe("review UI first paint", () => {
  it("renders the annotation form with failure steps, hypothesis-labelled categories and inactive ids", () => {
    const html = renderToStaticMarkup(
      createElement(AnnotationForm, {
        form: { ...EMPTY_FORM, outcome: "fail", firstFailureModeId: "gone_first", additionalModeIds: ["gone_mode"] },
        onChange: () => undefined,
        errors: { firstFailure: "Describe it" },
        reviewer,
        taxonomy: { status: "ok", version: 1, modes: SEED_TAXONOMY.failure_modes },
        own: null,
        dirty: true,
        saveState: { status: "idle" },
        onSave: () => undefined,
        onDefer: () => undefined,
      }),
    );
    expect(html).toContain("Uncategorised — assign during axial coding");
    expect(html).toContain("seed hypothesis");
    expect(html).toContain("gone_first");
    expect(html).toContain("Describe it");
    expect(html).toContain("Unsaved changes");
  });

  it("renders the form gracefully when the taxonomy is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AnnotationForm, {
        form: { ...EMPTY_FORM, outcome: "fail" },
        onChange: () => undefined,
        errors: {},
        reviewer,
        taxonomy: { status: "unavailable", reason: "GET /api/taxonomy failed (404)" },
        own: null,
        dirty: false,
        saveState: { status: "saved", message: "Saved!" },
        onSave: () => undefined,
        onDefer: () => undefined,
      }),
    );
    expect(html).toContain("Failure taxonomy unavailable");
    expect(html).toContain("Saved!");
  });

  it("renders deterministic and judge results with MOCK and EXPERIMENTAL labels", () => {
    const output = mockJudge(trace);
    const judge: JudgeResult = {
      judge_result_id: "judge_1",
      judge_id: "unsupported_pricing_justification",
      judge_version: judgeVersion("mock"),
      model_id: "mock-judge",
      served_model_id: null,
      trace_id: trace.trace_id,
      case_id: trace.case_id,
      verdict: "PASS",
      output: { ...output, uncertainty_reason: "Ambiguous" },
      raw_response: JSON.stringify(output),
      error: null,
      execution_mode: "mock",
      label_source: "llm_judge",
      token_usage: null,
      latency_ms: 0,
      created_at: "2026-10-13T00:00:00Z",
    };
    const evals: EvaluationsResponse = {
      deterministic: evaluateTrace(trace),
      evaluator_definitions: DETERMINISTIC_EVALUATORS,
      judge_results: [judge, { ...judge, judge_result_id: "judge_0", judge_version: "old" }],
      current_judge_version: judgeVersion("mock"),
      judge_question: "Q?",
      judge_locked: null,
      judge_call: { mode: "mock", estimated_usd: 0 },
    };
    const html = renderToStaticMarkup(
      createElement(AutomatedChecks, {
        trace,
        evals,
        error: null,
        revealedEarly: true,
        ownLabel: "present",
        judge: { busy: false, error: null, message: null },
        canRunJudge: true,
        onRunJudge: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(html).toContain("EXPERIMENTAL");
    expect(html).toContain("not a gold label");
    expect(html).toContain("MOCK");
    expect(html).toContain("Revealed before you saved a label");
    expect(html).toContain("not the current judge version");
    expect(html).toContain("Ambiguous");
    expect(html.match(/margin_calculation_error|stale_policy_used|missing_mandatory_approval|margin_guardrail_violation/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toMatch(/production certified/i);
  });

  it("renders the hidden-checks gate and other reviewers collapsed before saving", () => {
    expect(renderToStaticMarkup(createElement(HiddenChecks, { onRevealAnyway: () => undefined }))).toContain("reveal anyway");
    const html = renderToStaticMarkup(
      createElement(OtherAnnotations, { annotations: [ann], modes: SEED_TAXONOMY.failure_modes, ownSaved: false }),
    );
    expect(html).toContain("Grace");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Wrong policy version");
  });

  it("renders loading states for the queue and the workspace before data arrives", () => {
    expect(renderToStaticMarkup(createElement(AnnotationQueue))).toContain("Loading the queue");
    const html = renderToStaticMarkup(createElement(TraceDetail, { traceId: "trace_x", notice: { kind: "saved", caseId: "C03" } }));
    expect(html).toContain("Loading trace");
    expect(html).toContain("Saved your label for C03");
  });
});
