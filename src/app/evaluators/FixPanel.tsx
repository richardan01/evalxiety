"use client";

/**
 * Fix panel: opened from a check card. Shows how to fix this kind of failure and
 * every answer that currently fails it (latest run per case and version), each
 * one click away from its trace.
 */
import Link from "next/link";
import { useMemo } from "react";
import { Badge, SplitBadge, cx } from "@/components/ui";
import { fixList, JUDGE_CHECK_ID } from "./fixList";
import { plainName } from "./matrix";
import type { EvaluatorResultRow } from "./types";

const GUIDE: Record<string, { what: string; steps: Array<{ text: string; href?: string; cta?: string }> }> = {
  stale_policy_used: {
    what: "The agent applied a pricing policy that wasn't in force on the decision date.",
    steps: [
      { text: "Open a trace and compare “Policy used” with the decision date and the policy table." },
      { text: "Usually a retrieval problem: the agent can only pick from the policies it was given. The Corrected version retrieves the policy in force on the decision date." },
      { text: "After changing the agent, re-run both versions on the frozen cases.", href: "/experiments", cta: "Experiments" },
    ],
  },
  margin_calculation_error: {
    what: "The stated revenue, cost or margin doesn't follow from the inputs.",
    steps: [
      { text: "Open a trace and check the cost basis used (merchant data vs policy default) and the arithmetic." },
      { text: "Fix the prompt's formula, or compute the economics in code and pass them to the agent." },
      { text: "Re-run on the frozen cases to confirm.", href: "/experiments", cta: "Experiments" },
    ],
  },
  margin_guardrail_violation: {
    what: "The recommended price leaves margin below the policy floor without an approved exception.",
    steps: [
      { text: "Open a trace: compare the true margin with the floor for this merchant size (and any valid promotion)." },
      { text: "Tell the agent to counter-offer at or above the floor unless a strategic exception goes to the CFO delegate." },
      { text: "Re-run on the frozen cases to confirm.", href: "/experiments", cta: "Experiments" },
    ],
  },
  missing_mandatory_approval: {
    what: "The recommendation skipped a human approval the policy requires for that price.",
    steps: [
      { text: "Open a trace: the reason below names the missing approver (e.g. deal_desk, cfo_delegate)." },
      { text: "Decide who is wrong. Agent wrong → make it list every approval rule it checked. Rule too strict → change the policy or the check, which versions the frozen set." },
      { text: "Re-run both versions and confirm nothing that passed now fails.", href: "/experiments", cta: "Experiments" },
    ],
  },
  [JUDGE_CHECK_ID]: {
    what: "The AI judge thinks the explanation makes a claim the evidence doesn't back (or it couldn't decide).",
    steps: [
      { text: "Open the trace and read the flagged claim against the evidence pack." },
      { text: "Answer “Every reason backed by the evidence?” yourself — your label is the reference, not the judge." },
      { text: "Judge wrong → sharpen the criterion in the rubric. Agent wrong → tell it to cite only supplied evidence.", href: "/review/rubric", cta: "Rubric" },
    ],
  },
};

export function FixPanel({ checkId, rows, onClose }: { checkId: string; rows: EvaluatorResultRow[]; onClose: () => void }) {
  const items = useMemo(() => fixList(rows, checkId), [rows, checkId]);
  const guide = GUIDE[checkId];
  const corrected = items.filter((i) => i.role === "corrected");
  const others = items.filter((i) => i.role !== "corrected");

  return (
    <section id="fix" className="scroll-mt-4 rounded-xl border border-sky-200 bg-white p-5 shadow-sm ring-1 ring-sky-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Fix: {plainName(checkId)}</h2>
          {guide && <p className="mt-0.5 text-sm text-slate-600">{guide.what}</p>}
        </div>
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800" aria-label="Close fix panel">
          ✕ Close
        </button>
      </div>

      {guide && (
        <ol className="mt-3 grid gap-2 md:grid-cols-3">
          {guide.steps.map((s, i) => (
            <li key={i} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{i + 1}</span>
              <span>
                {s.text}{" "}
                {s.href && (
                  <Link href={s.href} className="whitespace-nowrap text-sky-700 hover:underline">
                    {s.cta} →
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      {items.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          ✓ Nothing fails this check in the latest runs.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {[
            { title: "In the version you'd ship (Corrected)", list: corrected, empty: "Corrected passes this check on every case." },
            { title: "In other versions", list: others, empty: null },
          ].map(
            (g) =>
              (g.list.length > 0 || g.empty) && (
                <div key={g.title}>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {g.title} · {g.list.length}
                  </h3>
                  {g.list.length === 0 ? (
                    <p className="text-sm text-emerald-700">✓ {g.empty}</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {g.list.map((it) => (
                        <li key={it.trace_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                          <span className="w-10 font-mono text-sm font-semibold text-slate-900">{it.case_id}</span>
                          <Badge tone={it.role === "corrected" ? "blue" : "neutral"}>{it.version}</Badge>
                          {it.split === "heldout" && <SplitBadge split="heldout" />}
                          <Badge tone={it.outcome === "FAIL" ? "red" : it.outcome === "REQUIRES_REVIEW" ? "amber" : "purple"}>
                            {it.outcome === "REQUIRES_REVIEW" ? "unsure" : it.outcome.toLowerCase()}
                            {it.severity === "critical" ? " · critical" : ""}
                          </Badge>
                          <span className={cx("min-w-0 flex-1 text-sm text-slate-700")}>{it.reason}</span>
                          {it.occurrences > 1 && <span className="text-xs text-slate-400">failed in {it.occurrences} runs</span>}
                          <Link
                            href={`/review/${it.trace_id}`}
                            className="whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                          >
                            Open trace →
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ),
          )}
        </div>
      )}
    </section>
  );
}
