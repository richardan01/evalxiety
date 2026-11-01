"use client";

/**
 * Review one trace of your agent. You label it first; code checks, the judge and other reviewers' verdicts are revealed
 * only after you save, so they can't anchor your judgement (same rule as the pricing demo).
 *
 * Built to be fast to work through: keyboard shortcuts for every choice (reviewKeys.ts, "?" lists them), "Save & next"
 * goes to the next answer you haven't marked, and a progress bar shows how far the test's review has got. "Not sure"
 * is a real answer: it records what's unclear and leaves the decision open for someone else.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { nextForMe } from "@/lib/agents/review";
import { reviewKeyAction, SHORTCUTS, type ReviewAction } from "@/lib/agents/reviewKeys";
import { getJSON } from "@/lib/client/api";
import { Badge, Button, Callout, Card, cx, ExampleBadge, fmtDateTime, fmtUsd, MockBadge, OutcomeBadge, SeverityBadge, SplitBadge } from "@/components/ui";
import type { AgentTraceView } from "../../../types";
import { ReviewProgress } from "../../ReviewProgress";
import { ErrorList, inputCls, NameField, Pretty, useName } from "../../shared";

type Severity = "critical" | "major" | "minor";
type JudgeLabel = "present" | "absent" | "not_assessed";
type Outcome = "pass" | "fail" | "unsure";

interface Form {
  task_outcome: Outcome | null;
  notes: string;
  first_failure: string;
  failure_type: string;
  severity: Severity | null;
  judge_label: JudgeLabel;
}

const EMPTY: Form = { task_outcome: null, notes: "", first_failure: "", failure_type: "", severity: null, judge_label: "not_assessed" };

const OUTCOMES: Array<{ value: Outcome; label: string; key: string; on: string }> = [
  { value: "pass", label: "✓ Pass", key: "P", on: "bg-emerald-600 text-white ring-emerald-600" },
  { value: "fail", label: "✕ Fail", key: "F", on: "bg-rose-600 text-white ring-rose-600" },
  { value: "unsure", label: "? Not sure", key: "U", on: "bg-amber-500 text-white ring-amber-500" },
];

const isField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
// A focused link or button keeps Enter for itself; the verdict buttons (data-choice) don't, so Enter saves after a click.
const isControl = (t: EventTarget | null) =>
  t instanceof HTMLElement && !t.hasAttribute("data-choice") && (["A", "BUTTON"].includes(t.tagName) || t.getAttribute("role") === "button");

export function TraceReview({ agentId, traceId }: { agentId: string; traceId: string }) {
  const [name, setName] = useName();
  const [loaded, setLoaded] = useState<{ view: AgentTraceView; n: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const reviewer = name.trim();

  useEffect(() => {
    let alive = true;
    const qs = reviewer ? `?reviewer=${encodeURIComponent(reviewer)}` : "";
    getJSON<AgentTraceView>(`/api/agents/${agentId}/traces/${traceId}${qs}`)
      .then((view) => alive && setLoaded((l) => ({ view, n: (l?.n ?? 0) + 1 })))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // Re-fetch when the reviewer changes so "my label" is theirs; typing the name shouldn't refetch per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, traceId, nonce]);

  if (loadError) return <Callout tone="red" title="Couldn't load this trace">{loadError}</Callout>;
  if (!loaded) return <p className="text-sm text-slate-500">Loading…</p>;
  // A fresh screen per load: the form starts from what this reviewer saved.
  return (
    <ReviewScreen
      key={loaded.n}
      agentId={agentId}
      traceId={traceId}
      view={loaded.view}
      name={name}
      setName={setName}
      allDone={allDone}
      onSaved={(done) => {
        if (done) setAllDone(true);
        setNonce((n) => n + 1);
      }}
    />
  );
}

const formOf = (v: AgentTraceView): Form => {
  const mine = v.my_annotation;
  return mine
    ? { task_outcome: mine.task_outcome, notes: mine.notes, first_failure: mine.first_failure ?? "", failure_type: mine.failure_type ?? "", severity: mine.severity, judge_label: mine.judge_label }
    : EMPTY;
};

function ReviewScreen({
  agentId,
  traceId,
  view,
  name,
  setName,
  allDone,
  onSaved,
}: {
  agentId: string;
  traceId: string;
  view: AgentTraceView;
  name: string;
  setName: (v: string) => void;
  allDone: boolean;
  onSaved: (allDone: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => formOf(view));
  const [saved, setSaved] = useState(Boolean(view.my_annotation));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const firstFailureRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const reviewer = name.trim();

  const { trace, test_case: tc, queue } = view;
  const idx = queue.items.findIndex((i) => i.trace_id === traceId);
  const prev = idx > 0 ? queue.items[idx - 1] : null;
  const next = idx >= 0 && idx < queue.items.length - 1 ? queue.items[idx + 1] : null;
  const nextMine = nextForMe(queue.items, traceId);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };
  const choose = (o: Outcome) => {
    setForm((f) => (o === "fail" ? { ...f, task_outcome: o } : { ...f, task_outcome: o, first_failure: "", failure_type: "", severity: null }));
    setSaved(false);
    // Straight to the one thing each choice needs written down.
    setTimeout(() => (o === "fail" ? firstFailureRef.current : o === "unsure" ? notesRef.current : null)?.focus(), 0);
  };
  const fail = form.task_outcome === "fail";
  const unsure = form.task_outcome === "unsure";
  const canSave = Boolean(reviewer && form.task_outcome && (!fail || (form.first_failure.trim() && form.severity)) && (!unsure || form.notes.trim()));
  const go = (t: { trace_id: string } | null) => t && router.push(`/agents/${agentId}/traces/${t.trace_id}`);

  async function save(goNext: boolean) {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trace_id: traceId,
          reviewer,
          task_outcome: form.task_outcome,
          notes: form.notes,
          first_failure: fail ? form.first_failure : null,
          failure_type: fail ? form.failure_type || null : null,
          severity: fail ? form.severity : null,
          judge_label: form.judge_label,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${body.error ?? `Save failed (${res.status})`}${Array.isArray(body.details) ? `: ${body.details.join("; ")}` : ""}`);
      setSaved(true);
      if (goNext && nextMine) router.push(`/agents/${agentId}/traces/${nextMine.trace_id}`);
      else onSaved(goNext);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function act(a: ReviewAction) {
    switch (a.type) {
      case "outcome":
        return choose(a.value);
      case "severity":
        return set("severity", a.value);
      case "judge":
        return set("judge_label", a.value);
      case "save":
        return void save(true);
      case "go":
        return void go(a.to === "next" ? next : prev);
      case "help":
        return setHelp((h) => !h);
      case "leave_field":
        return (document.activeElement as HTMLElement | null)?.blur();
    }
  }
  // Keyboard shortcuts (reviewKeys.ts). Re-subscribed on each render, so the handler always sees the current form.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = reviewKeyAction(
        { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, inField: isField(e.target), onControl: isControl(e.target) },
        { failing: fail, hasJudge: Boolean(view.agent.judge) },
      );
      if (!action) return;
      e.preventDefault();
      act(action);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });



  const others = view.annotations.filter((a) => a.reviewer !== reviewer);
  const disagree = saved && form.task_outcome !== "unsure" && others.some((a) => a.task_outcome !== "unsure" && a.task_outcome !== form.task_outcome);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <Link href={`/agents/${agentId}#review`} className="text-sky-700 hover:underline">
          ← {view.agent.name}
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">
            Answer {idx + 1} of {queue.items.length}
          </span>
          <Button variant="secondary" disabled={!prev} onClick={() => go(prev)} title="Previous answer (K or ←)">
            ← Prev
          </Button>
          <Button variant="secondary" disabled={!next} onClick={() => go(next)} title="Next answer (J or →)">
            Next →
          </Button>
        </div>
      </div>
      <ReviewProgress progress={queue.progress} label={trace.agent_version} showMine={Boolean(reviewer)} className="mb-3" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">
          Case <span className="font-mono">{trace.case_id}</span>
        </h1>
        {tc && <SplitBadge split={tc.split} />}
        <MockBadge mode={trace.execution_mode} />
        {trace.data_origin === "example" && <ExampleBadge />}
        <Badge>{trace.agent_version}</Badge>
        {trace.model_id && <Badge>{trace.model_id}</Badge>}
        {trace.latency_ms !== null && <Badge>{Math.round(trace.latency_ms)} ms</Badge>}
        {trace.cost_usd !== null && <Badge>{fmtUsd(trace.cost_usd, 4)}</Badge>}
        <span className="text-xs text-slate-500" title="When the agent produced this trace">
          {fmtDateTime(trace.timestamp)}
        </span>
      </div>
      {tc?.notes && <p className="-mt-2 mb-3 text-sm text-slate-600">What this case tests: {tc.notes}</p>}
      {allDone && (
        <Callout tone="blue" title="You've marked every answer in this test">
          Thank you. <Link href={`/agents/${agentId}#review`} className="underline">Back to {view.agent.name}</Link> to see the verdict, or ask a teammate to review the
          same answers so you can see how often you agree.
        </Callout>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {trace.execution_error && (
            <Callout tone="red" title="The agent call failed">
              {trace.execution_error}
            </Callout>
          )}
          <Card title="Input">
            <Pretty value={trace.input} />
          </Card>
          <Card title="Output">
            <Pretty value={trace.output} className="bg-white text-sm" />
          </Card>
          <Card title={`Evidence the agent was given (${trace.evidence.length})`}>
            {trace.evidence.length === 0 ? (
              <p className="text-sm text-slate-500">None recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {trace.evidence.map((e) => (
                  <li key={e.id}>
                    <span className="mr-2 rounded bg-slate-100 px-1 font-mono text-xs">{e.id}</span>
                    {e.text}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {trace.tool_calls.length > 0 && (
            <Card title={`Tool calls (${trace.tool_calls.length})`}>
              <Pretty value={trace.tool_calls} />
            </Card>
          )}
          {tc?.expected !== undefined && (
            <details className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
              <summary className="cursor-pointer text-slate-600">Expected (from cases.jsonl)</summary>
              <Pretty value={tc.expected} className="mt-2" />
            </details>
          )}
          {Object.keys(trace.metadata).length > 0 && (
            <details className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
              <summary className="cursor-pointer text-slate-600">Metadata</summary>
              <Pretty value={trace.metadata} className="mt-2" />
            </details>
          )}
        </div>

        <div className="space-y-4">
          <Card
            title="Your review"
            subtitle="Judge the answer as your user would. Automated results and other reviewers appear after you save."
            actions={
              <button type="button" onClick={() => setHelp((h) => !h)} className="text-xs text-sky-700 hover:underline" aria-expanded={help}>
                Shortcuts (?)
              </button>
            }
          >
            <div className="space-y-3 text-sm">
              {help && (
                <table className="w-full rounded border border-slate-200 bg-slate-50 text-xs">
                  <tbody>
                    {SHORTCUTS.filter(([, , judgeOnly]) => !judgeOnly || view.agent.judge).map(([keys, what]) => (
                      <tr key={keys}>
                        <td className="whitespace-nowrap px-2 py-0.5 font-mono font-semibold">{keys}</td>
                        <td className="px-2 py-0.5 text-slate-600">{what}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <NameField name={name} setName={setName} />
              <div className="flex gap-2">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    data-choice
                    onClick={() => choose(o.value)}
                    aria-pressed={form.task_outcome === o.value}
                    title={`Press ${o.key}`}
                    className={cx("flex-1 rounded-md px-2 py-2 font-semibold ring-1 ring-inset", form.task_outcome === o.value ? o.on : "bg-white text-slate-700 ring-slate-300")}
                  >
                    {o.label}
                    <span className={cx("ml-1 text-[10px] font-normal", form.task_outcome === o.value ? "text-white/80" : "text-slate-400")}>{o.key}</span>
                  </button>
                ))}
              </div>
              {fail && (
                <>
                  <label className="block">
                    <span className="text-slate-600">First thing that went wrong</span>
                    <textarea ref={firstFailureRef} value={form.first_failure} onChange={(e) => set("first_failure", e.target.value)} rows={2} className={cx(inputCls, "mt-1 w-full")} />
                  </label>
                  <label className="block">
                    <span className="text-slate-600">Failure type (reuse a name to group)</span>
                    <input value={form.failure_type} onChange={(e) => set("failure_type", e.target.value)} list="failure-types" placeholder="e.g. missed hand-off" className={cx(inputCls, "mt-1 w-full")} />
                    <datalist id="failure-types">
                      {view.failure_types.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </label>
                  <div>
                    <span className="text-slate-600">Severity</span>
                    <div className="mt-1 flex gap-1.5">
                      {(["critical", "major", "minor"] as const).map((s, i) => (
                        <button
                          key={s}
                          type="button"
                          data-choice
                          onClick={() => set("severity", s)}
                          aria-pressed={form.severity === s}
                          title={`Press ${i + 1}`}
                          className={cx("rounded px-2 py-1 text-xs font-medium ring-1 ring-inset", form.severity === s ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300")}
                        >
                          {s} <span className="opacity-60">{i + 1}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {view.agent.judge && (
                <div>
                  <span className="text-slate-600">{view.agent.judge.question}</span>
                  <div className="mt-1 flex gap-1.5">
                    {(
                      [
                        ["present", "Yes", "Y"],
                        ["absent", "No", "N"],
                        ["not_assessed", "Skip", "S"],
                      ] as const
                    ).map(([v, l, k]) => (
                      <button
                        key={v}
                        type="button"
                        data-choice
                        onClick={() => set("judge_label", v)}
                        aria-pressed={form.judge_label === v}
                        title={`Press ${k}`}
                        className={cx("rounded px-2 py-1 text-xs font-medium ring-1 ring-inset", form.judge_label === v ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300")}
                      >
                        {l} <span className="opacity-60">{k}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Your answer is the reference the judge is measured against.</p>
                </div>
              )}
              <label className="block">
                <span className={cx(unsure ? "font-medium text-amber-900" : "text-slate-600")}>{unsure ? "What makes it unclear? (needed, so someone can settle it)" : "Notes (optional)"}</span>
                <textarea
                  ref={notesRef}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={2}
                  placeholder={unsure ? "e.g. The policy doesn't say whether a 31-day-old order can be refunded." : undefined}
                  className={cx(inputCls, "mt-1 w-full")}
                />
              </label>
              {unsure && <p className="text-xs text-amber-800">“Not sure” doesn&apos;t count as a review: the answer still needs someone to decide pass or fail. Unclear cases are often a gap in what “good” means.</p>}
              <div className="flex gap-2">
                <Button disabled={busy || !canSave} onClick={() => save(true)} title="Enter, or Ctrl/⌘ Enter from a text field">
                  {nextMine ? "Save & next" : "Save"} <span className="ml-1 text-[10px] opacity-70">Enter</span>
                </Button>
                <Button variant="secondary" disabled={busy || !canSave} onClick={() => save(false)}>
                  Save, stay here
                </Button>
              </div>
              {!reviewer && <p className="text-xs text-slate-500">Enter your name to save: every review is attributed to a person.</p>}
              {saved && <p className="text-xs text-emerald-700">Saved as {reviewer}.</p>}
              <ErrorList error={error} />
            </div>
          </Card>

          {saved ? (
            <>
              {others.length > 0 && (
                <Card title="Other reviewers">
                  {disagree && (
                    <Callout tone="amber" title="You disagree">
                      Talk it through: a disagreement usually means what “good” looks like here isn&apos;t written down yet. Until you agree, the fail counts.
                    </Callout>
                  )}
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {others.map((a) => (
                      <li key={a.annotation_id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{a.reviewer}</span>
                          <Badge tone={a.task_outcome === "pass" ? "green" : a.task_outcome === "fail" ? "red" : "amber"}>{a.task_outcome === "unsure" ? "not sure" : a.task_outcome}</Badge>
                          {a.severity && <SeverityBadge severity={a.severity} />}
                        </div>
                        {(a.first_failure || a.notes) && <div className="ml-1 text-xs text-slate-600">{a.first_failure ?? a.notes}</div>}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card title="You vs automated checks">
                <ul className="space-y-1.5 text-sm">
                  {view.evaluation.results.map((r) => {
                    const d = view.checks.find((c) => c.evaluator_id === r.evaluator_id);
                    return (
                      <li key={r.evaluator_id}>
                        <div className="flex items-center gap-2">
                          <OutcomeBadge outcome={r.outcome} />
                          <span className="font-mono text-xs">{r.evaluator_id}</span>
                          <SeverityBadge severity={r.severity} />
                        </div>
                        <div className="ml-1 text-xs text-slate-600">{r.summary}</div>
                        {r.outcome === "FAIL" && d?.fix_hint && <div className="ml-1 text-xs text-slate-500">Fix: {d.fix_hint}</div>}
                      </li>
                    );
                  })}
                  {view.evaluation.results.length === 0 && <li className="text-slate-500">No code checks configured.</li>}
                </ul>
                {view.agent.judge && (
                  <div className="mt-3 border-t border-slate-100 pt-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Judge</span>
                      {view.judge_current ? (
                        <>
                          <OutcomeBadge outcome={view.judge_current.verdict} />
                          <MockBadge mode={view.judge_current.execution_mode} />
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">not run on this trace</span>
                      )}
                    </div>
                    {view.judge_current?.explanation && <p className="mt-1 text-xs text-slate-600">{view.judge_current.explanation}</p>}
                    {view.judge_current?.error && <p className="mt-1 text-xs text-purple-700">{view.judge_current.error}</p>}
                  </div>
                )}
              </Card>
            </>
          ) : (
            <Card title="Automated checks and other reviewers">
              <p className="text-sm text-slate-500">Hidden until you save your review, so they don&apos;t anchor your judgement.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
