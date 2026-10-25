"use client";

import Link from "next/link";
import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import {
  Badge,
  Button,
  Callout,
  Card,
  cx,
  EmptyState,
  ExampleBadge,
  fmtDateTime,
  fmtUsd,
  InfoTip,
  MockBadge,
  OutcomeBadge,
  Ratio,
  SplitBadge,
  Stat,
  StatusPill,
} from "@/components/ui";
import type { AgentOverview, DefinitionView, RunRow } from "../types";
import { CaseEditor } from "./CaseEditor";
import type { Selection } from "./AgentWorkspace";
import { ErrorList, inputCls, NameField, useName } from "./shared";

const LEVEL_TONE = { NO_SHIP: "red", INSUFFICIENT_EVIDENCE: "amber", WARNING: "neutral" } as const;
const LEVEL_LABEL = { NO_SHIP: "BLOCKS", INSUFFICIENT_EVIDENCE: "NEEDED", WARNING: "NOTE" } as const;
const CHANGE_LABEL = { fixed: "fixed", regressed: "got worse", still_failing: "still failing", still_passing: "still passing", incomplete: "can't compare" } as const;
const runLabel = (r: RunRow | undefined) => (r ? `${r.agent_version} · ${fmtDateTime(r.created_at)}` : "—");

// ---------------------------------------------------------------------------
// Release gate
// ---------------------------------------------------------------------------

/**
 * `url` is the selection as written in the URL ("" = default, "none" = no baseline). Changing one picker keeps the
 * other exactly as the URL had it, so an explicit "(no baseline)" survives picking a different candidate.
 */
export function GateCard({ view, url, onSelect, onChanged }: { view: AgentOverview; url: Selection; onSelect: (s: Selection) => void; onChanged: () => void }) {
  const g = view.gate;
  const done = view.runs.filter((r) => r.status === "completed");
  const sel = view.selected;
  return (
    <Card
      title="Release checklist"
      subtitle="Everything the verdict above is based on: No ship › Not enough evidence › Ready for approval › Approved (by a named person)."
      actions={<StatusPill status={g.status} approvedLabel="Approved" />}
    >
      <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span className="font-semibold">Next step:</span> {g.next_step}
      </div>
      {g.unresolved_reviews.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-slate-600">Still to review ({g.unresolved_reviews.length})</summary>
          <ul className="mt-1 space-y-0.5 pl-1">
            {g.unresolved_reviews.map((u) => (
              <li key={u.trace_id}>
                <Link href={`/agents/${view.agent.agent_id}/traces/${u.trace_id}`} className="font-mono text-xs text-sky-700 hover:underline">
                  {u.case_id}
                </Link>{" "}
                <span className="text-xs text-slate-500">{u.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        {(["candidate", "baseline"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <span className="w-28 text-slate-600" title={k === "candidate" ? "The change you want to ship (candidate)" : "The version you ship today (baseline)"}>
              {k === "candidate" ? "New version" : "Current version"}
            </span>
            <select
              value={sel[k] ?? (k === "baseline" ? "none" : "")}
              onChange={(e) => {
                const v = e.target.value;
                const other = k === "candidate" ? "baseline" : "candidate";
                // Picking the run the other side already has swaps the two, instead of comparing a run with itself.
                const swapped: Selection =
                  k === "candidate" ? { candidate: v, baseline: sel.candidate ?? "none" } : { candidate: sel.baseline ?? "", baseline: v };
                onSelect(v && v === sel[other] ? swapped : { ...url, [k]: v });
              }}
              className={cx(inputCls, "max-w-xs")}
            >
              {k === "baseline" && <option value="none">(none)</option>}
              {k === "candidate" && !sel.candidate && <option value="">(none yet)</option>}
              {done.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {runLabel(r)}
                  {r.stale ? " (old cases)" : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist</h3>
          <ul className="space-y-1 text-sm">
            {g.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <span aria-hidden className={cx("mt-0.5 w-4 text-center font-bold", c.status === "pass" ? "text-emerald-600" : c.status === "fail" ? "text-rose-600" : "text-slate-400")}>
                  {c.status === "pass" ? "✓" : c.status === "fail" ? "✕" : "…"}
                </span>
                <span className="flex-1">{c.label}</span>
                <span className="text-xs text-slate-500">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Why</h3>
          {g.reasons.length === 0 ? (
            <p className="text-sm text-slate-500">No blocking reasons.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {g.reasons.map((r) => (
                <li key={r.code} className="flex items-start gap-2">
                  <Badge tone={LEVEL_TONE[r.level]}>{LEVEL_LABEL[r.level]}</Badge>
                  <span>
                    {r.message}
                    {r.case_ids.length > 0 && <span className="ml-1 font-mono text-xs text-slate-500">{r.case_ids.slice(0, 8).join(", ")}{r.case_ids.length > 8 ? "…" : ""}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Approval view={view} onChanged={onChanged} />
      <details className="mt-3 text-xs text-slate-500">
        <summary className="cursor-pointer">Limitations</summary>
        <ul className="mt-1 list-disc pl-5">
          {g.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function Approval({ view, onChanged }: { view: AgentOverview; onChanged: () => void }) {
  const [name, setName] = useName();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const g = view.gate;
  if (g.latest_approval && g.approval_state !== "stale") {
    return (
      <Callout tone={g.approval_state === "approved" ? "blue" : "slate"} title={`${g.approval_state === "approved" ? "Approved" : "Rejected"} by ${g.latest_approval.approver}`}>
        {fmtDateTime(g.latest_approval.created_at)}
        {g.latest_approval.notes && <> — {g.latest_approval.notes}</>}
      </Callout>
    );
  }
  if (g.evaluation_status !== "ELIGIBLE_FOR_DEMO_APPROVAL") return null;
  const byId = new Map(view.runs.map((r) => [r.run_id, r]));
  const cand = byId.get(view.selected.candidate ?? "");
  const base = byId.get(view.selected.baseline ?? "");
  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await postJSON(`/api/agents/${view.agent.agent_id}/approve`, {
        approver: name,
        decision,
        notes,
        candidate_run_id: view.selected.candidate,
        baseline_run_id: view.selected.baseline,
        evidence_snapshot_hash: view.evidence_snapshot_hash,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3">
      <div className="text-sm font-semibold text-sky-950">Ready for a human decision{g.approval_state === "stale" ? " (the evidence changed since the last decision)" : ""}</div>
      <div className="mt-1 text-sm text-sky-950">
        You are deciding on <b>{runLabel(cand)}</b> (new version) against <b>{runLabel(base)}</b> (current version).
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <NameField name={name} setName={setName} />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className={cx(inputCls, "min-w-64 flex-1")} />
        <Button disabled={busy || !name.trim()} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button variant="secondary" disabled={busy || !name.trim()} onClick={() => decide("rejected")}>
          Reject
        </Button>
      </div>
      <div className="mt-2">
        <ErrorList error={error} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export function RunsCard({ view, url, onSelect, onChanged }: { view: AgentOverview; url: Selection; onSelect: (s: Selection) => void; onChanged: () => void }) {
  const [name] = useName();
  const [msg, setMsg] = useState<{ runId: string; text: string; confirm?: boolean } | null>(null);
  const sel = view.selected;
  if (view.runs.length === 0) {
    return (
      <Card title="Tests">
        <EmptyState title="No tests yet">Add your first test above: import your agent&apos;s answers, or let Evalxiety call it.</EmptyState>
      </Card>
    );
  }
  async function judge(runId: string, confirm: boolean) {
    setMsg({ runId, text: "Judging…" });
    const res = await fetch(`/api/agents/${view.agent.agent_id}/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, actor: name, confirm }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.confirmation_required) return setMsg({ runId, text: body.error, confirm: true });
    if (!res.ok) return setMsg({ runId, text: body.error ?? `Judge failed (${res.status})` });
    setMsg({ runId, text: `Judged ${body.judged} trace(s)${body.errors ? `, ${body.errors} error(s)` : ""}.` });
    onChanged();
  }
  return (
    <Card title="Tests" subtitle="Each test is one version of your agent answering every test case. Rule results are recomputed from the answers on every load.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-3">Version</th>
              <th className="py-1 pr-3">Source</th>
              <th className="py-1 pr-3">Cases</th>
              <th className="py-1 pr-3">Passed every rule</th>
              <th className="py-1 pr-3">AI reviewer flagged</th>
              <th className="py-1 pr-3">Cost</th>
              <th className="py-1 pr-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {view.runs.map((r) => {
              const s = r.summary;
              const role = r.run_id === sel.candidate ? "candidate" : r.run_id === sel.baseline ? "baseline" : null;
              const firstTrace = Object.values(r.trace_ids)[0];
              return (
                <tr key={r.run_id} className={cx(role && "bg-sky-50/50")}>
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{r.agent_version}</div>
                    <div className="text-xs text-slate-500">
                      {fmtDateTime(r.created_at)} · {r.created_by} · cases v{r.frozen_version}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="flex flex-wrap gap-1">
                      <MockBadge mode={r.execution_mode} />
                      {r.data_origin === "example" && <ExampleBadge />}
                      {r.status !== "completed" && <Badge tone={r.status === "failed" ? "red" : "blue"}>{r.status}</Badge>}
                      {r.stale && <Badge tone="amber">old cases</Badge>}
                      {role && <Badge tone="slate">{role === "candidate" ? "new version" : "current version"}</Badge>}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {s.n_with_trace}/{s.n_cases}
                    {s.n_incomplete > 0 && <span className="ml-1 text-xs text-rose-700">({s.n_incomplete} incomplete)</span>}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {s.pass_all_count}/{s.n_cases} <span className="text-xs text-slate-500">(<Ratio value={s.pass_all_rate} />)</span>
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {view.agent.judge ? (
                      <>
                        {s.judge.FAIL + s.judge.REQUIRES_REVIEW}
                        {s.judge.not_run > 0 && <span className="text-xs text-slate-500"> · {s.judge.not_run} not run</span>}
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{s.total_cost_usd ? fmtUsd(s.total_cost_usd, 4) : "—"}</td>
                  <td className="py-1.5 pr-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {firstTrace && (
                        <Link href={`/agents/${view.agent.agent_id}/traces/${firstTrace}`} className="rounded px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50">
                          Review
                        </Link>
                      )}
                      {view.agent.judge && (s.judge.not_run > 0 || s.judge.ERROR > 0) && r.status === "completed" && (
                        <Button variant="ghost" disabled={!name.trim()} title={name.trim() ? undefined : "Enter your name (in Add a test) first"} onClick={() => judge(r.run_id, false)}>
                          Run AI reviewer
                        </Button>
                      )}
                      {r.status === "completed" && role !== "candidate" && (
                        <Button variant="ghost" onClick={() => onSelect(sel.baseline === r.run_id ? { candidate: r.run_id, baseline: sel.candidate ?? "none" } : { candidate: r.run_id, baseline: url.baseline })}>
                          Use as new
                        </Button>
                      )}
                      {r.status === "completed" && role !== "baseline" && (
                        <Button variant="ghost" onClick={() => onSelect(sel.candidate === r.run_id ? { candidate: sel.baseline ?? "", baseline: r.run_id } : { candidate: url.candidate, baseline: r.run_id })}>
                          Use as current
                        </Button>
                      )}
                    </div>
                    {msg?.runId === r.run_id && (
                      <div className="mt-1 text-right text-xs text-slate-600">
                        {msg.text}{" "}
                        {msg.confirm && (
                          <Button variant="secondary" onClick={() => judge(r.run_id, true)}>
                            Confirm
                          </Button>
                        )}
                      </div>
                    )}
                    {r.notes && r.status === "failed" && <div className="mt-1 text-right text-xs text-rose-700">{r.notes}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export function CompareCard({ view }: { view: AgentOverview }) {
  const c = view.gate.comparison;
  const byId = new Map(view.runs.map((r) => [r.run_id, r]));
  const base = byId.get(view.selected.baseline ?? "");
  const cand = byId.get(view.selected.candidate ?? "");
  if (!c) {
    return (
      <Card title="Current vs new version">
        <p className="text-sm text-slate-500">Test the version you ship today and your new version on the same cases to compare them case by case.</p>
      </Card>
    );
  }
  const changeTone = { fixed: "green", regressed: "red", still_failing: "amber", still_passing: "neutral", incomplete: "purple" } as const;
  return (
    <Card title="Current vs new version" subtitle={`${runLabel(base)} → ${runLabel(cand)}. Read what got worse case by case; an average hides it.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Fixed" value={c.fixed.length} tone={c.fixed.length ? "green" : undefined} />
        <Stat label="Got worse" value={c.regressed.length} tone={c.regressed.length ? "red" : undefined} />
        <Stat label="Still failing" value={c.still_failing.length} tone={c.still_failing.length ? "amber" : undefined} />
        <Stat label="Still passing" value={c.still_passing.length} />
        <Stat label="Rules newly failing" value={c.new_regressions.length} tone={c.new_regressions.length ? "red" : undefined} hint={`${c.new_critical_regressions.length} critical`} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-2">Case</th>
              <th className="py-1 pr-2">Change</th>
              {view.checks.map((d) => (
                <th key={d.evaluator_id} className="py-1 pr-2 font-mono" title={d.question}>
                  {d.evaluator_id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {c.pairs.map((p) => (
              <tr key={p.case_id}>
                <td className="py-1 pr-2 font-mono">
                  {p.candidate.trace_id ? (
                    <Link href={`/agents/${view.agent.agent_id}/traces/${p.candidate.trace_id}`} className="text-sky-700 hover:underline">
                      {p.case_id}
                    </Link>
                  ) : (
                    p.case_id
                  )}
                </td>
                <td className="py-1 pr-2">
                  <Badge tone={changeTone[p.change]}>{CHANGE_LABEL[p.change]}</Badge>
                </td>
                {p.evaluator_changes.map((e) => (
                  <td key={e.evaluator_id} className={cx("py-1 pr-2", e.kind === "regressed" && "bg-rose-50", e.kind === "fixed" && "bg-emerald-50")}>
                    <span className="text-slate-400">{short(e.from)}</span> → <b className={cx(e.to === "FAIL" && "text-rose-700", e.to === "PASS" && "text-emerald-700")}>{short(e.to)}</b>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const short = (o: string | null) => (o === null ? "—" : o === "NOT_APPLICABLE" ? "n/a" : o === "PASS" ? "pass" : o === "FAIL" ? "FAIL" : "err");

// ---------------------------------------------------------------------------
// Human review
// ---------------------------------------------------------------------------

export function ReviewCard({ view }: { view: AgentOverview }) {
  // Review the candidate; before there is one, the baseline (your first run).
  const cand =
    view.runs.find((r) => r.run_id === view.selected.candidate) ??
    view.runs.find((r) => r.run_id === view.selected.baseline) ??
    view.runs.find((r) => r.status === "completed");
  const first = cand ? Object.values(cand.trace_ids)[0] : null;
  const need = view.agent.min_reviewed_traces;
  return (
    <Card
      title="Your review"
      subtitle="Read the agent's answers and mark each one before you trust any automated number. Automated results stay hidden until you save."
      actions={
        first ? (
          <Link href={`/agents/${view.agent.agent_id}/traces/${first}`} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            Start reviewing
          </Link>
        ) : null
      }
    >
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <Stat label="Answers reviewed" value={`${view.reviewed_trace_count} / ${need}`} tone={view.reviewed_trace_count >= need ? "green" : "amber"} hint="minimum before deciding" />
        <div>
          <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Problems you found
            <InfoTip>
              Name each problem in plain words when you review an answer, then reuse names to group them. The most frequent ones are what to fix first, and the objective
              ones are what to turn into rules.
            </InfoTip>
          </h3>
          {view.failure_types.length === 0 ? (
            <p className="text-sm text-slate-500">No problems marked yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {view.failure_types.map((f) => (
                <li key={f.name} className="flex items-center gap-2">
                  <span className="w-8 text-right font-semibold tabular-nums">{f.count}</span>
                  <span className="flex-1">{f.name}</span>
                  {f.critical > 0 && <Badge tone="red">{f.critical} critical</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cases, frozen versions, held-out
// ---------------------------------------------------------------------------

export function CasesCard({ view, def, onChanged }: { view: AgentOverview; def: DefinitionView | null; onChanged: () => void }) {
  const [name, setName] = useName();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = view.frozen.versions[view.frozen.versions.length - 1];
  const heldout = view.cases.filter((c) => c.split === "heldout");
  const locked = heldout.filter((c) => c.locked);

  async function act(url: string, payload: unknown) {
    setBusy(true);
    setError(null);
    try {
      await postJSON(url, payload);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Test cases"
      subtitle={
        <>
          {view.cases.length} cases in <code>agents/{view.agent.agent_id}/cases.jsonl</code> · {latest ? `locked as v${latest.version} (${latest.content_hash.slice(0, 10)})` : "not locked yet (the first test locks them as v1)"}
        </>
      }
    >
      {view.frozen.changed_since_latest && (
        <Callout tone="amber" title="cases.jsonl changed since the cases were locked">
          New tests are blocked until you lock the new set, so old and new tests are never compared as if they ran on the same questions.
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <NameField name={name} setName={setName} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" className={cx(inputCls, "min-w-64")} />
            <Button disabled={busy || !name.trim() || note.trim().length < 3} onClick={() => act(`/api/agents/${view.agent.agent_id}/freeze`, { actor: name, note })}>
              Lock as v{(latest?.version ?? 0) + 1}
            </Button>
          </div>
        </Callout>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {view.cases.map((c) => (
          <span key={c.case_id} title={c.notes ?? undefined} className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 font-mono text-xs">
            {c.case_id}
            {c.split === "heldout" && <SplitBadge split="heldout" />}
            {c.origin === "ai_drafted" && (
              <span className="text-[10px] font-sans text-purple-700" title="Claude proposed this question and a person accepted it">
                AI
              </span>
            )}
            {c.locked && (
              <span aria-label="locked" title={c.lock_reason ?? undefined}>
                🔒
              </span>
            )}
          </span>
        ))}
      </div>
      {heldout.length > 0 && (
        <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm">
          {view.heldout.revealed && (
            <div className={cx(locked.length > 0 && "mb-2")}>
              Last unlocked by <b>{view.heldout.revealed_by}</b> on {fmtDateTime(view.heldout.revealed_at!)} — “{view.heldout.reason}” ({view.heldout.revealed_cases.length} case(s) revealed so far).
            </div>
          )}
          {locked.length > 0 && (
            <>
              <div className="font-medium text-violet-950">
                {locked.length} final-exam (held-out) case(s) are locked: {locked.map((c) => c.case_id).join(", ")}
              </div>
              <p className="mt-0.5 text-violet-900">
                Keep them locked while you improve the agent, so the final check is on questions nobody tuned for. Unlock them once, when you are done: it&apos;s logged
                and can&apos;t be undone.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <NameField name={name} setName={setName} />
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why now? (at least 10 characters)" className={cx(inputCls, "min-w-72")} />
                <Button variant="danger" disabled={busy || !name.trim() || reason.trim().length < 10} onClick={() => act(`/api/agents/${view.agent.agent_id}/heldout`, { actor: name, reason, case_ids: locked.map((c) => c.case_id) })}>
                  Unlock {locked.length} final-exam case(s)
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-2">
        <ErrorList error={error} />
      </div>
      {def?.editable && <CaseEditor view={view} def={def} onChanged={onChanged} />}
      {view.runs.length > 0 && view.runs.some((r) => r.status === "completed") && (
        <p className="mt-3 text-xs text-slate-500">
          Every case carries an <OutcomeBadge outcome="PASS" />/<OutcomeBadge outcome="FAIL" /> per check in each run — see the comparison above.
        </p>
      )}
    </Card>
  );
}
