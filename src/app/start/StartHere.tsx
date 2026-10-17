"use client";

/**
 * Start here: the learning path through AgentTrust, what each stage teaches,
 * what to do next (from live state), and how to bring your own agent.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { Badge, InfoTip, PageHeader, cx } from "@/components/ui";
import type { OverviewData } from "@/app/_overview/types";

type Status = "done" | "active" | "todo";

function StageCard({ n, title, status, doThis, learn, href, cta, detail }: {
  n: number;
  title: string;
  status: Status;
  doThis: string;
  learn: string;
  href: string;
  cta: string;
  detail?: string;
}) {
  return (
    <li className={cx("flex gap-4 rounded-xl border bg-white p-4 shadow-sm", status === "active" ? "border-sky-300 ring-1 ring-sky-200" : "border-slate-200")}>
      <span
        className={cx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          status === "done" ? "bg-emerald-600 text-white" : status === "active" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600",
        )}
        aria-label={status}
      >
        {status === "done" ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {status === "active" && <Badge tone="blue">you are here</Badge>}
          {detail && <span className="text-xs text-slate-500">{detail}</span>}
        </div>
        <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">You do</dt>
            <dd className="text-slate-700">{doThis}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">You learn</dt>
            <dd className="text-slate-700">{learn}</dd>
          </div>
        </dl>
      </div>
      <Link href={href} className={cx("self-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium", status === "active" ? "bg-slate-900 text-white hover:bg-slate-700" : "text-sky-700 hover:underline")}>
        {cta} →
      </Link>
    </li>
  );
}

function Tip({ title, why, href, cta, tone = "slate" }: { title: string; why: string; href: string; cta: string; tone?: "red" | "amber" | "slate" | "green" }) {
  const border = { red: "border-l-rose-500", amber: "border-l-amber-500", slate: "border-l-slate-400", green: "border-l-emerald-500" }[tone];
  return (
    <li className={cx("rounded-md border border-slate-200 border-l-4 bg-white px-4 py-3", border)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-900">{title}</span>
        <Link href={href} className="text-xs text-sky-700 hover:underline">
          {cta} →
        </Link>
      </div>
      <p className="mt-0.5 text-sm text-slate-600">{why}</p>
    </li>
  );
}

const GLOSSARY: Array<[string, string]> = [
  ["Trace", "One recorded run of the agent: input, evidence it was given, its answer, cost and latency."],
  ["Open coding", "Reading traces and writing down what went wrong in your own words, before any categories exist."],
  ["Axial coding", "Grouping those notes into failure types, then counting how often each really occurred."],
  ["Rubric", "What \"good\" means for this agent: the review checklist and the judge's criterion."],
  ["Code check", "A deterministic pass/fail rule for an objective requirement (e.g. the right policy for the date)."],
  ["AI judge", "A Claude prompt that answers one narrow yes/no question about an answer. Experimental until it agrees with your labels."],
  ["TPR / TNR", "How often the judge catches real problems / how often it avoids false alarms, measured against your labels."],
  ["Gold set", "Human-reviewed answers kept as the reference. Split into dev (for tuning) and held-out (touched once, at the end)."],
  ["Pass-all", "Share of cases where every code check passes. Never an averaged score."],
  ["Regression", "A case that passed before the change and fails after it."],
];

export function StartHere() {
  const [o, setO] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJSON<OverviewData>("/api/overview")
      .then(setO)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="text-sm text-rose-700">Could not load progress: {error}</p>;
  if (!o) return <p className="text-sm text-slate-500">Loading…</p>;

  const reviewed = o.review.reviewed_traces;
  const minReviews = o.review.target_min;
  const ran = o.executions.total > 0;
  const compared = o.history.length >= 2 && o.trend.points.length >= 2;
  const judgeN = o.judge?.n ?? 0;
  const regressions = o.trend.new_critical_regressions;
  const corrected = o.trend.points.find((p) => p.role === "corrected") ?? null;
  const fullRun = o.candidate_run !== null;

  // Stage status: the first stage that is not done is "active".
  const dones = [
    ran,
    reviewed >= minReviews,
    o.observed_failure_modes > 0,
    judgeN > 0,
    fullRun && o.release_status !== "INSUFFICIENT_EVIDENCE",
  ];
  const activeIdx = dones.findIndex((d) => !d);
  const st = (i: number): Status => (dones[i] ? "done" : i === activeIdx ? "active" : "todo");

  // Improvement advice from live state (most important first).
  const tips: Array<{ title: string; why: string; href: string; cta: string; tone: "red" | "amber" | "slate" | "green" }> = [];
  if (!ran) tips.push({ title: "Run your first case", why: "Everything starts from real traces, not imagined failures.", href: "/review", cta: "Run a case", tone: "slate" });
  if (regressions.length) {
    tips.push({
      title: `Resolve the regression in ${regressions.map((r) => r.case_id).join(", ")}`,
      why: "Open the trace and decide: is the agent wrong, or is the rule too strict? If the agent — change the prompt or retrieval and re-run. If the rule — fix the policy data or the check, which versions the frozen set.",
      href: "/experiments",
      cta: "Inspect",
      tone: "red",
    });
  }
  if (reviewed < minReviews) {
    tips.push({
      title: `Review ${minReviews - reviewed} more answer${minReviews - reviewed === 1 ? "" : "s"}`,
      why: "Your labels are the ground truth. Automated results stay hidden until you've labelled, so they can't bias you.",
      href: "/review",
      cta: "Review",
      tone: "amber",
    });
  }
  if (reviewed > 0 && o.observed_failure_modes === 0) {
    tips.push({ title: "Group your notes into failure types", why: "Counting what actually happened tells you which checks are worth building and which seed categories were wrong.", href: "/review/taxonomy", cta: "Axial coding", tone: "amber" });
  }
  if (reviewed > 0 && judgeN === 0) {
    tips.push({
      title: "Calibrate the AI judge",
      why: "Promote reviewed answers to the gold set; the judge is compared with your evidence answers. Until then its verdicts are only hints.",
      href: "/review/gold",
      cta: "Gold set",
      tone: "slate",
    });
  } else if (judgeN > 0 && o.judge && ((o.judge.tpr !== null && o.judge.tpr < 0.8) || (o.judge.tnr !== null && o.judge.tnr < 0.8))) {
    tips.push({
      title: "The judge disagrees with you too often",
      why: "Read the disagreements, then sharpen the criterion in the rubric (examples of unsupported claims help most). Saving starts a new judge version.",
      href: "/evaluators#calibration",
      cta: "Disagreements",
      tone: "amber",
    });
  }
  if (corrected && corrected.pass_all_rate !== null && corrected.pass_all_rate < 0.9) {
    tips.push({ title: "Pass-all is below the 90% demo bar", why: "Look at the still-failing cases one by one; a fix only counts if it doesn't break cases that passed.", href: "/experiments", cta: "Failing cases", tone: "amber" });
  }
  if (compared && reviewed >= minReviews && !fullRun) {
    tips.push({ title: "Run the final check on all 20 cases", why: "The 8 held-out cases were never used for tuning, so they are your honest estimate. Revealing them is logged and irreversible.", href: "/experiments", cta: "Final check", tone: "slate" });
  }
  if (o.release_status === "APPROVED_FOR_DEMO") tips.push({ title: "Approved — keep the loop running", why: "New failures from real usage go back into review; every fix gets a check so it can't silently return.", href: "/review", cta: "Review", tone: "green" });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Start here"
        question="Learn the method by running it on the built-in pricing agent — then bring your own."
        info="Evalxiety is a nervous quality-control companion: it keeps checking whether your evaluation results can be trusted. It follows Hamel Husain & Shreya Shankar's product-specific evals: real traces first, human error analysis, failure types from what you saw, code checks for objective rules, one narrow AI judge validated against your labels, frozen cases for comparisons, and a release gate with evidence."
        action={
          <Link href="/" className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
            Dashboard →
          </Link>
        }
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">The path — 5 stages, about 30 minutes</h2>
        <ol className="space-y-2">
          <StageCard
            n={1}
            title="Run the agent"
            status={st(0)}
            doThis="Execute cases; each run is saved as a trace."
            learn="What the agent actually does, not what you assume."
            href="/review"
            cta={ran ? "Traces" : "Run a case"}
            detail={ran ? `${o.executions.total} traces` : undefined}
          />
          <StageCard
            n={2}
            title="Review answers"
            status={st(1)}
            doThis={`Label ${minReviews}–${o.review.target_max} traces with the checklist; note what went wrong first.`}
            learn="Which failures are real and how often — your labels become the ground truth."
            href="/review"
            cta="Review"
            detail={`${reviewed}/${minReviews} reviewed`}
          />
          <StageCard
            n={3}
            title="Define what good means"
            status={st(2)}
            doThis="Group notes into failure types; tune the rubric and the judge criterion."
            learn="A taxonomy grounded in evidence, not guesses — and which types deserve a check."
            href="/review/taxonomy"
            cta="Axial coding"
            detail={o.observed_failure_modes ? `${o.observed_failure_modes} failure type${o.observed_failure_modes > 1 ? "s" : ""} seen` : "nothing grouped yet"}
          />
          <StageCard
            n={4}
            title="Check automatically"
            status={st(3)}
            doThis="Code checks for objective rules run on every trace; compare the AI judge with your labels."
            learn="Whether the judge can be trusted (TPR/TNR) — never assume it."
            href="/evaluators"
            cta="Checks"
            detail={judgeN ? `${judgeN} labels compared` : "judge not calibrated"}
          />
          <StageCard
            n={5}
            title="Compare and ship"
            status={st(4)}
            doThis="Run both versions on the same frozen cases; read fixes and regressions; decide at the gate."
            learn="Whether the fix worked without breaking anything — case by case, no averaged score."
            href={compared ? "/release" : "/experiments"}
            cta={compared ? "Release gate" : "Experiments"}
            detail={compared ? `${o.trend.fixed.length} fixed · ${o.trend.regressed.length} broke` : "no comparison yet"}
          />
        </ol>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
          Improve next
          <InfoTip>Computed from your current traces, labels and runs. The order is by impact: blocking problems first, then evidence gaps.</InfoTip>
        </h2>
        {tips.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">Nothing urgent. Keep reviewing new traces as they come in.</p>
        ) : (
          <ul className="space-y-2">
            {tips.map((t) => (
              <Tip key={t.title} {...t} />
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            Onboard your own agent
            <Link href="/agents" className="text-xs font-medium text-sky-700 hover:underline">
              Evaluate your agent →
            </Link>
          </h2>
          <p className="mt-1 text-sm text-slate-600">The method is agent-agnostic. To run it on yours you need five things:</p>
          <ol className="mt-3 space-y-2 text-sm">
            {[
              ["Traces", "Input, the evidence your agent saw, its answer. One JSON record per case.", "trace import (JSONL)", true],
              ["Test cases", "10–30 real inputs to start (grow toward 100) that vary on the dimensions that matter, frozen so comparisons are fair.", "agents/<id>/cases.jsonl", true],
              ["Objective rules", "Policies or thresholds you can check in code — the source of your deterministic checks.", "checks in agent.json, or custom TypeScript", true],
              ["A judge question", "One narrow yes/no question for a subjective failure, written after you've seen real failures.", "judge in agent.json", true],
              ["A way to re-run", "An endpoint so Evalxiety can run a new version on the frozen cases (or import a file each time).", "HTTP adapter", true],
            ].map(([what, why, where, exists]) => (
              <li key={String(what)} className="flex gap-3">
                <span className={cx("mt-0.5 h-5 w-5 shrink-0 rounded-full text-center text-xs leading-5", exists ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{exists ? "✓" : "○"}</span>
                <span>
                  <b className="text-slate-900">{what}</b> — <span className="text-slate-600">{why}</span>{" "}
                  <span className="text-xs text-slate-400">({where}{exists ? "" : " · coming next"})</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            Try the starter kit in{" "}
            <Link href="/agents" className="text-sky-700 hover:underline">
              Your agents
            </Link>{" "}
            (<code>agents/example-support-bot</code>), then copy the blank template <code>agents/_template</code> for your own agent. Guide:{" "}
            <code>docs/use-your-agent.md</code>. Not built yet: a CI command that fails a build on No ship.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Words you&apos;ll meet</h2>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[110px_1fr]">
            {GLOSSARY.map(([term, def]) => (
              <div key={term} className="contents">
                <dt className="font-medium text-slate-800">{term}</dt>
                <dd className="text-slate-600">{def}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
