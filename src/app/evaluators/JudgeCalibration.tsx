"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/client/api";
import { MIN_PER_CLASS } from "@/lib/metrics/calibration";
import { Badge, InfoTip, MockBadge, Ratio, SplitBadge, cx, fmtDateTime } from "@/components/ui";
import { HeldoutReveal } from "./HeldoutReveal";
import { ExperimentalBadge, InfoTipLeft, SectionTitle, Segmented } from "./parts";
import type { CalibrationResponse, CalibrationUnlocked, Disagreement, HeldoutState } from "./types";

export type Split = "dev" | "heldout";
export type Mode = "live" | "mock";

const MAX_DISAGREEMENTS = 5;

/** Section B — does the experimental judge agree with human labels? Anchor: /evaluators#calibration. */
export function JudgeCalibration({ initialSplit = "dev", initialMode = "live" }: { initialSplit?: Split; initialMode?: Mode }) {
  const [split, setSplit] = useState<Split>(initialSplit);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; data: CalibrationResponse | null; error: string | null } | null>(null);
  const key = `${split}|${mode}|${nonce}`;

  useEffect(() => {
    let alive = true;
    getJSON<CalibrationResponse>(`/api/calibration?split=${split}&mode=${mode}`)
      .then((data) => {
        if (alive) setResult({ key, data, error: null });
      })
      .catch((e: unknown) => {
        if (alive) setResult({ key, data: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [key, split, mode]);

  const current = result?.key === key ? result : null;
  const data = current?.data ?? null;

  return (
    <section id="calibration" className="scroll-mt-4 space-y-3">
      <SectionTitle
        title="Can we trust the AI judge?"
        infoLabel="Limitations"
        info={<Limitations />}
        right={
          <>
            <Segmented<Split>
              label="Split"
              value={split}
              onChange={setSplit}
              options={[
                { value: "dev", label: "Dev", hint: "Iterate on the judge prompt here" },
                { value: "heldout", label: "Held-out", hint: "Final check only — locked until an audited reveal" },
              ]}
            />
            <Segmented<Mode>
              label="Mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "live", label: "Live", hint: "Real Claude traces judged by the real Claude judge" },
                { value: "mock", label: "Mock", hint: "Mock agent + heuristic mock judge — demonstrates the math only" },
              ]}
            />
          </>
        }
      />

      <div className="space-y-4 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm">
        {data && data.heldout.revealed && <RevealedLine state={data.heldout} />}
        {!current ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : current.error ? (
          <p className="text-sm text-rose-700">Could not load calibration: {current.error}</p>
        ) : data?.locked ? (
          <HeldoutReveal onRevealed={() => setNonce((n) => n + 1)} />
        ) : data ? (
          <CalibrationBody view={data} />
        ) : null}
      </div>
    </section>
  );
}

function RevealedLine({ state }: { state: HeldoutState }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-rose-800">
      <Badge tone="red">HELD-OUT REVEALED</Badge>
      <span>
        by <b>{state.revealed_by ?? "unknown"}</b>
        {state.revealed_at ? <> · {fmtDateTime(state.revealed_at)}</> : null} — don&apos;t tune prompts now
      </span>
      <InfoTip label="About the reveal">
        {state.reason ? <>Reason: &ldquo;{state.reason}&rdquo;. </> : null}
        Changing the judge or agent prompts after seeing held-out results invalidates them; a change now needs a new,
        untouched held-out set.
      </InfoTip>
    </div>
  );
}

export function CalibrationBody({ view }: { view: CalibrationUnlocked }) {
  const { report } = view;
  const m = report.matrix;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <ExperimentalBadge />
          <span className="text-lg font-semibold text-slate-900">{report.status_label}</span>
          <SplitBadge split={view.split} />
          <MockBadge mode={view.mode} />
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600" title="Model the judge runs on (set in Rubric)">
            {view.judge_model}
          </span>
          {view.split === "heldout" && view.judge_changed_after_reveal && (
            <span
              className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-inset ring-amber-300"
              title="The judge criterion or model was changed after the held-out reveal"
            >
              judge changed after reveal — not a clean final check
            </span>
          )}
          <InfoTipLeft label="What this status means">
            {report.insufficient ? (
              <>
                Needs at least {MIN_PER_CLASS} human-labelled examples per class (now {m.positives} problem, {m.negatives}{" "}
                fine). That is a sample-size convention, not a reliability bar.
              </>
            ) : (
              <>Both classes reach the sample-size convention, but this is still a small synthetic set: the judge stays experimental.</>
            )}{" "}
            Only results from judge version <code className="font-mono">{view.judge_version}</code> count.
          </InfoTipLeft>
        </div>
        {view.mode === "mock" && (
          <div className="text-xs text-amber-800">Mock judge — shows how the math works, not how well Claude agrees with you.</div>
        )}
      </div>

      {view.labelled_examples === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-6 py-8 text-center">
          <div className="text-sm font-medium text-slate-700">
            Label a few traces in{" "}
            <Link href="/review" className="text-sky-700 hover:underline">
              Trace Review
            </Link>{" "}
            — then this shows how often the judge agrees with you.
          </div>
          {view.reviewed_not_promoted > 0 && (
            <div className="mt-1 text-xs text-slate-500">
              {view.reviewed_not_promoted} label{view.reviewed_not_promoted === 1 ? " isn't" : "s aren't"} in the gold set yet —{" "}
              <Link href="/review/gold" className="text-sky-700 hover:underline">
                promote {view.reviewed_not_promoted === 1 ? "it" : "them"}
              </Link>
              .
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <ConfusionMatrix tp={m.tp} fn={m.fn} fp={m.fp} tn={m.tn} />
            <Coverage view={view} />
          </div>
          <div className="space-y-3">
            <RateRow
              label="Catches real problems"
              abbr="TPR"
              formula="TP ÷ (TP + FN)"
              num={m.tp}
              den={m.positives}
              value={report.tpr}
              ci={report.tpr_ci}
              undefinedReason={report.undefined_reasons.find((r) => r.startsWith("TPR"))}
            />
            <RateRow
              label="Avoids false alarms"
              abbr="TNR"
              formula="TN ÷ (TN + FP)"
              num={m.tn}
              den={m.negatives}
              value={report.tnr}
              ci={report.tnr_ci}
              undefinedReason={report.undefined_reasons.find((r) => r.startsWith("TNR"))}
            />
            <Disagreements items={view.disagreements} compared={m.n} />
          </div>
        </div>
      )}
    </div>
  );
}

function ConfusionMatrix({ tp, fn, fp, tn }: { tp: number; fn: number; fp: number; tn: number }) {
  const axis = "text-[11px] font-semibold uppercase tracking-wide text-slate-500";
  const side = "flex items-center justify-end pr-1 text-xs font-medium text-slate-700";
  return (
    <div className="grid grid-cols-[auto_auto_1fr_1fr] gap-1.5">
      <div />
      <div />
      <div className={cx("col-span-2 text-center", axis)}>Judge said</div>

      <div />
      <div />
      <div className="text-center text-xs font-medium text-slate-700">Problem</div>
      <div className="text-center text-xs font-medium text-slate-700">Fine</div>

      <div className={cx("row-span-2 flex items-center pr-1", axis)}>You said</div>
      <div className={side}>Problem</div>
      <MatrixCell n={tp} caption="Both found a problem" abbr="TP" agree />
      <MatrixCell n={fn} caption="Judge missed it" abbr="FN" />

      <div className={side}>Fine</div>
      <MatrixCell n={fp} caption="False alarm" abbr="FP" />
      <MatrixCell n={tn} caption="Both said fine" abbr="TN" agree />
    </div>
  );
}

function MatrixCell({ n, caption, abbr, agree }: { n: number; caption: string; abbr: string; agree?: boolean }) {
  return (
    <div
      className={cx(
        "rounded-md border px-3 py-2.5 text-center",
        agree ? "border-emerald-200 bg-emerald-50" : n > 0 ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50",
      )}
    >
      <div className="text-2xl font-semibold tabular-nums text-slate-900">{n}</div>
      <div className="text-xs font-medium text-slate-700">{caption}</div>
      <div className="text-[10px] font-semibold text-slate-400">{abbr}</div>
    </div>
  );
}

function Coverage({ view }: { view: CalibrationUnlocked }) {
  const m = view.report.matrix;
  const notJudged = view.not_judged_trace_ids.length;
  const setAside = m.excluded_requires_review + m.excluded_error;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      <span>
        Compared <b className="text-slate-800">{m.n}</b> of {view.labelled_examples} labelled trace{view.labelled_examples === 1 ? "" : "s"}
      </span>
      {notJudged > 0 && <span className="text-amber-700">· {notJudged} not judged yet</span>}
      {setAside > 0 && <span className="text-amber-700">· {setAside} set aside</span>}
      <InfoTip label="Where the numbers come from">
        <ul className="space-y-0.5">
          <li>
            Gold labels in this split + mode: <b>{view.gold_in_scope}</b>
          </li>
          <li>− not assessed for this criterion: {view.not_assessed}</li>
          <li>− no judge result yet (current version): {notJudged}</li>
          <li>− judge unsure (REQUIRES REVIEW, never PASS): {m.excluded_requires_review}</li>
          <li>− judge ERROR: {m.excluded_error}</li>
          <li>
            = compared: <b>{m.n}</b> ({m.positives} problem, {m.negatives} fine)
          </li>
        </ul>
        {view.reviewed_not_promoted > 0 && (
          <p className="mt-1.5">
            {view.reviewed_not_promoted} reviewed label(s) not yet in the gold set —{" "}
            <Link href="/review/gold" className="text-sky-700 hover:underline">
              promote
            </Link>
            .
          </p>
        )}
        <TraceLinks title="Needs a judge run" ids={view.not_judged_trace_ids} />
        <TraceLinks title="Set aside — needs a human look" ids={view.requires_review.map((p) => p.trace_id)} />
      </InfoTip>
    </div>
  );
}

function TraceLinks({ title, ids }: { title: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="mt-1.5">
      <div className="font-medium text-slate-600">{title}</div>
      <div className="flex flex-wrap gap-x-2">
        {ids.map((id) => (
          <Link key={id} href={`/review/${id}`} className="font-mono text-[11px] text-sky-700 hover:underline">
            {id}
          </Link>
        ))}
      </div>
    </div>
  );
}

function RateRow({ label, abbr, formula, num, den, value, ci, undefinedReason }: {
  label: string;
  abbr: string;
  formula: string;
  num: number;
  den: number;
  value: number | null;
  ci: { low: number; high: number } | null;
  undefinedReason?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
      <span className="text-sm text-slate-700">
        {label}: <b className="tabular-nums text-slate-900">{num}/{den}</b>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-xl font-semibold">
          <Ratio value={value} undefinedReason={undefinedReason} />
        </span>
        <InfoTipLeft label={`About ${abbr}`}>
          <b>{abbr}</b> = {formula}, n = {den}.
          <br />
          Wilson 95% interval:{" "}
          {ci ? (
            <b>
              <Ratio value={ci.low} /> – <Ratio value={ci.high} />
            </b>
          ) : (
            <span className="text-slate-500">undefined (n = 0)</span>
          )}
          {value === null && undefinedReason && <span className="mt-1 block text-slate-500">{undefinedReason}. Undefined is not 0% or 100%.</span>}
        </InfoTipLeft>
      </span>
    </div>
  );
}

function Disagreements({ items, compared }: { items: Disagreement[]; compared: number }) {
  const head = items.slice(0, MAX_DISAGREEMENTS);
  const rest = items.slice(MAX_DISAGREEMENTS);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
        Where you and the judge disagree ({items.length})
        <InfoTip label="How to use disagreements">
          Read each before changing the judge prompt: a miss suggests tightening what counts as a problem; a false alarm
          suggests clarifying what &ldquo;fine&rdquo; allows.
        </InfoTip>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-slate-500">
          {compared === 0 ? "Nothing compared yet." : `None in ${compared} compared — a small sample, so weak evidence.`}
        </div>
      ) : (
        <>
          <DisagreementList items={head} />
          {rest.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-sky-700">Show {rest.length} more</summary>
              <DisagreementList items={rest} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

function DisagreementList({ items }: { items: Disagreement[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {items.map((d) => {
        const missed = d.human_failure;
        const note: ReactNode = missed
          ? d.gold?.supporting_evidence.trim()
            ? `You: ${d.gold.supporting_evidence.trim()}`
            : null
          : d.judge?.output?.explanation
            ? `Judge: ${d.judge.output.explanation}`
            : null;
        return (
          <li key={d.trace_id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
            <Badge tone="red">{missed ? "Judge missed it" : "False alarm"}</Badge>
            <span className="shrink-0 font-medium text-slate-800">{d.case_id}</span>
            {d.gold && <MockBadge mode={d.gold.trace_execution_mode} />}
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={typeof note === "string" ? note : undefined}>
              {note}
            </span>
            <Link href={`/review/${d.trace_id}`} className="shrink-0 text-xs font-medium text-sky-700 hover:underline">
              Open →
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Limitations() {
  return (
    <ul className="list-disc space-y-1 pl-4">
      <li>
        <b>Tiny synthetic sample</b> — describes a prototype set; it cannot establish production reliability.
      </li>
      <li>
        <b>Wide intervals</b> — one disagreement moves TPR/TNR a lot; read the Wilson interval, not the point estimate.
      </li>
      <li>
        <b>No few-shot examples</b> — using dev or held-out examples in the prompt would leak into calibration.
      </li>
      <li>
        <b>Held-out is for one final check</b> after the judge prompt is frozen; never tune afterwards.
      </li>
      <li>
        <b>No automated prompt tuning</b> against these labels; disagreements are read by a person.
      </li>
      <li>
        <b>No accuracy or kappa</b> — with imbalanced classes they hide missed problems.
      </li>
      <li>
        <b>Never a release gate on its own</b> — no reliability threshold is set; every judge finding needs human review.
      </li>
    </ul>
  );
}
