/**
 * Static-render smoke tests for the compact taxonomy and gold rows (populated states).
 * Effects don't run under renderToStaticMarkup, so data is passed in directly.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getScenario } from "@/lib/domain/scenarios";
import { SEED_TAXONOMY } from "@/lib/taxonomy/seed";
import type { Annotation, GoldExample } from "@/lib/domain/schemas";
import { FailureModeCard } from "../taxonomy/FailureModeCard";
import { NoteRow } from "../taxonomy/NotesToCategorise";
import { GoldTable } from "./GoldTable";
import { PromotionQueue } from "./PromotionQueue";
import type { GoldCandidate } from "./types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

const modes = SEED_TAXONOMY.failure_modes;
const note: Annotation = {
  annotation_id: "ann_1",
  trace_id: "trace_a",
  case_id: "C04",
  reviewer: "Grace Hopper",
  label_source: "human",
  demo: false,
  checklist: {},
  rubric_version: null,
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
  open_coding_notes: "Quoted an expired promo.",
  task_outcome: "fail",
  first_failure: { description: "Used the expired SPRING25 promo", failure_mode_id: null },
  additional_failure_mode_ids: [],
  severity: "critical",
  unsupported_justification_label: "present",
  taxonomy_version: 1,
};

describe("compact taxonomy rows", () => {
  it("shows a seed type with no human tags as 'not seen yet', never as observed", () => {
    const html = renderToStaticMarkup(
      createElement(FailureModeCard, {
        mode: modes[0],
        modes,
        freq: { failure_mode_id: modes[0].failure_mode_id, first_failure_count: 0, any_count: 0, trace_ids: [] },
        firstFailureTraceIds: [],
        reviewed: 3,
        traceModes: {},
        traceCases: {},
        evaluators: [],
        reload: () => undefined,
      }),
    );
    expect(html).toContain("not seen yet");
    expect(html).not.toMatch(/seen in/);
  });

  it("shows human-observed counts out of reviewed traces with a MOCK badge for mock traces", () => {
    const html = renderToStaticMarkup(
      createElement(FailureModeCard, {
        mode: { ...modes[0], status: "observed" },
        modes,
        freq: { failure_mode_id: modes[0].failure_mode_id, first_failure_count: 1, any_count: 2, trace_ids: ["t1", "t2"] },
        firstFailureTraceIds: ["t1"],
        reviewed: 5,
        traceModes: { t1: "live", t2: "mock" },
        traceCases: {},
        evaluators: [],
        reload: () => undefined,
      }),
    );
    expect(html).toMatch(/seen in <b[^>]*>2<\/b> of 5 reviewed traces/);
    expect(html).toContain("MOCK");
    expect(html).toContain("Edit");
  });

  it("renders an uncategorised note on one row with an Assign select and a name field when no name is saved", () => {
    const html = renderToStaticMarkup(
      createElement(NoteRow, { note, modes, assignable: modes, traceMode: "mock", reload: () => undefined }),
    );
    expect(html).toContain("Used the expired SPRING25 promo");
    expect(html).toContain("+ New type from this note");
    expect(html).toContain('aria-label="Your name"');
    expect(html).toContain("MOCK");
  });
});

describe("compact gold rows", () => {
  const gold: GoldExample = {
    gold_id: "gold_1",
    case_id: "C04",
    trace_id: "trace_a",
    annotation_id: "ann_1",
    input_scenario: getScenario("C04")!,
    reference_policy_ids: ["PRC-2026.2"],
    expected_behavior: "Route to the deal desk.",
    applicable_objective_rules: ["policy_effective_on_decision_date"],
    human_label: "fail",
    failure_mode_ids: [modes[0].failure_mode_id],
    unsupported_justification_label: "present",
    supporting_evidence: "Used the expired SPRING25 promo",
    reviewer: "Grace Hopper",
    review_timestamp: "2026-10-13T00:00:00Z",
    label_version: 1,
    dataset_split: "heldout",
    label_source: "human",
    demo: false,
    trace_execution_mode: "mock",
    promoted_at: "2026-10-13T00:00:00Z",
    promoted_by: "Ada",
  };

  it("shows only key columns, with held-out and MOCK marked", () => {
    const html = renderToStaticMarkup(
      createElement(GoldTable, { gold: [gold], names: { [modes[0].failure_mode_id]: modes[0].name }, reload: () => undefined }),
    );
    expect(html).toContain("HELD-OUT");
    expect(html).toContain("MOCK");
    expect(html).toContain("FAIL");
    expect(html).toContain(modes[0].name);
    expect(html).not.toContain("Route to the deal desk"); // provenance is in the collapsed row
  });

  it("renders one promotion row per candidate with a Promote button gated on a name", () => {
    const candidate: GoldCandidate = {
      annotation: { ...note, first_failure: { description: "x", failure_mode_id: null } },
      case_id: "C04",
      trace_id: "trace_a",
      split: "dev",
      execution_mode: "live",
      expected_behavior: { text: "Route to the deal desk.", reference_policy_ids: ["PRC-2026.2"] },
      expected_behavior_error: null,
      reason: "not_promoted",
      existing_gold_id: null,
    };
    const html = renderToStaticMarkup(createElement(PromotionQueue, { candidates: [candidate], names: {}, reload: () => undefined }));
    expect(html).toContain("Promote");
    expect(html).toContain("no type yet");
    expect(html).toMatch(/<button[^>]*title="Enter your name first"[^>]*disabled/);
  });
});
