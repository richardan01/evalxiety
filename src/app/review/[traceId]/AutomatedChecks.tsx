"use client";

import { useState } from "react";
import type { CriterionLabel, JudgeResult, Trace } from "@/lib/domain/schemas";
import {
  Badge,
  Button,
  Callout,
  Card,
  JsonDetails,
  MockBadge,
  OutcomeBadge,
  SeverityBadge,
  fmtDateTime,
  fmtUsd,
} from "@/components/ui";
import { CRITERION_TEXT } from "../_queue/annotationForm";
import type { EvaluationsResponse } from "../_queue/types";

export interface JudgeRunState {
  busy: boolean;
  error: string | null;
  message: string | null;
}

/** Placeholder shown until the reviewer has saved a label. Offers an explicit, non-recorded "reveal anyway". */
export function HiddenChecks({ onRevealAnyway }: { onRevealAnyway: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card title="Automated checks">
      <p className="text-xs text-slate-600">Hidden until you save, so they can&apos;t bias your answers.</p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 text-[11px] text-slate-500 underline decoration-dotted hover:text-slate-700"
        >
          reveal anyway
        </button>
      ) : (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
          <p>Seeing them first tends to pull your answers toward them, which makes your labels useless for checking them.</p>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={onRevealAnyway}>
              Show them anyway
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep hidden
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function AutomatedChecks({
  trace,
  evals,
  error,
  revealedEarly,
  ownLabel,
  judge,
  canRunJudge,
  onRunJudge,
  onRetry,
}: {
  trace: Trace;
  evals: EvaluationsResponse | null;
  error: string | null;
  revealedEarly: boolean;
  ownLabel: CriterionLabel | null;
  judge: JudgeRunState;
  canRunJudge: boolean;
  onRunJudge: () => void;
  onRetry: () => void;
}) {
  return (
    <Card
      title="Automated checks"
      subtitle="Computed from this trace. Compare them with your label — they are evidence to inspect, not gold labels."
    >
      <div className="space-y-4">
        {revealedEarly && (
          <Callout tone="amber" title="Revealed before you saved a label">
            Anchoring risk: try to form your own judgment from the trace, not from these verdicts. Nothing was recorded about this
            reveal.
          </Callout>
        )}
        {error && (
          <Callout tone="red" title="Could not load automated checks">
            {error}{" "}
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
          </Callout>
        )}
        {!evals && !error && <p className="text-xs text-slate-500">Loading automated checks…</p>}

        {evals && (
          <>
            {/* A. Deterministic */}
            <section>
              <h3 className="text-sm font-semibold text-slate-900">A · Deterministic checks ({evals.deterministic.length})</h3>
              <p className="mb-2 text-xs text-slate-500">
                Code recomputes the numbers from the scenario and the policy effective on the decision date; each check answers
                one narrow question with PASS or FAIL. Validated by unit tests. Run on this {trace.execution_mode.toUpperCase()}{" "}
                trace.
              </p>
              <ul className="space-y-2">
                {evals.deterministic.map((r) => {
                  const def = evals.evaluator_definitions.find((d) => d.evaluator_id === r.evaluator_id);
                  return (
                    <li key={r.evaluator_id} className="rounded-md border border-slate-200 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <OutcomeBadge outcome={r.outcome} />
                        <SeverityBadge severity={r.severity} />
                        <MockBadge mode={trace.execution_mode} />
                        <code className="text-xs font-semibold text-slate-700">{r.evaluator_id}</code>
                        <span className="text-[11px] text-slate-400">v{r.evaluator_version}</span>
                      </div>
                      {def && <p className="mt-1 text-xs italic text-slate-500">{def.question}</p>}
                      <p className="mt-1 text-sm text-slate-800">{r.summary}</p>
                      <div className="mt-1.5">
                        <JsonDetails summary="Details — the exact values compared" value={r.details} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* B. Judge */}
            <section className="border-t border-slate-100 pt-3">
              <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">
                B · LLM judge <Badge tone="purple">EXPERIMENTAL</Badge> <Badge>not a gold label</Badge>
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                One criterion only: <i>{evals.judge_question}</i>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Judge FAIL = it found an unsupported material claim (your “Yes”); PASS = none found (your “No”). REQUIRES REVIEW and
                ERROR are never counted as PASS. Current judge version:{" "}
                <code className="text-[11px]">{evals.current_judge_version}</code>
              </p>
              {ownLabel && (
                <p className="mt-1 text-xs text-slate-700">
                  Your reference label for this criterion: <b>{CRITERION_TEXT[ownLabel]}</b>
                </p>
              )}

              {evals.judge_locked ? (
                <div className="mt-2">
                  <Callout tone="slate" title="Locked for held-out traces">
                    {evals.judge_locked.reason}
                  </Callout>
                </div>
              ) : (
                <>
                  <div className="mt-2 space-y-2">
                    {evals.judge_results.length === 0 ? (
                      <p className="rounded border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
                        No judge result for this trace yet. Run the judge below to produce one.
                      </p>
                    ) : (
                      evals.judge_results.map((j, i) => (
                        <JudgeResultView
                          key={j.judge_result_id}
                          result={j}
                          latest={i === 0}
                          current={j.judge_version === evals.current_judge_version}
                        />
                      ))
                    )}
                  </div>
                  <div className="mt-3 rounded-md bg-slate-50 p-2">
                    <Button variant="secondary" onClick={onRunJudge} disabled={judge.busy || !canRunJudge}>
                      {judge.busy ? "Running judge…" : "Run judge on this trace"}
                    </Button>
                    <p className="mt-1 text-[11px] leading-snug text-slate-500">
                      {evals.judge_call.mode === "live" ? (
                        <>
                          <b className="text-slate-700">Spends Claude API credits:</b> one live call, roughly{" "}
                          {fmtUsd(evals.judge_call.estimated_usd, 3)} ($0 if an identical request is cached). One trace only.
                        </>
                      ) : (
                        <>
                          Mock judge for this trace — no API call, no spend. The result is labelled MOCK and is not evidence about the
                          real judge.
                        </>
                      )}{" "}
                      The run is recorded in the audit log under your name.
                    </p>
                    {!canRunJudge && <p className="mt-1 text-[11px] text-rose-700">Enter your reviewer name first.</p>}
                    {judge.error && <p className="mt-1 text-xs font-medium text-rose-700">{judge.error}</p>}
                    {judge.message && <p className="mt-1 text-xs font-medium text-emerald-700">{judge.message}</p>}
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </Card>
  );
}

function JudgeResultView({ result: j, latest, current }: { result: JudgeResult; latest: boolean; current: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <OutcomeBadge outcome={j.verdict} />
        <MockBadge mode={j.execution_mode} />
        {latest && current && <Badge tone="blue">latest</Badge>}
        {!current && (
          <Badge tone="amber" title="Produced by a different judge prompt/model/mode than the current version for this trace; not used in calibration">
            not the current judge version
          </Badge>
        )}
        <span className="text-[11px] text-slate-500">{fmtDateTime(j.created_at)}</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        <code>{j.judge_version}</code> · model <code>{j.model_id}</code>
        {j.served_model_id && j.served_model_id !== j.model_id && <> · served by <code>{j.served_model_id}</code></>}
      </p>
      {j.error && <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{j.error}</p>}
      {j.output && (
        <div className="mt-1.5 space-y-1.5 text-xs text-slate-800">
          <p className="whitespace-pre-wrap text-sm">{j.output.explanation}</p>
          {j.output.uncertainty_reason && (
            <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">
              <b>Uncertainty:</b> {j.output.uncertainty_reason}
            </p>
          )}
          <div>
            <span className="font-medium text-slate-600">Relevant claims:</span>
            {j.output.relevant_claims.length === 0 ? (
              <span className="text-slate-500"> none listed</span>
            ) : (
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {j.output.relevant_claims.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium text-slate-600">Evidence compared:</span>
            {j.output.evidence_ids.length === 0 ? (
              <span className="text-slate-500">none listed</span>
            ) : (
              j.output.evidence_ids.map((id) => (
                <a key={id} href={`#ev-${encodeURIComponent(id)}`} title="Jump to this item in the evidence pack">
                  <Badge tone="blue">{id}</Badge>
                </a>
              ))
            )}
          </div>
        </div>
      )}
      <div className="mt-1.5">
        <JsonDetails summary="Raw judge response" value={j.raw_response ?? "(none)"} />
      </div>
    </div>
  );
}
