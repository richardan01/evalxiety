/**
 * Presentational sections of the Release Gate tab. Everything shown is taken
 * from GET /api/release (the gate, run summaries and per-case evaluations) —
 * nothing is computed or estimated here beyond grouping and labelling.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Callout, MockBadge, OutcomeBadge, Ratio, SeverityBadge, Stat, cx, fmtDateTime } from "@/components/ui";
import type { GateCheck } from "@/lib/release/gate";
import {
  APPROVAL_STATE_HELP,
  APPROVAL_STATE_LABEL,
  DEMO_DISCLAIMER,
  LEVEL_META,
  STATUS_META,
  groupReasons,
  recommendationFromReasons,
  shortHash,
} from "./status";
import type { ReleaseRunRow, ReleaseView } from "./types";

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

export function StepHeading({ n, title, help, aside }: { n: number; title: string; help?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{n}</span>
        {title}
        {aside}
      </h2>
      {help && <p className="mt-1 max-w-3xl pl-8 text-sm text-slate-500">{help}</p>}
    </div>
  );
}

export function traceIndex(view: ReleaseView): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of view.candidate_evals) if (e.trace_id) m.set(e.case_id, e.trace_id);
  return m;
}

export function CaseChips({ caseIds, traceByCase }: { caseIds: string[]; traceByCase: Map<string, string> }) {
  if (caseIds.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {caseIds.map((id) => {
        const traceId = traceByCase.get(id);
        return traceId ? (
          <Link
            key={id}
            href={`/review/${traceId}`}
            title={`Open the candidate trace ${traceId} for ${id}`}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-sky-700 hover:border-sky-400 hover:underline"
          >
            {id} →
          </Link>
        ) : (
          <span
            key={id}
            title="The candidate run has no trace for this case"
            className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 font-mono text-[11px] text-slate-500"
          >
            {id} (no trace)
          </span>
        );
      })}
    </div>
  );
}

const roleOf = (configId: string) => (configId.includes("baseline") ? "baseline" : configId.includes("corrected") ? "corrected" : configId);

// ---------------------------------------------------------------------------
// (a) Status banner
// ---------------------------------------------------------------------------

export function StatusBanner({ view }: { view: ReleaseView }) {
  const { gate } = view;
  const meta = STATUS_META[gate.status];
  const evalMeta = STATUS_META[gate.evaluation_status];
  return (
    <section className={cx("rounded-lg border-2 px-5 py-4", meta.banner)} aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cx("rounded-md px-3 py-1 text-lg font-bold tracking-wide", meta.pill)}>{meta.label}</span>
        {view.candidate_run && <MockBadge mode={view.candidate_run.execution_mode} />}
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">Release gate status</span>
      </div>
      <p className="mt-2 text-sm font-medium">{meta.explanation}</p>
      <p className="mt-1 text-sm">
        Evaluation status: <b>{evalMeta.label}</b> · Human approval: <b>{APPROVAL_STATE_LABEL[gate.approval_state]}</b>
        <span className="opacity-80"> — {APPROVAL_STATE_HELP[gate.approval_state]}</span>
      </p>
      <p className="mt-1 text-xs opacity-80">
        Evaluation (automated checks on the evidence) and approval (a named human&apos;s decision) are separate. The status only becomes APPROVED
        FOR DEMO when the evaluation is eligible <i>and</i> a human approved this exact evidence snapshot.
      </p>
      <p className="mt-2 text-xs font-semibold">{DEMO_DISCLAIMER}</p>
      {view.candidate_run?.execution_mode === "mock" && (
        <p className="mt-1 text-xs font-semibold text-amber-900">
          The candidate&apos;s results come from the MOCK agent. Mock output is not evidence about the real model and cannot support a release decision.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// (e) Run selection + candidate summary
// ---------------------------------------------------------------------------

function runOptionLabel(r: ReleaseRunRow) {
  return `${r.run_id} · ${roleOf(r.agent_config_id)} · ${r.frozen_set_id} · ${r.execution_mode.toUpperCase()} · ${r.status} · ${fmtDateTime(r.created_at)}`;
}

function RunSelect({
  label,
  help,
  value,
  autoLabel,
  runs,
  requiredSetId,
  preferRole,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  value: string;
  autoLabel: string;
  runs: ReleaseRunRow[];
  requiredSetId: string;
  preferRole: "baseline" | "corrected";
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const eligible = runs.filter((r) => r.frozen_set_id === requiredSetId && r.status === "completed");
  const preferred = eligible.filter((r) => roleOf(r.agent_config_id) === preferRole);
  const otherEligible = eligible.filter((r) => roleOf(r.agent_config_id) !== preferRole);
  const rest = runs.filter((r) => !eligible.includes(r));
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs disabled:bg-slate-100"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{autoLabel}</option>
        {preferred.length > 0 && (
          <optgroup label={`${preferRole} config · completed on ${requiredSetId}`}>
            {preferred.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {runOptionLabel(r)}
              </option>
            ))}
          </optgroup>
        )}
        {otherEligible.length > 0 && (
          <optgroup label={`other configs · completed on ${requiredSetId}`}>
            {otherEligible.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {runOptionLabel(r)}
              </option>
            ))}
          </optgroup>
        )}
        {rest.length > 0 && (
          <optgroup label="other frozen sets or unfinished runs (cannot satisfy the gate)">
            {rest.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {runOptionLabel(r)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <span className="mt-1 block text-xs text-slate-500">{help}</span>
    </label>
  );
}

export function RunSelectors({
  view,
  candidate,
  baseline,
  onChange,
  busy,
}: {
  view: ReleaseView;
  candidate: string;
  baseline: string;
  onChange: (next: { candidate: string; baseline: string }) => void;
  busy: boolean;
}) {
  const reqId = view.required_set.frozen_set_id;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <RunSelect
        label="Candidate run (the agent version you want to ship)"
        help={`Default: the latest completed corrected-config run on ${reqId}. Only runs on ${reqId} can satisfy the gate.`}
        value={candidate}
        autoLabel={`Latest completed corrected run on ${reqId}${!candidate && view.candidate_run ? ` (${view.candidate_run.run_id})` : !candidate ? " (none yet)" : ""}`}
        runs={view.runs}
        requiredSetId={reqId}
        preferRole="corrected"
        disabled={busy}
        onChange={(v) => onChange({ candidate: v, baseline })}
      />
      <RunSelect
        label="Baseline run (what the candidate is compared against)"
        help="Default: the latest completed baseline-config run on the same frozen set. Used to detect new critical regressions case by case."
        value={baseline}
        autoLabel={`Latest completed baseline run on ${reqId}${!baseline && view.baseline_run ? ` (${view.baseline_run.run_id})` : !baseline ? " (none yet)" : ""}`}
        runs={view.runs}
        requiredSetId={reqId}
        preferRole="baseline"
        disabled={busy}
        onChange={(v) => onChange({ candidate, baseline: v })}
      />
    </div>
  );
}

function RunLine({ label, run }: { label: string; run: ReleaseView["candidate_run"] }) {
  if (!run) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="w-16 font-medium text-slate-500">{label}</span>
      <code className="font-mono text-slate-900">{run.run_id}</code>
      <span>{run.agent_config_id}</span>
      <span>· {run.frozen_set_id}</span>
      <MockBadge mode={run.execution_mode} />
      <Badge tone={run.status === "completed" ? "neutral" : "amber"}>{run.status}</Badge>
      <span>· started {fmtDateTime(run.created_at)}</span>
    </div>
  );
}

export function CandidateSummary({ view }: { view: ReleaseView }) {
  const s = view.candidate_summary;
  const run = view.candidate_run;
  if (!run || !s) return null;
  const severity = new Map<string, string>();
  for (const e of view.candidate_evals) for (const r of e.results) severity.set(r.evaluator_id, r.severity);
  const cmp = view.comparison;
  const modes = s.execution_modes.length ? s.execution_modes : [run.execution_mode];
  const traceByCase = traceIndex(view);
  const pairByCase = new Map((cmp?.pairs ?? []).map((p) => [p.case_id, p]));
  const modeMismatch = view.baseline_run && view.baseline_run.execution_mode !== run.execution_mode;

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-md bg-slate-50 px-3 py-2">
        <RunLine label="Candidate" run={run} />
        <RunLine label="Baseline" run={view.baseline_run} />
        {!view.baseline_run && <p className="text-xs text-amber-800">No baseline run selected or available — regressions cannot be checked.</p>}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat
          label="Pass-all rate (validated checks)"
          value={<Ratio value={s.pass_all_rate} undefinedReason="The run has no cases" />}
          hint={
            <>
              {s.pass_all_count} of {s.n_cases} cases pass every applicable deterministic check. Cases with no trace count as not passing. The
              judge is not included. {modes.map((m) => <MockBadge key={m} mode={m} />)}
            </>
          }
        />
        <Stat
          label="Critical check failures"
          value={s.critical_failure_count}
          tone={s.critical_failure_count > 0 ? "red" : undefined}
          hint={
            <>
              Failed critical deterministic checks, across {s.cases_with_critical_failure.length} case(s).
              <CaseChips caseIds={s.cases_with_critical_failure} traceByCase={traceByCase} />
            </>
          }
        />
        <Stat
          label="Cases with complete evidence"
          value={`${s.n_cases - s.n_incomplete} / ${s.n_cases}`}
          tone={s.n_incomplete > 0 ? "amber" : undefined}
          hint={`${s.n_with_trace} have a trace; ${s.n_incomplete} are incomplete (no trace, execution error or evaluator error).`}
        />
        <Stat
          label="Paired vs baseline"
          value={cmp ? `${cmp.fixed.length} fixed · ${cmp.regressed.length} regressed` : "—"}
          tone={cmp && cmp.regressed.length > 0 ? "red" : undefined}
          hint={
            cmp ? (
              <>
                Baseline pass-all <Ratio value={cmp.baseline_summary.pass_all_rate} />. {cmp.still_failing.length} still failing,{" "}
                {cmp.still_passing.length} still passing, {cmp.incomplete.length} incomplete — same frozen cases, compared case by case.
              </>
            ) : view.baseline_run ? (
              "Baseline ran on a different frozen set, so a paired comparison is not valid."
            ) : (
              "No baseline run to compare against."
            )
          }
        />
      </div>

      {modeMismatch && (
        <Callout tone="amber" title="Baseline and candidate used different execution modes">
          One run is LIVE and the other MOCK. The gate will not accept this comparison as evidence.
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-800">Per-check results on the candidate run</h3>
          <p className="mb-2 text-xs text-slate-500">
            Each deterministic check is binary and validated by unit tests. Pass rate = pass ÷ (pass + fail + error); N/A cases are excluded, so a
            check that never applied shows <i>undefined</i>, not 100%.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1">Check</th>
                <th>Severity</th>
                <th className="text-right">Pass</th>
                <th className="text-right">Fail</th>
                <th className="text-right">Error</th>
                <th className="text-right">N/A</th>
                <th className="text-right">Pass rate</th>
                {cmp && <th className="text-right">Baseline</th>}
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.per_evaluator).map(([id, t]) => (
                <tr key={id} className="border-b border-slate-100">
                  <td className="py-1.5 font-mono text-xs">{id}</td>
                  <td>
                    <SeverityBadge severity={severity.get(id)} />
                  </td>
                  <td className="text-right tabular-nums">{t.pass}</td>
                  <td className={cx("text-right tabular-nums", t.fail > 0 && "font-semibold text-rose-700")}>{t.fail}</td>
                  <td className={cx("text-right tabular-nums", t.error > 0 && "font-semibold text-violet-700")}>{t.error}</td>
                  <td className="text-right tabular-nums text-slate-500">{t.not_applicable}</td>
                  <td className="text-right">
                    <Ratio value={t.pass_rate} undefinedReason="No case where this check applied" />
                  </td>
                  {cmp && (
                    <td className="text-right text-slate-500">
                      <Ratio value={cmp.per_evaluator[id]?.baseline.pass_rate ?? null} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-md border border-violet-200 bg-violet-50/40 px-3 py-2">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-800">LLM judge tallies</h3>
            <Badge tone="purple" title="Not validated well enough to stand alone; never part of pass-all">
              EXPERIMENTAL
            </Badge>
            {modes.map((m) => (
              <MockBadge key={m} mode={m} />
            ))}
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Judge: unsupported pricing justification. Reported separately and never counted in pass-all. A FAIL, REQUIRES REVIEW or ERROR verdict
            needs a human annotation on that trace before the gate can count it either way.
          </p>
          <ul className="space-y-1 text-sm">
            {(["PASS", "FAIL", "REQUIRES_REVIEW", "ERROR"] as const).map((v) => (
              <li key={v} className="flex items-center justify-between">
                <OutcomeBadge outcome={v} />
                <span className="tabular-nums">{s.judge[v]}</span>
              </li>
            ))}
            <li className="flex items-center justify-between">
              <Badge>NOT RUN</Badge>
              <span className={cx("tabular-nums", s.judge.not_run > 0 && "font-semibold text-amber-700")}>{s.judge.not_run}</span>
            </li>
          </ul>
        </div>
      </div>

      <details className="rounded-md border border-slate-200">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700">
          Case-by-case evidence ({view.candidate_evals.length} cases) — open any trace to inspect the request, recommendation and cited evidence
        </summary>
        <div className="overflow-x-auto border-t border-slate-200 px-3 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1">Case</th>
                <th>Candidate trace</th>
                <th>Pass-all</th>
                <th>Failed checks</th>
                <th>Judge (experimental)</th>
                {cmp && <th>vs baseline</th>}
              </tr>
            </thead>
            <tbody>
              {view.candidate_evals.map((e) => {
                const pair = pairByCase.get(e.case_id);
                return (
                  <tr key={e.case_id} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 font-mono text-xs">{e.case_id}</td>
                    <td>
                      {e.trace_id ? (
                        <span className="inline-flex items-center gap-1">
                          <Link href={`/review/${e.trace_id}`} className="font-mono text-xs text-sky-700 hover:underline">
                            {e.trace_id}
                          </Link>
                          {e.execution_mode && <MockBadge mode={e.execution_mode} />}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">no trace</span>
                      )}
                    </td>
                    <td>
                      {e.pass_all === null ? (
                        <span className="text-xs text-slate-500" title={e.execution_error ?? "No applicable checks"}>
                          undefined
                        </span>
                      ) : (
                        <OutcomeBadge outcome={e.pass_all ? "PASS" : "FAIL"} />
                      )}
                      {e.execution_error && e.trace_id && <Badge tone="red">execution error</Badge>}
                    </td>
                    <td className="text-xs">
                      {e.failed_evaluators.length === 0
                        ? "—"
                        : e.failed_evaluators.map((id) => (
                            <span key={id} className={cx("mr-1 font-mono", e.critical_failures.includes(id) ? "font-semibold text-rose-700" : "text-amber-800")}>
                              {id}
                              {e.critical_failures.includes(id) ? " (critical)" : ""}
                            </span>
                          ))}
                    </td>
                    <td>{e.judge_verdict ? <OutcomeBadge outcome={e.judge_verdict} /> : <span className="text-xs text-slate-500">not run</span>}</td>
                    {cmp && <td className="text-xs text-slate-600">{pair ? pair.change.replace(/_/g, " ") : "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (b) + (c) Recommendation and grouped reasons
// ---------------------------------------------------------------------------

export function Recommendation({ view }: { view: ReleaseView }) {
  const rec = recommendationFromReasons(view.gate.reasons);
  const groups = groupReasons(view.gate.reasons);
  const traceByCase = traceIndex(view);
  return (
    <div className="space-y-4">
      <Callout tone={rec.tone} title="Recommendation">
        <p className="text-base font-medium">{rec.headline}</p>
        <p className="mt-1 text-sm">Next step: {rec.next_step}</p>
        <p className="mt-1 text-xs opacity-75">Derived only from the gate&apos;s recorded reasons below.</p>
      </Callout>
      {groups.length === 0 ? (
        <p className="text-sm text-slate-600">The gate recorded no blocking reasons, evidence gaps or warnings for this candidate.</p>
      ) : (
        groups.map((g) => (
          <div key={g.level}>
            <div className="mb-1 flex items-center gap-2">
              <Badge tone={g.level === "NO_SHIP" ? "red" : g.level === "INSUFFICIENT_EVIDENCE" ? "amber" : "neutral"}>{g.reasons.length}</Badge>
              <h3 className="text-sm font-semibold text-slate-800">{LEVEL_META[g.level].title}</h3>
            </div>
            <p className="mb-2 text-xs text-slate-500">{LEVEL_META[g.level].help}</p>
            <ol className="space-y-2">
              {g.reasons.map((r, i) => (
                <li
                  key={`${r.code}-${i}`}
                  className={cx(
                    "rounded-md border-l-4 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-100",
                    g.level === "NO_SHIP" ? "border-l-rose-500" : g.level === "INSUFFICIENT_EVIDENCE" ? "border-l-amber-400" : "border-l-slate-300",
                  )}
                >
                  <div className="text-slate-900">{r.message}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-400">{r.code}</div>
                  {r.case_ids.length > 0 && (
                    <>
                      <div className="mt-1 text-xs text-slate-500">Affected cases — click to open the candidate trace:</div>
                      <CaseChips caseIds={r.case_ids} traceByCase={traceByCase} />
                    </>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (d) Evidence completeness checklist
// ---------------------------------------------------------------------------

const CHECK_ICON: Record<GateCheck["status"], { icon: string; cls: string; word: string }> = {
  pass: { icon: "✓", cls: "bg-emerald-100 text-emerald-800", word: "pass" },
  fail: { icon: "✗", cls: "bg-rose-100 text-rose-800", word: "fail" },
  pending: { icon: "…", cls: "bg-slate-100 text-slate-500", word: "pending — cannot be checked yet" },
};

export function EvidenceChecklist({ checks }: { checks: GateCheck[] }) {
  const passed = checks.filter((c) => c.status === "pass").length;
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        {passed} of {checks.length} items satisfied. “Pending” means the item cannot be evaluated yet (for example, there is no candidate or baseline
        run) — it is not a pass.
      </p>
      <ul className="divide-y divide-slate-100">
        {checks.map((c) => {
          const m = CHECK_ICON[c.status];
          return (
            <li key={c.id} className="flex items-start gap-3 py-2">
              <span
                className={cx("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold", m.cls)}
                aria-label={m.word}
                title={m.word}
              >
                {m.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-900">{c.label}</div>
                <div className="text-xs text-slate-500">{c.detail}</div>
              </div>
              <span className={cx("shrink-0 text-xs font-medium", c.status === "pass" ? "text-emerald-700" : c.status === "fail" ? "text-rose-700" : "text-slate-500")}>
                {c.status.toUpperCase()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (g) Limitations
// ---------------------------------------------------------------------------

export function Limitations({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
      {items.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

export function SnapshotHash({ hash }: { hash: string }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800" title={hash}>
      {shortHash(hash)}
    </code>
  );
}
