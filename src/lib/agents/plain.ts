/**
 * The release gate in plain words, for the person deciding (often a product manager, not the agent's author).
 *
 * Pure and client-safe: it only rewords what the gate already decided. It never changes a verdict, never hides a
 * reason, and keeps every case id so each sentence can be traced back to the evidence.
 *
 * Words used (see GLOSSARY): "new version" = candidate run, "current version" = baseline run, "rule" = code check,
 * "final-exam cases" = held-out cases, "AI reviewer" = LLM judge.
 */
import type { AgentGateResult, GateReason } from "./gate";

export type PlainTone = "red" | "amber" | "blue" | "green" | "slate";

/** Where on the agent page the user acts on an item (an anchor id), or null when it's information only. */
export type PlainWhere = "review" | "add-run" | "runs" | "cases" | "rules" | "approve" | null;

/** Page anchor on the agent page for each place an item is acted on. */
export const ANCHOR: Record<Exclude<PlainWhere, null>, string> = {
  review: "review",
  "add-run": "add-run",
  runs: "runs",
  cases: "cases",
  rules: "rules",
  approve: "checklist",
};

export interface PlainItem {
  code: string;
  text: string;
  case_ids: string[];
  where: PlainWhere;
}

export interface PlainChanges {
  fixed: string[];
  got_worse: Array<{ case_id: string; rules: string[] }>;
  still_failing: string[];
  still_passing: number;
  incomplete: string[];
}

export interface PlainVerdict {
  tone: PlainTone;
  headline: string;
  summary: string;
  /** Problems that block the release (NO SHIP). */
  blockers: PlainItem[];
  /** Evidence still missing before anyone can decide. */
  todo: PlainItem[];
  /** Worth knowing; doesn't block on its own. On starter-kit data this includes what WOULD block a real release. */
  notes: PlainItem[];
  changes: PlainChanges | null;
  /** The single first thing to do, or null when nothing is left but the decision. */
  next: PlainItem | null;
}

export interface PlainInput {
  example: boolean;
  gate: Pick<AgentGateResult, "status" | "reasons" | "comparison" | "approval_state" | "latest_approval">;
  checks: Array<{ evaluator_id: string; question: string }>;
  reviewed_trace_count: number;
  min_reviewed_traces: number;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

function ruleQuestion(checks: PlainInput["checks"], id: string): string {
  return checks.find((c) => c.evaluator_id === id)?.question ?? id;
}

/** Reword one gate reason. Unknown codes keep the gate's own message, so nothing is ever dropped. */
export function plainReason(r: GateReason, input: PlainInput): PlainItem {
  const n = r.case_ids.length;
  const cases = (k: number) => plural(k, "case");
  const item = (text: string, where: PlainWhere): PlainItem => ({ code: r.code, text, case_ids: r.case_ids, where });
  // Starter-kit data turns NO SHIP reasons into warnings: say what they would mean on a real agent.
  if (r.message.startsWith("(example data")) {
    const inner = plainReason({ ...r, message: r.message.replace(/^\(example data — not evidence\)\s*/, "") }, { ...input, example: false });
    return { ...inner, text: `Would block a real release: ${inner.text}` };
  }
  if (r.code.startsWith("expected_field_missing:")) {
    const id = r.code.slice("expected_field_missing:".length);
    return item(`The rule “${ruleQuestion(input.checks, id)}” can't check ${cases(n)}: their expected answer is missing the field it compares.`, "cases");
  }
  switch (r.code) {
    case "no_checks":
      return item("Add at least one rule, so something objective is checked on every answer.", "rules");
    case "cases_changed":
      return item("Your test cases changed since they were locked. Lock the new set, then test both versions again.", "cases");
    case "heldout_not_revealed":
      return item(
        "When you've finished improving the agent, unlock the final-exam cases and test both versions on them. They stay hidden until then, so the final score is on questions nobody tuned for.",
        "cases",
      );
    case "heldout_moved_to_dev":
      return item("Some final-exam cases were moved into the practice set before the final check. Move them back, then lock the cases again.", "cases");
    case "heldout_removed":
      return r.level === "WARNING"
        ? item(`${cases(n)} from the final exam were deleted unused, so the final check covers fewer questions.`, "cases")
        : item("Every final-exam case was deleted before it was used, so there is no final check. Restore them.", "cases");
    case "heldout_used_before_reveal":
      return item("Some final-exam questions were already seen before the final check. Replace them with fresh questions, then lock the cases again.", "cases");
    case "no_candidate_run":
      return item("Add the new version you want to ship.", "add-run");
    case "candidate_run_incomplete":
      return item("The new version's test is still running or failed. Wait for it, or run it again.", "runs");
    case "candidate_stale_cases":
      return item("The new version was tested on an older set of cases. Test it again.", "add-run");
    case "required_tests_incomplete":
      return item(`The new version has no answer, or an error, on ${cases(n)}. Test it again so every case has an answer.`, "add-run");
    case "judge_not_run":
      return item(`Run the AI reviewer on the new version (${cases(n)} not checked yet).`, "runs");
    case "no_baseline":
      return item("Add the version you ship today, so we can see whether anything got worse.", "add-run");
    case "baseline_is_candidate":
      return item("The current and new version point at the same test. Pick a different one for each.", "runs");
    case "baseline_set_mismatch":
    case "baseline_cases_differ":
      return item("The current version was tested on different cases from the new one. Test it again on the same cases.", "add-run");
    case "baseline_incomplete":
      return item(`The current version has missing or failed answers on ${cases(n)}, so we can't tell whether those got worse. Test it again.`, "add-run");
    case "same_version":
      return item("Both versions have the same name. Check you're comparing the two you mean to.", "runs");
    case "insufficient_human_review": {
      const left = Math.max(0, input.min_reviewed_traces - input.reviewed_trace_count);
      return item(`Review ${plural(left, "more answer")} (at least ${input.min_reviewed_traces} in total), so we know what really goes wrong.`, "review");
    }
    case "unresolved_required_reviews":
      return item(`Read and mark the new version's remaining ${plural(n, "answer")}: every answer gets a human look before release.`, "review");
    case "judge_flags_unanswered":
      return item(`The AI reviewer flagged ${plural(n, "answer")} you've reviewed. Open each one and answer its question.`, "review");
    case "critical_check_failed":
      return item(`A critical rule failed on ${cases(n)}.`, "rules");
    case "blocking_check_failed":
      return item(`A must-pass rule failed on ${cases(n)}.`, "rules");
    case "new_critical_regression": {
      const worse = (input.gate.comparison?.new_critical_regressions ?? []).map((x) => `${x.case_id} (“${ruleQuestion(input.checks, x.evaluator_id)}”)`);
      return item(`Something that worked in the current version is broken in the new one: ${worse.join(", ") || r.case_ids.join(", ")}.`, "rules");
    }
    case "new_regression": {
      const worse = (input.gate.comparison?.new_regressions ?? []).filter((x) => x.severity !== "critical").map((x) => `${x.case_id} (“${ruleQuestion(input.checks, x.evaluator_id)}”)`);
      return item(`Got worse on a non-critical rule: ${worse.join(", ") || r.case_ids.join(", ")}.`, "rules");
    }
    case "human_confirmed_critical":
      return item(`A reviewer marked ${plural(n, "answer")} of the new version as a critical failure.`, "review");
    case "human_confirmed_noncritical":
      return item(`Reviewers marked ${plural(n, "answer")} of the new version as failed (not critical). The approver sees this.`, "review");
    case "human_found_judge_failure":
      return item(`Reviewers agreed with the AI reviewer's concern on ${plural(n, "answer")}.`, "review");
    case "pass_all_below_threshold":
      return item(r.message.replace("pass every code check", "pass every rule"), "rules");
    case "example_data":
      return item("This is practice data from the starter kit. It shows how the decision works; it is not evidence about a real agent.", null);
    default:
      return item(r.message, null);
  }
}

/**
 * The order to work through missing evidence, matching the gate's own next step: fix the setup, then get both
 * versions tested, then review, and unlock the final exam last (unlocking ends tuning).
 */
const TODO_RANK: Record<string, number> = {
  no_checks: 0,
  cases_changed: 0,
  heldout_moved_to_dev: 0,
  heldout_used_before_reveal: 0,
  heldout_removed: 0,
  no_baseline: 1,
  no_candidate_run: 1,
  candidate_run_incomplete: 1,
  candidate_stale_cases: 1,
  required_tests_incomplete: 1,
  baseline_is_candidate: 1,
  baseline_set_mismatch: 1,
  baseline_cases_differ: 1,
  baseline_incomplete: 1,
  heldout_not_revealed: 3,
};
const rank = (code: string) => TODO_RANK[code] ?? 2;

function changesOf(input: PlainInput): PlainChanges | null {
  const c = input.gate.comparison;
  if (!c) return null;
  return {
    fixed: c.fixed,
    got_worse: c.pairs
      .filter((p) => p.change === "regressed")
      .map((p) => ({ case_id: p.case_id, rules: p.evaluator_changes.filter((e) => e.kind === "regressed").map((e) => ruleQuestion(input.checks, e.evaluator_id)) })),
    still_failing: c.still_failing,
    still_passing: c.still_passing.length,
    incomplete: c.incomplete,
  };
}

export function plainVerdict(input: PlainInput): PlainVerdict {
  const { gate } = input;
  const reasons = gate.reasons.filter((r) => r.code !== "example_data");
  const blockers = reasons.filter((r) => r.level === "NO_SHIP").map((r) => plainReason(r, input));
  const todo = reasons
    .filter((r) => r.level === "INSUFFICIENT_EVIDENCE")
    .map((r) => plainReason(r, input))
    .sort((a, b) => rank(a.code) - rank(b.code));
  const notes = reasons.filter((r) => r.level === "WARNING").map((r) => plainReason(r, input));
  const changes = changesOf(input);
  const next = blockers[0] ?? todo.find((t) => t.where !== null) ?? todo[0] ?? null;
  const approver = gate.latest_approval?.approver ?? "a named person";
  const on = gate.latest_approval ? ` on ${fmtDate(gate.latest_approval.created_at)}` : "";

  let tone: PlainTone;
  let headline: string;
  let summary: string;
  // Example data can come from the starter kit itself, or from any agent fed the starter kit's toy answers.
  const practice = input.example || gate.reasons.some((r) => r.code === "example_data");
  if (practice) {
    tone = "amber";
    headline = input.example ? "Practice run: the starter kit can never be approved" : "Practice data: these answers can never be approved";
    summary = `${input.example ? "It" : "They come from the starter kit's toy bot, not a real agent. This"} shows how a real decision works. Anything listed under “Would block a real release” stops a real release.`;
  } else if (gate.status === "APPROVED_FOR_DEMO") {
    tone = "green";
    headline = "Approved to ship";
    summary = `Approved by ${approver}${on}, for exactly this evidence. If the evidence changes, the approval expires.`;
  } else if (gate.status === "NO_SHIP") {
    tone = "red";
    headline = "Not ready to ship";
    summary = `${plural(blockers.length, "problem")} must be fixed first.${todo.length ? ` ${plural(todo.length, "more thing")} ${todo.length === 1 ? "is" : "are"} needed before anyone can approve it.` : ""}`;
  } else if (gate.status === "INSUFFICIENT_EVIDENCE") {
    tone = "amber";
    headline = "Not enough evidence to decide yet";
    summary = `${plural(todo.length, "thing")} still needed. Nothing has failed that blocks the release, but there isn't enough to approve it.`;
  } else if (gate.approval_state === "rejected") {
    tone = "slate";
    headline = "Rejected";
    summary = `Rejected by ${approver}${on}. Change the agent and test a new version.`;
  } else {
    tone = "blue";
    headline = "Ready for your decision";
    summary =
      gate.approval_state === "stale"
        ? "The evidence changed since the last decision, so it needs a fresh one. A named person can approve or reject this release."
        : "All the evidence is in. A named person can approve or reject this release.";
  }
  return { tone, headline, summary, blockers, todo, notes, changes, next: next ?? (gate.status === "ELIGIBLE_FOR_DEMO_APPROVAL" ? { code: "decide", text: "Approve or reject this release.", case_ids: [], where: "approve" } : null) };
}

/** The agent's journey for Start here: five steps, each done / current / to do. */
export interface JourneyStep {
  n: number;
  title: string;
  detail: string;
  state: "done" | "active" | "todo";
  where: PlainWhere;
}

export interface JourneyInput extends PlainInput {
  has_completed_run: boolean;
  has_comparison: boolean;
  heldout_exists: boolean;
  heldout_revealed: boolean;
  cases: number;
}

export function agentJourney(input: JourneyInput): JourneyStep[] {
  const decided = input.gate.approval_state === "approved" || input.gate.approval_state === "rejected";
  const finalDone = (!input.heldout_exists || input.heldout_revealed) && input.gate.status !== "INSUFFICIENT_EVIDENCE";
  const raw: Array<Omit<JourneyStep, "state"> & { done: boolean }> = [
    { n: 1, title: "Connect your agent", detail: `${plural(input.cases, "test case")}`, done: true, where: "cases" },
    { n: 2, title: "Test the version you ship today", detail: input.has_completed_run ? "done" : "import its answers, or let Evalxiety call it", done: input.has_completed_run, where: "add-run" },
    {
      n: 3,
      title: "Review answers yourself",
      detail: `${input.reviewed_trace_count} of at least ${input.min_reviewed_traces} reviewed`,
      done: input.reviewed_trace_count >= input.min_reviewed_traces,
      where: "review",
    },
    { n: 4, title: "Test your new version", detail: input.has_comparison ? "compared with the current version" : "add the change you want to ship", done: input.has_comparison, where: "add-run" },
    {
      n: 5,
      title: "Final check and decision",
      detail: decided ? (input.gate.approval_state === "approved" ? "approved" : "rejected") : input.heldout_exists && !input.heldout_revealed ? "final-exam cases still locked" : "waiting for evidence or a decision",
      done: decided && finalDone,
      where: decided || input.gate.status === "ELIGIBLE_FOR_DEMO_APPROVAL" ? "approve" : "cases",
    },
  ];
  const active = raw.findIndex((s) => !s.done);
  return raw.map(({ done, ...s }, i) => ({ ...s, state: done ? "done" : i === active ? "active" : "todo" }));
}
