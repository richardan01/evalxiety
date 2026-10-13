"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/client/api";
import { MIN_PER_CLASS } from "@/lib/metrics/calibration";
import {
  Badge,
  Callout,
  Card,
  EmptyState,
  KeyValue,
  MockBadge,
  OutcomeBadge,
  Ratio,
  SplitBadge,
  cx,
  fmtDateTime,
} from "@/components/ui";
import { HeldoutReveal } from "./HeldoutReveal";
import { ExperimentalBadge, SectionHeading, Segmented, Steps } from "./parts";
import type { CalibrationResponse, CalibrationUnlocked, Disagreement, HeldoutState, SetAside } from "./types";

type Split = "dev" | "heldout";
type Mode = "live" | "mock";

export function JudgeCalibration() {
  const [split, setSplit] = useState<Split>("dev");
  const [mode, setMode] = useState<Mode>("live");
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
    <section id="calibration" className="space-y-3 scroll-mt-4">
      <SectionHeading step={3} title="Judge calibration — does the judge agree with human reviewers?" phase="Phase 6 · judge calibration">
        Human labels are the reference; the judge&apos;s verdicts on the same traces are compared against them. Whatever these
        numbers say, the judge stays <b>experimental</b> in this build — no threshold marks it &ldquo;reliable&rdquo;.
      </SectionHeading>

      <Card title="How these numbers are produced">
        <Steps
          items={[
            <>A named human reviewer opens a trace in <Link className="text-sky-700 hover:underline" href="/review">Trace Review</Link> and labels the criterion &ldquo;unsupported pricing justification&rdquo; as <b>present</b>, <b>absent</b> or <b>not assessed</b>.</>,
            <>The annotation is promoted to the <b>gold set</b> — only human labels on frozen synthetic cases, with reviewer and timestamp. Judge output never becomes gold.</>,
            <>The experimental judge is run on the same trace. Only results from the <b>current judge version</b> count.</>,
            <>Each gold label is paired with the judge&apos;s latest verdict. <b>REQUIRES REVIEW</b> and <b>ERROR</b> verdicts are set aside — never counted as PASS.</>,
            <>The remaining pairs fill the confusion matrix (positive class = an actual failure). TPR and TNR are reported separately, each with a Wilson 95% interval and its n.</>,
          ]}
        />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented<Split>
            label="Split"
            value={split}
            onChange={setSplit}
            options={[
              { value: "dev", label: "Dev — iterate here", hint: "Use dev results to improve the judge prompt" },
              { value: "heldout", label: "Held-out — final check only", hint: "Locked until an audited reveal" },
            ]}
          />
          <Segmented<Mode>
            label="Execution mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "live", label: "LIVE", hint: "Real Claude agent traces judged by the real Claude judge" },
              { value: "mock", label: "MOCK — demonstrates the math only", hint: "Mock agent + heuristic mock judge" },
            ]}
          />
        </div>
      </Card>

      {mode === "mock" && (
        <Callout tone="amber" title="MOCK — demonstrates the math only">
          These pairs come from mock-agent traces judged by a keyword heuristic, not by Claude. The numbers show how the
          calculation works; they say nothing about how well the real judge agrees with human reviewers.
        </Callout>
      )}

      {data && data.heldout.revealed && <RevealedBanner state={data.heldout} />}

      {!current ? (
        <p className="text-sm text-slate-500">Loading calibration…</p>
      ) : current.error ? (
        <Callout tone="red" title="Could not load calibration">{current.error}</Callout>
      ) : data?.locked ? (
        <HeldoutReveal onRevealed={() => setNonce((n) => n + 1)} />
      ) : data ? (
        <CalibrationBody view={data} />
      ) : null}

      <Limitations />
    </section>
  );
}

function RevealedBanner({ state }: { state: HeldoutState }) {
  return (
    <Callout tone="red" title="Held-out split has been revealed — do not tune prompts now">
      Revealed by <b>{state.revealed_by ?? "unknown"}</b>
      {state.revealed_at ? <> on {fmtDateTime(state.revealed_at)}</> : null}
      {state.reason ? <> · reason: &ldquo;{state.reason}&rdquo;</> : null}. Changing the judge or agent prompts after seeing
      held-out results invalidates them; a change now needs a new, untouched held-out set.
    </Callout>
  );
}

export function CalibrationBody({ view }: { view: CalibrationUnlocked }) {
  const { report } = view;
  const m = report.matrix;
  const fn = view.disagreements.filter((d) => d.human_failure && d.judge_verdict === "PASS");
  const fp = view.disagreements.filter((d) => !d.human_failure && d.judge_verdict === "FAIL");

  return (
    <div className="space-y-3">
      <div className={cx("rounded-lg border-2 px-5 py-4", report.insufficient ? "border-amber-300 bg-amber-50" : "border-violet-300 bg-violet-50")}>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
          Judge status · <SplitBadge split={view.split} /> <MockBadge mode={view.mode} /> <ExperimentalBadge />
        </div>
        <p className="mt-1 text-xl font-semibold text-slate-900">{report.status_label}</p>
        <p className="mt-1 max-w-4xl text-sm text-slate-700">
          {report.insufficient
            ? `At least one class has fewer than ${MIN_PER_CLASS} human-labelled examples in the comparison (${m.positives} failure, ${m.negatives} pass). ${MIN_PER_CLASS} per class is a sample-size reporting convention from the evals guidance — not a reliability threshold.`
            : "Both classes reach the sample-size reporting convention, but this is still a small synthetic set: the judge remains experimental and every finding still needs human review."}
        </p>
        <div className="mt-3">
          <KeyValue
            rows={[
              ["Judge version (this mode)", <code key="v" className="font-mono text-xs">{view.judge_version}</code>],
              [
                "Versions with stored results",
                view.judge_versions_present.length ? (
                  <span key="p" className="text-xs">
                    {view.judge_versions_present.map((v) => (
                      <code key={v} className="mr-2 font-mono">{v}</code>
                    ))}
                    <span className="text-slate-500">(latest result per trace, all traces and modes)</span>
                  </span>
                ) : (
                  <span key="p" className="text-slate-500">none yet — the judge has not been run on any trace</span>
                ),
              ],
            ]}
          />
        </div>
      </div>

      <Card
        title="Where the labelled examples go"
        subtitle="Every number is a count of gold examples for this split and mode. Exclusions are shown, not hidden."
        actions={<MockBadge mode={view.mode} />}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-1 font-medium">Step</th>
              <th className="w-20 text-right font-medium">Count</th>
              <th className="pl-4 font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            <FunnelRow label="Gold examples in this split and mode" n={view.gold_in_scope}>
              Human annotations promoted to gold, on {view.split === "dev" ? "dev" : "held-out"} cases executed in {view.mode.toUpperCase()} mode.
            </FunnelRow>
            <FunnelRow label="− Gold not assessed for this criterion" n={view.not_assessed} sub>
              The reviewer marked &ldquo;unsupported justification&rdquo; as not assessed. Excluded.
            </FunnelRow>
            <FunnelRow label="= Reviewed labelled examples" n={view.labelled_examples} strong>
              Gold examples labelled failure present / absent for this criterion.
            </FunnelRow>
            <FunnelRow label="− Labelled gold not yet judged" n={view.not_judged_trace_ids.length} sub tone={view.not_judged_trace_ids.length ? "amber" : undefined}>
              No judge result under the current judge version yet — see the list below.
            </FunnelRow>
            <FunnelRow label="− Judge said REQUIRES REVIEW" n={m.excluded_requires_review} sub tone={m.excluded_requires_review ? "amber" : undefined}>
              The judge was inconclusive. Excluded from the matrix and never counted as PASS.
            </FunnelRow>
            <FunnelRow label="− Judge ERROR" n={m.excluded_error} sub tone={m.excluded_error ? "amber" : undefined}>
              The judge call failed or returned invalid output. Excluded.
            </FunnelRow>
            <FunnelRow label="= Compared in the confusion matrix" n={m.n} strong>
              Human label paired with a binary judge verdict (PASS or FAIL).
            </FunnelRow>
            <FunnelRow label="Positives — human: failure present" n={m.positives} sub>
              Unsupported claim confirmed by the human. Denominator of TPR.
            </FunnelRow>
            <FunnelRow label="Negatives — human: no failure (pass)" n={m.negatives} sub>
              Human found every material claim supported. Denominator of TNR.
            </FunnelRow>
          </tbody>
        </table>
        <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <span className="font-semibold tabular-nums">{view.reviewed_not_promoted}</span>{" "}
          <span className="text-slate-700">reviewed annotation(s) with a present/absent label are not yet promoted to gold.</span>{" "}
          <span className="text-xs text-slate-500">
            Counted across all splits and modes, including custom cases that cannot become gold. Promoting eligible ones adds
            calibration data.
          </span>
        </div>
      </Card>

      {view.not_judged_trace_ids.length > 0 && (
        <Callout tone="amber" title={`${view.not_judged_trace_ids.length} labelled gold example(s) have no judge result yet`}>
          <p>
            Run the experimental judge on these traces to include them (POST <code className="font-mono text-xs">/api/judge</code> for one
            trace, or POST <code className="font-mono text-xs">/api/experiments/[id]/judge</code> to judge every trace of a run that lacks a
            current-version result).
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {view.not_judged_trace_ids.map((id) => (
              <Link key={id} href={`/review/${id}`} className="font-mono text-xs text-sky-700 hover:underline">
                {id}
              </Link>
            ))}
          </div>
        </Callout>
      )}

      {m.n === 0 ? (
        <EmptyState title={`No human-labelled examples with a binary judge verdict for ${view.split === "dev" ? "dev" : "held-out"} · ${view.mode.toUpperCase()}`}>
          <div className="mx-auto max-w-xl space-y-1 text-left">
            <p>The confusion matrix, TPR and TNR need human labels paired with judge verdicts. To produce them:</p>
            <Steps
              items={[
                <>Review traces in <Link className="text-sky-700 hover:underline" href="/review">Trace Review</Link> and set the unsupported-justification label (present / absent).</>,
                "Promote those annotations to gold.",
                "Run the experimental judge on the same traces.",
              ]}
            />
            {view.mode === "live" && <p className="pt-1 text-xs">If you have only run in mock mode so far, switch to MOCK to see the math demonstrated.</p>}
            {report.undefined_reasons.length > 0 && (
              <ul className="list-disc pl-5 pt-1 text-xs">
                {report.undefined_reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card
              title="Confusion matrix"
              subtitle="Positive class = an actual failure (unsupported claim present). Rows: human reference. Columns: judge."
              actions={<MockBadge mode={view.mode} />}
            >
              <ConfusionMatrix tp={m.tp} fn={m.fn} fp={m.fp} tn={m.tn} />
            </Card>
            <div className="space-y-3">
              <RateBox
                title="True positive rate"
                abbr="TPR"
                mode={view.mode}
                value={report.tpr}
                num={m.tp}
                den={m.positives}
                ci={report.tpr_ci}
                undefinedReason={report.undefined_reasons.find((r) => r.startsWith("TPR"))}
              >
                Of the traces a human marked as failing, the share the judge also flagged FAIL (TP ÷ (TP + FN)).
              </RateBox>
              <RateBox
                title="True negative rate"
                abbr="TNR"
                mode={view.mode}
                value={report.tnr}
                num={m.tn}
                den={m.negatives}
                ci={report.tnr_ci}
                undefinedReason={report.undefined_reasons.find((r) => r.startsWith("TNR"))}
              >
                Of the traces a human marked as passing, the share the judge also passed (TN ÷ (TN + FP)).
              </RateBox>
            </div>
          </div>
          {report.undefined_reasons.length > 0 && (
            <Callout tone="slate" title="Why some ratios are undefined">
              <ul className="list-disc pl-5">
                {report.undefined_reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Undefined is not 0% or 100% — there is nothing to divide by.</p>
            </Callout>
          )}
          <p className="text-xs text-slate-500">
            No accuracy, kappa or single combined score is reported: with imbalanced classes they hide missed failures. TPR and
            TNR are read separately, together with their intervals.
          </p>

          <Card
            title={`Disagreements to read by hand (${view.disagreements.length})`}
            subtitle="Read each one before changing the judge prompt: a missed failure suggests tightening the FAIL definition; a false alarm suggests clarifying what PASS allows."
          >
            {view.disagreements.length === 0 ? (
              <p className="text-sm text-slate-600">
                No disagreements among the {m.n} compared pair(s). With a sample this small that is weak evidence, not proof of agreement.
              </p>
            ) : (
              <div className="space-y-4">
                <DisagreementGroup
                  title={`False negatives — judge missed a human-confirmed failure (FN = ${fn.length})`}
                  items={fn}
                  kind="FN"
                />
                <DisagreementGroup
                  title={`False positives — judge flagged a failure the human did not find (FP = ${fp.length})`}
                  items={fp}
                  kind="FP"
                />
              </div>
            )}
          </Card>
        </>
      )}

      {view.requires_review.length > 0 && (
        <Card
          title={`Set aside: judge inconclusive or errored (${view.requires_review.length})`}
          subtitle="Excluded from the matrix. These are not passes — a human should look at each."
        >
          <ul className="space-y-2">
            {view.requires_review.map((p) => (
              <SetAsideItem key={p.trace_id} item={p} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function FunnelRow({ label, n, children, sub, strong, tone }: { label: string; n: number; children: ReactNode; sub?: boolean; strong?: boolean; tone?: "amber" }) {
  return (
    <tr className={cx("border-b border-slate-100 align-top", strong && "bg-slate-50")}>
      <td className={cx("py-1.5", sub && "pl-4 text-slate-600", strong && "font-semibold text-slate-900")}>{label}</td>
      <td className={cx("text-right font-semibold tabular-nums", tone === "amber" ? "text-amber-700" : "text-slate-900")}>{n}</td>
      <td className="pl-4 text-xs text-slate-500">{children}</td>
    </tr>
  );
}

function ConfusionMatrix({ tp, fn, fp, tn }: { tp: number; fn: number; fp: number; tn: number }) {
  return (
    <div className="grid grid-cols-[auto_auto_1fr_1fr] gap-1.5 text-sm">
      <div />
      <div />
      <div className="col-span-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">Judge</div>

      <div />
      <div />
      <div className="text-center text-xs font-medium text-slate-700">FAIL — failure detected</div>
      <div className="text-center text-xs font-medium text-slate-700">PASS — no failure detected</div>

      <div className="row-span-2 flex items-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 [writing-mode:vertical-rl] rotate-180">
          Human (reference)
        </span>
      </div>
      <div className="flex items-center pr-2 text-right text-xs font-medium text-slate-700">
        Failure present
        <br />
        (positive)
      </div>
      <MatrixCell abbr="TP" n={tp} good meaning="Judge caught a real failure" />
      <MatrixCell abbr="FN" n={fn} meaning="Judge missed a real failure" />

      <div className="flex items-center pr-2 text-right text-xs font-medium text-slate-700">
        No failure
        <br />
        (negative)
      </div>
      <MatrixCell abbr="FP" n={fp} meaning="Judge raised a false alarm" />
      <MatrixCell abbr="TN" n={tn} good meaning="Judge correctly passed" />
    </div>
  );
}

function MatrixCell({ abbr, n, good, meaning }: { abbr: string; n: number; good?: boolean; meaning: string }) {
  return (
    <div
      className={cx(
        "rounded-md border px-3 py-3 text-center",
        good ? "border-emerald-200 bg-emerald-50" : n > 0 ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50",
      )}
    >
      <div className="text-xs font-semibold text-slate-500">{abbr}</div>
      <div className="text-3xl font-semibold tabular-nums text-slate-900">{n}</div>
      <div className="text-[11px] text-slate-600">{meaning}</div>
    </div>
  );
}

function RateBox({ title, abbr, mode, value, num, den, ci, undefinedReason, children }: {
  title: string;
  abbr: string;
  mode: Mode;
  value: number | null;
  num: number;
  den: number;
  ci: { low: number; high: number } | null;
  undefinedReason?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
        <span>
          {title} ({abbr})
        </span>
        <MockBadge mode={mode} />
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold">
          <Ratio value={value} undefinedReason={undefinedReason} />
        </span>
        <span className="text-sm text-slate-700">
          n = <b className="tabular-nums">{num}/{den}</b>
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-700">
        Wilson 95% interval:{" "}
        {ci ? (
          <b>
            <Ratio value={ci.low} /> – <Ratio value={ci.high} />
          </b>
        ) : (
          <span className="text-slate-500">undefined (n = 0)</span>
        )}
      </div>
      {undefinedReason && value === null && <p className="mt-1 text-xs text-slate-500">{undefinedReason}</p>}
      <p className="mt-1 text-xs text-slate-500">{children}</p>
    </div>
  );
}

function DisagreementGroup({ title, items, kind }: { title: string; items: Disagreement[]; kind: "FN" | "FP" }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">None.</p>
      ) : (
        items.map((d) => <DisagreementCard key={d.trace_id} d={d} kind={kind} />)
      )}
    </div>
  );
}

function DisagreementCard({ d, kind }: { d: Disagreement; kind: "FN" | "FP" }) {
  const gold = d.gold;
  const judge = d.judge;
  const out = judge?.output ?? null;
  return (
    <article className="rounded-lg border border-slate-200">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <Badge tone="red">{kind}</Badge>
        <span>
          case <b className="text-slate-800">{d.case_id}</b>
        </span>
        <SplitBadge split={gold?.dataset_split ?? null} />
        {gold && <MockBadge mode={gold.trace_execution_mode} />}
        <code className="font-mono">{d.trace_id}</code>
        <Link href={`/review/${d.trace_id}`} className="ml-auto font-medium text-sky-700 hover:underline">
          Open trace in review →
        </Link>
      </header>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="space-y-1.5 px-3 py-2 text-sm md:border-r md:border-slate-100">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Human reviewer (reference)</div>
          {gold ? (
            <>
              <p className="text-xs text-slate-600">
                <b className="text-slate-800">{gold.reviewer}</b> · reviewed {fmtDateTime(gold.review_timestamp)} · label v{gold.label_version}
              </p>
              <p>
                Unsupported justification:{" "}
                <Badge tone={gold.unsupported_justification_label === "present" ? "red" : "green"}>
                  {gold.unsupported_justification_label === "present" ? "failure present" : "absent (pass)"}
                </Badge>{" "}
                <span className="text-xs text-slate-500">overall task: {gold.human_label}</span>
              </p>
              <div>
                <div className="text-xs font-medium text-slate-500">First failure / notes</div>
                {gold.supporting_evidence.trim() ? (
                  <p className="whitespace-pre-wrap text-slate-800">{gold.supporting_evidence}</p>
                ) : (
                  <p className="text-xs text-slate-500">The reviewer left no notes.</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">Gold record not found.</p>
          )}
        </div>
        <div className="space-y-1.5 bg-violet-50/30 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Judge <ExperimentalBadge /> <span className="normal-case">not gold</span>
          </div>
          {judge ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <OutcomeBadge outcome={judge.verdict} /> <MockBadge mode={judge.execution_mode} />
                <code className="font-mono">{judge.judge_version}</code>
              </p>
              {out ? (
                <>
                  <div>
                    <div className="text-xs font-medium text-slate-500">Explanation</div>
                    <p className="text-slate-800">{out.explanation}</p>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-500">Relevant claims</div>
                    {out.relevant_claims.length ? (
                      <ul className="list-disc space-y-0.5 pl-5 text-slate-800">
                        {out.relevant_claims.map((c, i) => (
                          <li key={i}>“{c}”</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">none listed</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs font-medium text-slate-500">Evidence IDs:</span>
                    {out.evidence_ids.length ? (
                      out.evidence_ids.map((id) => (
                        <code key={id} className="rounded bg-white px-1 font-mono text-xs ring-1 ring-slate-200">
                          {id}
                        </code>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">none listed</span>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-rose-700">{judge.error ?? "No judge output stored."}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">Judge result not found.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function SetAsideItem({ item }: { item: SetAside }) {
  const j = item.judge;
  return (
    <li className="flex flex-wrap items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
      <OutcomeBadge outcome={item.judge_verdict} />
      {j && <MockBadge mode={j.execution_mode} />}
      <span className="text-xs text-slate-600">
        case <b className="text-slate-800">{item.case_id}</b> · human label: {item.human_failure ? "failure present" : "absent (pass)"}
      </span>
      <Link href={`/review/${item.trace_id}`} className="font-mono text-xs text-sky-700 hover:underline">
        {item.trace_id}
      </Link>
      <span className="basis-full text-xs text-slate-700">
        {j?.output?.uncertainty_reason
          ? <>Why the judge could not decide: {j.output.uncertainty_reason}</>
          : j?.error
            ? <>Error: {j.error}</>
            : "No reason recorded."}
      </span>
    </li>
  );
}

function Limitations() {
  return (
    <Callout tone="slate" title="Evaluation limitations — read before quoting any number above">
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b>Tiny synthetic sample.</b> Gold examples come from a small set of synthetic merchant scenarios reviewed by hand. These
          numbers describe a prototype set and cannot establish production reliability.
        </li>
        <li>
          <b>Wide intervals.</b> With n this small, one disagreement moves TPR or TNR by many points. Read the Wilson interval, not
          the point estimate.
        </li>
        <li>
          <b>No few-shot examples.</b> There is no separate training split, so the judge prompt carries no examples — using dev or
          held-out examples would leak into calibration.
        </li>
        <li>
          <b>Held-out is reserved for the final check.</b> Iterate on dev only; reveal held-out once, after the judge prompt is
          frozen, and do not tune afterwards.
        </li>
        <li>
          <b>No automated prompt optimisation.</b> Disagreements are read by a person; the prompt is never tuned automatically
          against these labels.
        </li>
        <li>
          <b>Never a release gate on its own.</b> The judge is experimental; its FAIL, REQUIRES REVIEW and ERROR findings require
          human review before they count for anything. No reliability threshold is set in this build.
        </li>
      </ul>
    </Callout>
  );
}
