/**
 * The 9-step demo path. Each step's state is derived from /api/overview data
 * where the data can actually show it; otherwise the step is "neutral" (not
 * tracked) rather than guessed.
 */
import type { OverviewData } from "./types";
import { STATUS_META, topReason } from "@/app/release/status";

export type StepState = "done" | "todo" | "neutral";

export interface DemoStep {
  n: number;
  title: string;
  href: string;
  state: StepState;
  detail: string;
}

/** Gate reason codes meaning the frozen cases were not (fully) rerun for both configs. */
const RERUN_GAPS = [
  "no_candidate_run",
  "candidate_run_incomplete",
  "candidate_not_on_required_set",
  "frozen_set_mismatch",
  "required_tests_incomplete",
  "no_baseline",
  "baseline_set_mismatch",
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function demoSteps(o: OverviewData): DemoStep[] {
  const executed = o.executions.total;
  const reviewed = o.review.reviewed_traces;
  const run = o.candidate_run;
  const rerunGap = o.release_reasons.find((r) => RERUN_GAPS.includes(r.code));
  const top = topReason(o.release_reasons);

  return [
    {
      n: 1,
      title: "Execute a pricing case",
      href: "/review",
      state: executed > 0 ? "done" : "todo",
      detail: executed > 0 ? `${plural(executed, "execution")} recorded as traces.` : "No executions yet. Run one case from the Trace Review tab.",
    },
    {
      n: 2,
      title: "Inspect the trace",
      href: "/review",
      state: reviewed > 0 ? "done" : "neutral",
      detail:
        reviewed > 0
          ? "Implied by step 3: at least one trace has been read and annotated."
          : executed > 0
            ? "Open a trace and read the request, recommendation and cited evidence. Viewing a trace is not tracked."
            : "Execute a case first.",
    },
    {
      n: 3,
      title: "Record a human failure annotation",
      href: "/review",
      state: reviewed > 0 ? "done" : "todo",
      detail:
        reviewed > 0
          ? `${plural(reviewed, "trace")} carry a human annotation (target ${o.review.target_min}–${o.review.target_max}).`
          : "No human annotations yet. Mark a trace pass/fail and describe its first failure.",
    },
    {
      n: 4,
      title: "Classify the observed failure",
      href: "/review/taxonomy",
      state: o.observed_failure_modes > 0 ? "done" : "todo",
      detail:
        o.observed_failure_modes > 0
          ? `${plural(o.observed_failure_modes, "failure mode")} observed in human annotations (taxonomy v${o.taxonomy_version}).`
          : `No annotation is linked to a failure mode yet (taxonomy v${o.taxonomy_version}). Seed categories remain hypotheses until observed.`,
    },
    {
      n: 5,
      title: "Run a targeted evaluator",
      href: "/evaluators",
      state: "neutral",
      detail: "Deterministic checks run on every trace; the experimental judge runs per trace on demand. Not tracked here.",
    },
    {
      n: 6,
      title: "Judge–human agreement",
      href: "/evaluators#calibration",
      state: o.review.gold_dev > 0 ? "neutral" : "todo",
      detail:
        o.review.gold_dev > 0
          ? `${plural(o.review.gold_dev, "dev gold example")} available. Compare judge verdicts with human labels (TPR/TNR).`
          : "No dev gold labels yet. Promote human annotations to gold before measuring agreement.",
    },
    {
      n: 7,
      title: "Correct the agent configuration",
      href: "/experiments",
      state: run ? "done" : "todo",
      detail: run
        ? `The corrected configuration completed a run on the release set (${run.run_id}).`
        : "No completed corrected-configuration run on the release set yet.",
    },
    {
      n: 8,
      title: "Rerun the frozen test cases",
      href: "/experiments",
      state: run && !rerunGap ? "done" : "todo",
      detail:
        run && !rerunGap
          ? "Baseline and corrected both ran every frozen case on the same frozen set."
          : (rerunGap?.message ?? "Run the baseline and corrected configurations on the frozen release set."),
    },
    {
      n: 9,
      title: "Release recommendation and limitations",
      href: "/release",
      state: o.release_status === "APPROVED_FOR_DEMO" ? "done" : "neutral",
      detail:
        o.release_status === "APPROVED_FOR_DEMO"
          ? "A named human approved the current evidence for demo use."
          : `Current status: ${STATUS_META[o.release_status].label}${top ? ` — ${top.message}` : ""}`,
    },
  ];
}
