/**
 * Live app state for the guide agent, plus a free rule-based reply used when
 * the app is in mock mode (or a live call can't be made).
 */
import { overviewView } from "../services";
import { modeInfo, readLedger } from "../llm/client";
import { demoSteps, type DemoStep } from "@/app/_overview/demoPath";
import { nextStep } from "./next";

export interface GuideState {
  mode: "live" | "mock";
  page: string;
  steps: DemoStep[];
  text: string;
}

export async function guideState(page: string): Promise<GuideState> {
  const [o, ledger] = await Promise.all([overviewView(), readLedger()]);
  const info = modeInfo();
  const steps = demoSteps(o);
  const text = [
    `<app_state>`,
    `Current page: ${page}`,
    `Mode: ${info.mode.toUpperCase()} (${info.reason}). Live spend so far: $${ledger.total_estimated_usd.toFixed(2)} of $${info.spend_cap_usd.toFixed(2)} cap.`,
    `Executions: ${o.executions.total} (${o.executions.live} live, ${o.executions.mock} mock, ${o.executions.errors} errors).`,
    `Human review: ${o.review.reviewed_traces} traces annotated (target ${o.review.target_min}–${o.review.target_max}), ${o.review.unreviewed} unreviewed. Gold: ${o.review.gold_dev} dev, ${o.review.gold_heldout} held-out.`,
    `Observed failure modes: ${o.observed_failure_modes} (taxonomy v${o.taxonomy_version}).`,
    `Release status: ${o.release_status}. Pass-all rate: ${o.pass_all_rate == null ? "n/a" : `${(o.pass_all_rate * 100).toFixed(0)}%`}. Critical failures: ${o.critical_failures ?? "n/a"}.`,
    `Top release reasons: ${o.release_reasons.slice(0, 3).map((r) => r.message).join(" | ") || "none"}`,
    `Demo path:`,
    ...steps.map((s) => `  ${s.n}. [${s.state}] ${s.title} (${s.href}) — ${s.detail}`),
    `</app_state>`,
  ].join("\n");
  return { mode: info.mode, page, steps, text };
}

const PAGE_HELP: Record<string, string> = {
  "/": "**Overview** shows how far you are through the demo path and the current release status.",
  "/review":
    "**Trace Review** is where you run a case and judge it yourself. A *trace* is one recorded run of the agent. Pick a case and config, run it, open the trace, then answer the 5-question checklist (✓ / ✗ / ?), mark Pass or Fail, and on Fail add one line on the first failure plus a severity.",
  "/review/taxonomy":
    "**Failure taxonomy** groups your reviewer notes into failure categories so you can count which problems happen most.",
  "/review/rubric": "**Rubric** is the review checklist and the AI judge's criterion. Edits create a new version, and the judge prompt is built from it.",
  "/review/gold": "**Gold dataset** turns human-reviewed traces into trusted labels used to check the LLM judge.",
  "/evaluators":
    "**Evaluators** shows the automatic checks: 4 deterministic code checks and 1 experimental LLM judge, plus how well the judge agrees with human labels.",
  "/experiments":
    "**Experiments** runs Baseline and Corrected on the same frozen set of cases and compares them case by case.",
  "/release": "**Release Gate** turns all the evidence into a ship / no-ship decision that a named human must approve.",
};

function pageHelp(page: string): string {
  const key = Object.keys(PAGE_HELP)
    .sort((a, b) => b.length - a.length)
    .find((k) => (k === "/" ? page === "/" : page.startsWith(k)));
  return PAGE_HELP[key ?? "/"];
}

/** Deterministic answer for mock mode — no API spend. */
export function mockReply(question: string, state: GuideState, why: string): string {
  const q = question.toLowerCase();
  const next = nextStep(state.steps);
  const nextLine = next
    ? `**Next step (${next.n}/9): ${next.title}** — ${next.detail} → [Go there](${next.href})`
    : "You've completed every tracked step. Review the [Release Gate](/release) and its limitations.";

  let body: string;
  if (/(own|my) agent|evaluate (my|an?|your)/.test(q)) {
    body = [
      "To evaluate your own agent, use the same loop this app demonstrates:",
      "1. Collect 20–100 real traces of your agent.",
      "2. Read each one and note the *first* thing that went wrong (error analysis).",
      "3. Group the notes into a failure taxonomy and count them.",
      "4. Write a narrow pass/fail check per important failure — code first, LLM judge only when subjective.",
      "5. Check any LLM judge against human labels (TPR/TNR), then confirm on held-out data.",
      "6. Compare old vs. new agent on the same frozen cases; look for regressions.",
      "7. Set release rules up front and require a named human sign-off.",
      "In this codebase the pieces live in `src/lib/agent/`, `src/lib/domain/scenarios.ts`, `src/lib/evaluators/` and `src/lib/release/gate.ts`.",
    ].join("\n");
  } else if (/page|here|this tab|what is this/.test(q)) {
    body = `${pageHelp(state.page)}\n\n${nextLine}`;
  } else if (/cost|price|spend|money|credit/.test(q)) {
    body =
      "Live agent calls cost about $0.07 each and judge calls about $0.045. Re-running an identical case is cached and free. Batches ask before spending, and the spend cap blocks anything beyond your limit. Mock mode is always free.";
  } else {
    body = `${nextLine}\n\n${pageHelp(state.page)}`;
  }
  return `${body}\n\n_Guide is in offline mode (${why}) — answers are pre-written, not from Claude._`;
}
