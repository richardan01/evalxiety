/**
 * Presentational sections of the Release Gate tab. Everything shown is taken
 * from GET /api/release (the gate, run summaries and per-case evaluations) —
 * nothing is computed or estimated here beyond grouping and labelling.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, InfoTip, MockBadge, OutcomeBadge, Ratio, SeverityBadge, StatusPill, cx, fmtDateTime } from "@/components/ui";
import type { GateCheck } from "@/lib/release/gate";
import {
  APPROVAL_STATE_HELP,
  APPROVAL_STATE_LABEL,
  LEVEL_META,
  PLAIN_STATUS,
  STATUS_META,
  checkLabel,
  demoDisclaimer,
  groupReasons,
  shortHash,
  shortMessage,
  verdictFor,
} from "./status";
import type { ReleaseRunRow, ReleaseView } from "./types";

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

export function traceIndex(view: ReleaseView): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of view.candidate_evals) if (e.trace_id) m.set(e.case_id, e.trace_id);
  return m;
}

export function CaseChips({ caseIds, traceByCase, max = 6 }: { caseIds: string[]; traceByCase: Map<string, string>; max?: number }) {
  if (caseIds.length === 0) return null;
  const shown = caseIds.slice(0, max);
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((id) => {
        const traceId = traceByCase.get(id);
        return traceId ? (
          <Link
            key={id}
            href={`/review/${traceId}`}
            title={`Open the candidate trace for ${id}`}
            className="rounded border border-slate-300 bg-white px-1.5 font-mono text-[11px] leading-5 text-sky-700 hover:border-sky-400 hover:underline"
          >
            {id}
          </Link>
        ) : (
          <span
            key={id}
            title="No candidate trace for this case"
            className="rounded border border-dashed border-slate-300 px-1.5 font-mono text-[11px] leading-5 text-slate-400"
          >
            {id}
          </span>
        );
      })}
      {caseIds.length > max && (
        <span className="px-1 text-[11px] leading-5 text-slate-500" title={caseIds.slice(max).join(", ")}>
          +{caseIds.length - max}
        </span>
      )}
    </span>
  );
}

export function SnapshotHash({ hash }: { hash: string }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700" title={hash}>
      {shortHash(hash)}
    </code>
  );
}

const roleOf = (configId: string) => (configId.includes("baseline") ? "baseline" : configId.includes("corrected") ? "corrected" : configId);

const ACTION_CLS =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700";

// ---------------------------------------------------------------------------
// Verdict block: status + one sentence + one action
// ---------------------------------------------------------------------------

export function Verdict({ view }: { view: ReleaseView }) {
  const { gate } = view;
  const caseCount = view.required_set.case_ids.length;
  const v = verdictFor({
    reasons: gate.reasons,
    approval_state: gate.approval_state,
    approver: gate.latest_approval?.approver ?? null,
    case_count: caseCount,
    trace_by_case: traceIndex(view),
  });
  return (
    <section className={cx("rounded-xl border-2 px-6 py-5", STATUS_META[gate.status].banner)} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 [&>span:first-child]:px-4 [&>span:first-child]:py-1.5 [&>span:first-child]:text-xl">
            <StatusPill status={gate.status} />
            {view.candidate_run && <MockBadge mode={view.candidate_run.execution_mode} />}
          </div>
          <p className="text-lg font-medium">{v.sentence}</p>
        </div>
        {v.action &&
          (v.action.href.startsWith("#") ? (
            <a href={v.action.href} className={ACTION_CLS}>
              {v.action.label} ↓
            </a>
          ) : (
            <Link href={v.action.href} className={ACTION_CLS}>
              {v.action.label} →
            </Link>
          ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-80">
        <span title="Evaluation = automated checks on the evidence. Approval = a named human's decision. They are separate.">
          Evaluation: <b>{PLAIN_STATUS[gate.evaluation_status]}</b> · Approval:{" "}
          <b title={APPROVAL_STATE_HELP[gate.approval_state]}>{APPROVAL_STATE_LABEL[gate.approval_state]}</b> · Pass-all:{" "}
          <b>
            <Ratio value={gate.pass_all_rate} undefinedReason="No candidate run with traced cases" />
          </b>
        </span>
        <span className="flex items-center gap-1.5">
          {demoDisclaimer(caseCount)}
          <InfoTip label="Limitations">
            <ul className="list-disc space-y-1 pl-4">
              {gate.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </InfoTip>
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// What's needed: checklist + grouped reasons
// ---------------------------------------------------------------------------

const CHECK_ICON: Record<GateCheck["status"], { icon: string; cls: string; word: string }> = {
  pass: { icon: "✓", cls: "bg-emerald-100 text-emerald-700", word: "done" },
  fail: { icon: "✕", cls: "bg-rose-100 text-rose-700", word: "failed" },
  pending: { icon: "…", cls: "bg-slate-100 text-slate-500", word: "pending — not a pass" },
};

export function Checklist({ checks }: { checks: GateCheck[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {checks.map((c) => {
        const m = CHECK_ICON[c.status];
        const detail = c.detail && c.detail !== "—" ? c.detail : "";
        return (
          <li key={c.id} className="flex items-center gap-2 py-1.5 text-sm" title={`${c.label} — ${m.word}${detail ? ` (${detail})` : ""}`}>
            <span
              aria-label={m.word}
              className={cx("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", m.cls)}
            >
              {m.icon}
            </span>
            <span className={cx("truncate", c.status === "pending" ? "text-slate-500" : "text-slate-900")}>{checkLabel(c)}</span>
            {detail && <span className="ml-auto max-w-[45%] shrink-0 truncate pl-2 text-xs text-slate-400">{detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const LEVEL_CLS = {
  red: { head: "text-rose-700", bar: "border-l-rose-500" },
  amber: { head: "text-amber-700", bar: "border-l-amber-400" },
  slate: { head: "text-slate-500", bar: "border-l-slate-300" },
} as const;

export function Reasons({ view }: { view: ReleaseView }) {
  const groups = groupReasons(view.gate.reasons);
  const traceByCase = traceIndex(view);
  if (groups.length === 0) return <p className="py-1.5 text-sm text-emerald-700">✓ Nothing blocking, nothing missing.</p>;
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const meta = LEVEL_META[g.level];
        const cls = LEVEL_CLS[meta.tone];
        return (
          <div key={g.level}>
            <div className={cx("mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide", cls.head)}>
              <span aria-hidden>{meta.icon}</span>
              {meta.title} · {g.reasons.length}
              <InfoTip label={meta.title}>{meta.help}</InfoTip>
            </div>
            <ul className="space-y-1">
              {g.reasons.map((r, i) => (
                <li
                  key={`${r.code}-${i}`}
                  className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 border-l-[3px] py-0.5 pl-2.5 text-sm text-slate-800", cls.bar)}
                  title={`${r.message} [${r.code}]`}
                >
                  <span>{shortMessage(r.message)}</span>
                  <CaseChips caseIds={r.case_ids} traceByCase={traceByCase} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsed details: run selection + candidate summary
// ---------------------------------------------------------------------------

function runOptionLabel(r: ReleaseRunRow) {
  return `${r.run_id} · ${roleOf(r.agent_config_id)} · ${r.frozen_set_id} · ${r.execution_mode.toUpperCase()} · ${r.status} · ${fmtDateTime(r.created_at)}`;
}

function RunSelect({
  label,
  value,
  autoLabel,
  runs,
  requiredSetId,
  preferRole,
  onChange,
  disabled,
}: {
  label: string;
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
          <optgroup label={`${preferRole} · completed on ${requiredSetId}`}>
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
          <optgroup label="other sets or unfinished (cannot satisfy the gate)">
            {rest.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {runOptionLabel(r)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
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
  const auto = (run: ReleaseView["candidate_run"], chosen: string) => (!chosen ? (run ? ` (${run.run_id})` : " (none yet)") : "");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <RunSelect
        label="Candidate (version to ship)"
        value={candidate}
        autoLabel={`Latest corrected run on ${reqId}${auto(view.candidate_run, candidate)}`}
        runs={view.runs}
        requiredSetId={reqId}
        preferRole="corrected"
        disabled={busy}
        onChange={(v) => onChange({ candidate: v, baseline })}
      />
      <RunSelect
        label="Baseline (compared against)"
        value={baseline}
        autoLabel={`Latest baseline run on ${reqId}${auto(view.baseline_run, baseline)}`}
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
      <span>· {fmtDateTime(run.created_at)}</span>
    </div>
  );
}

function MiniStat({ label, value, tone, tip }: { label: string; value: ReactNode; tone?: "red" | "amber"; tip?: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {label}
        {tip && <InfoTip label={label}>{tip}</InfoTip>}
      </div>
      <div className={cx("text-lg font-semibold tabular-nums", tone === "red" && "text-rose-700", tone === "amber" && "text-amber-700")}>{value}</div>
    </div>
  );
}

export function CandidateSummary({ view }: { view: ReleaseView }) {
  const s = view.candidate_summary;
  const run = view.candidate_run;
  if (!run || !s) return <p className="text-sm text-slate-500">No candidate run on {view.required_set.frozen_set_id} yet.</p>;
  const severity = new Map<string, string>();
  for (const e of view.candidate_evals) for (const r of e.results) severity.set(r.evaluator_id, r.severity);
  const cmp = view.comparison;
  const modes = s.execution_modes.length ? s.execution_modes : [run.execution_mode];
  const pairByCase = new Map((cmp?.pairs ?? []).map((p) => [p.case_id, p]));

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-md bg-slate-50 px-3 py-2">
        <RunLine label="Candidate" run={run} />
        <RunLine label="Baseline" run={view.baseline_run} />
        {!view.baseline_run && <p className="text-xs text-amber-800">No baseline run.</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MiniStat
          label="Pass-all"
          value={<Ratio value={s.pass_all_rate} undefinedReason="The run has no cases" />}
          tip={<>Cases passing every applicable deterministic check ({s.pass_all_count}/{s.n_cases}). No trace = not passing. Judge excluded.</>}
        />
        <MiniStat label="Critical failures" value={s.critical_failure_count} tone={s.critical_failure_count > 0 ? "red" : undefined} />
        <MiniStat label="Complete cases" value={`${s.n_cases - s.n_incomplete}/${s.n_cases}`} tone={s.n_incomplete > 0 ? "amber" : undefined} />
        <MiniStat
          label="vs baseline"
          value={cmp ? `${cmp.fixed.length} fixed · ${cmp.regressed.length} regr.` : "—"}
          tone={cmp && cmp.regressed.length > 0 ? "red" : undefined}
          tip={cmp ? <>Baseline pass-all <Ratio value={cmp.baseline_summary.pass_all_rate} />. Same cases, compared one by one.</> : "No valid baseline comparison."}
        />
        <MiniStat
          label="Judge flags"
          value={s.judge.FAIL + s.judge.REQUIRES_REVIEW + s.judge.ERROR}
          tip={
            <>
              Experimental LLM judge: never counted in pass-all, never replaces human review. PASS {s.judge.PASS} · FAIL {s.judge.FAIL} · REVIEW{" "}
              {s.judge.REQUIRES_REVIEW} · ERROR {s.judge.ERROR} · not run {s.judge.not_run}.{" "}
              {modes.map((m) => (
                <MockBadge key={m} mode={m} />
              ))}
            </>
          }
        />
      </div>

      <details className="rounded-md border border-slate-200">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700">Per-check pass rates</summary>
        <div className="overflow-x-auto border-t border-slate-200 px-3 py-2">
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
      </details>

      <details className="rounded-md border border-slate-200">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700">Case by case ({view.candidate_evals.length})</summary>
        <div className="overflow-x-auto border-t border-slate-200 px-3 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1">Case</th>
                <th>Trace</th>
                <th>Pass-all</th>
                <th>Failed checks</th>
                <th>Judge</th>
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

/** One-line summary of which runs the gate is looking at (for the collapsed details header). */
export function runsSummary(view: ReleaseView): string {
  const c = view.candidate_run?.run_id ?? "none";
  const b = view.baseline_run?.run_id ?? "none";
  return `candidate ${c} · baseline ${b}`;
}
