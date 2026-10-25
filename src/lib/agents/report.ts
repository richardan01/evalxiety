/**
 * A one-page release report for people who weren't in the tool: a launch review, a Slack thread, a doc.
 *
 * Pure and client-safe. Everything comes from the same agent overview the page shows, including the evidence
 * fingerprint, so a pasted report can be matched to exactly what was (or wasn't) approved.
 */
import type { agentOverview } from "./services";
import { agentJourney, plainVerdict, plural, type JourneyStep, type PlainItem, type PlainVerdict } from "./plain";

export type ReportView = Awaited<ReturnType<typeof agentOverview>>;
type Run = ReportView["runs"][number];

export function verdictOf(view: ReportView): PlainVerdict {
  return plainVerdict({
    example: view.agent.example,
    gate: view.gate,
    checks: view.checks,
    reviewed_trace_count: view.reviewed_trace_count,
    min_reviewed_traces: view.agent.min_reviewed_traces,
  });
}

export function journeyOf(view: ReportView): JourneyStep[] {
  return agentJourney({
    example: view.agent.example,
    gate: view.gate,
    checks: view.checks,
    reviewed_trace_count: view.reviewed_trace_count,
    min_reviewed_traces: view.agent.min_reviewed_traces,
    has_completed_run: view.runs.some((r) => r.status === "completed"),
    has_comparison: view.gate.comparison !== null,
    heldout_exists: view.cases.some((c) => c.split === "heldout"),
    heldout_revealed: view.heldout.revealed,
    cases: view.cases.length,
  });
}

export function selectedRuns(view: ReportView): { candidate: Run | null; baseline: Run | null } {
  const byId = new Map(view.runs.map((r) => [r.run_id, r]));
  return { candidate: byId.get(view.selected.candidate ?? "") ?? null, baseline: byId.get(view.selected.baseline ?? "") ?? null };
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const pct = (v: number | null) => (v === null ? "undefined" : `${(v * 100).toFixed(0)}%`);
const source = (r: Run) => (r.execution_mode === "http" ? "called over HTTP" : "imported from a file");

export function runLine(r: Run | null): string {
  if (!r) return "none yet";
  return `**${r.agent_version}**, tested ${fmtDate(r.created_at)} by ${r.created_by} (${source(r)}), ${r.summary.n_with_trace} of ${r.summary.n_cases} cases answered`;
}

function items(list: PlainItem[]): string[] {
  return list.map((i) => `- ${i.text}${i.case_ids.length ? ` (${i.case_ids.slice(0, 12).join(", ")}${i.case_ids.length > 12 ? ", …" : ""})` : ""}`);
}

/** Plain-language summary of how far the AI reviewer can be trusted. */
export function judgeLine(view: ReportView): string {
  const j = view.agent.judge;
  if (!j) return "No AI reviewer is set up; subjective problems rely on human review alone.";
  const c = view.calibration;
  if (c.insufficient) {
    return `Experimental. Compared with your own labels on ${plural(c.pairs, "answer")}; it needs at least ${c.min_per_class} problems and ${c.min_per_class} fine answers before its agreement means anything (now ${c.matrix.positives} and ${c.matrix.negatives}).`;
  }
  return `Experimental. It caught ${c.matrix.tp} of ${c.matrix.positives} problems you found and cleared ${c.matrix.tn} of ${c.matrix.negatives} answers you marked fine.`;
}

export function reportMarkdown(view: ReportView, now: Date = new Date()): string {
  const v = verdictOf(view);
  const { candidate, baseline } = selectedRuns(view);
  const out: string[] = [];
  out.push(`# Release report: ${view.agent.name}`, "", `Generated ${fmtDate(now.toISOString())} by Evalxiety.`);
  if (view.agent.example) out.push("", "> Practice data from the starter kit. It shows how the decision works; it is not evidence about a real agent.");

  out.push("", `## Verdict: ${v.headline}`, "", v.summary);

  out.push("", "## What was compared", "", `- New version: ${runLine(candidate)}`, `- Current version: ${runLine(baseline)}`);

  out.push("", "## Results", "");
  if (candidate) {
    out.push(
      `- Passed every rule: new version ${candidate.summary.pass_all_count} of ${candidate.summary.n_cases} (${pct(candidate.summary.pass_all_rate)})` +
        (baseline ? `, current version ${baseline.summary.pass_all_count} of ${baseline.summary.n_cases} (${pct(baseline.summary.pass_all_rate)})` : "") +
        `. The bar is ${pct(view.agent.pass_all_threshold)}.`,
    );
  } else {
    out.push("- No new version tested yet.");
  }
  if (v.changes) {
    const ch = v.changes;
    out.push(`- Fixed: ${ch.fixed.length}${ch.fixed.length ? ` (${ch.fixed.join(", ")})` : ""}`);
    out.push(`- Got worse: ${ch.got_worse.length}${ch.got_worse.length ? ` (${ch.got_worse.map((g) => `${g.case_id}: ${g.rules.map((r) => `“${r}”`).join(", ") || "now fails a rule"}`).join("; ")})` : ""}`);
    out.push(`- Still failing: ${ch.still_failing.length}${ch.still_failing.length ? ` (${ch.still_failing.join(", ")})` : ""}`);
    out.push(`- Unchanged and passing: ${ch.still_passing}`);
    if (ch.incomplete.length) out.push(`- Can't compare (missing or failed answers): ${ch.incomplete.join(", ")}`);
  }

  if (v.blockers.length) out.push("", "## Must fix before shipping", "", ...items(v.blockers));
  if (v.todo.length) out.push("", "## Still needed before a decision", "", ...items(v.todo));
  if (v.notes.length) out.push("", "## Worth knowing", "", ...items(v.notes));

  out.push("", "## Human review", "", `- ${plural(view.reviewed_trace_count, "answer")} reviewed by a person (at least ${view.agent.min_reviewed_traces} needed).`);
  if (view.failure_types.length) {
    out.push(`- Problems found, most common first: ${view.failure_types.map((f) => `${f.name} (${f.count}${f.critical ? `, ${f.critical} critical` : ""})`).join("; ")}.`);
  } else {
    out.push("- No problems labelled yet.");
  }

  out.push("", "## Rules checked on the new version", "");
  if (!view.checks.length) out.push("No rules are set up.");
  else {
    out.push("| Rule | Severity | Passed | Failed | Couldn't check |", "|---|---|---|---|---|");
    for (const d of view.checks) {
      const t = candidate?.summary.per_evaluator[d.evaluator_id];
      out.push(`| ${d.question.replace(/\|/g, "\\|")} | ${d.severity}${d.blocking ? ", must pass" : ""} | ${t?.pass ?? "—"} | ${t?.fail ?? "—"} | ${t ? t.not_applicable + t.error : "—"} |`);
    }
  }

  out.push("", "## AI reviewer", "");
  if (view.agent.judge) out.push(`- Question: “${view.agent.judge.question}”`);
  out.push(`- ${judgeLine(view)} It never replaces a human review.`);

  const heldout = view.cases.filter((c) => c.split === "heldout").length;
  const latest = view.frozen.versions[view.frozen.versions.length - 1];
  out.push(
    "",
    "## Test set",
    "",
    `- ${plural(view.cases.length, "test case")}, ${plural(heldout, "final-exam case")}${heldout ? ` (${view.heldout.revealed && view.heldout.revealed_at ? `unlocked ${fmtDate(view.heldout.revealed_at)} by ${view.heldout.revealed_by}` : "still locked"})` : ""}.`,
    latest ? `- Cases locked as version ${latest.version} (fingerprint ${latest.content_hash.slice(0, 12)}).` : "- Cases not locked yet (the first test locks them).",
  );

  out.push("", "## Decision", "");
  const a = view.gate.latest_approval;
  if (a && view.gate.approval_state !== "stale") {
    out.push(`- ${a.decision === "approved" ? "Approved" : "Rejected"} by ${a.approver} on ${fmtDate(a.created_at)}${a.notes ? `: “${a.notes}”` : ""}.`);
  } else if (a) {
    out.push(`- The last decision (${a.decision} by ${a.approver}) was for older evidence, so it no longer applies.`);
  } else {
    out.push("- No decision yet.");
  }

  out.push(
    "",
    "## Evidence fingerprint",
    "",
    `\`${view.evidence_snapshot_hash}\``,
    "",
    "Any change to the tests, reviews, rules or cases changes this fingerprint. An approval only covers the fingerprint it was given for.",
    "",
    "## Limits",
    "",
    ...view.gate.limitations.map((l) => `- ${l}`),
  );
  return out.join("\n") + "\n";
}
