"use client";

/**
 * Review one trace of your agent. You label it first; code checks and the judge are revealed only after you save,
 * so they can't anchor your judgement (same rule as the pricing demo).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { Badge, Button, Callout, Card, cx, ExampleBadge, fmtDateTime, fmtUsd, MockBadge, OutcomeBadge, SeverityBadge, SplitBadge } from "@/components/ui";
import type { AgentTraceView } from "../../../types";
import { ErrorList, inputCls, NameField, Pretty, useName } from "../../shared";

type Severity = "critical" | "major" | "minor";
type JudgeLabel = "present" | "absent" | "not_assessed";

interface Form {
  task_outcome: "pass" | "fail" | null;
  notes: string;
  first_failure: string;
  failure_type: string;
  severity: Severity | null;
  judge_label: JudgeLabel;
}

const EMPTY: Form = { task_outcome: null, notes: "", first_failure: "", failure_type: "", severity: null, judge_label: "not_assessed" };

export function TraceReview({ agentId, traceId }: { agentId: string; traceId: string }) {
  const router = useRouter();
  const [name, setName] = useName();
  const [view, setView] = useState<AgentTraceView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reviewer = name.trim();

  useEffect(() => {
    let alive = true;
    const qs = reviewer ? `?reviewer=${encodeURIComponent(reviewer)}` : "";
    getJSON<AgentTraceView>(`/api/agents/${agentId}/traces/${traceId}${qs}`)
      .then((v) => {
        if (!alive) return;
        setView(v);
        const mine = v.my_annotation;
        if (mine) {
          setForm({
            task_outcome: mine.task_outcome,
            notes: mine.notes,
            first_failure: mine.first_failure ?? "",
            failure_type: mine.failure_type ?? "",
            severity: mine.severity,
            judge_label: mine.judge_label,
          });
          setSaved(true);
        }
      })
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // Re-fetch when the reviewer changes so "my label" is theirs; typing the name shouldn't refetch per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, traceId, nonce]);

  if (loadError) return <Callout tone="red" title="Couldn't load this trace">{loadError}</Callout>;
  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;

  const { trace, test_case: tc, queue } = view;
  const idx = queue.items.findIndex((i) => i.trace_id === traceId);
  const prev = idx > 0 ? queue.items[idx - 1] : null;
  const next = idx >= 0 && idx < queue.items.length - 1 ? queue.items[idx + 1] : null;
  const nextUnreviewed = queue.items.slice(idx + 1).find((i) => !i.reviewed) ?? queue.items.slice(0, Math.max(idx, 0)).find((i) => !i.reviewed);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };
  const fail = form.task_outcome === "fail";
  const canSave = reviewer && form.task_outcome && (!fail || (form.first_failure.trim() && form.severity));

  async function save(goNext: boolean) {
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
      if (goNext && nextUnreviewed) router.push(`/agents/${agentId}/traces/${nextUnreviewed.trace_id}`);
      else setNonce((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const reviewedCount = queue.items.filter((i) => i.reviewed).length;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <Link href={`/agents/${agentId}`} className="text-sky-700 hover:underline">
          ← {view.agent.name}
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">
            {idx + 1} of {queue.items.length} in this run · {reviewedCount} reviewed
          </span>
          <Button variant="secondary" disabled={!prev} onClick={() => prev && router.push(`/agents/${agentId}/traces/${prev.trace_id}`)}>
            ← Prev
          </Button>
          <Button variant="secondary" disabled={!next} onClick={() => next && router.push(`/agents/${agentId}/traces/${next.trace_id}`)}>
            Next →
          </Button>
        </div>
      </div>
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
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
          <Card title="Your review" subtitle="Judge the answer as your user would. Automated results appear after you save.">
            <div className="space-y-3 text-sm">
              <NameField name={name} setName={setName} />
              <div className="flex gap-2">
                {(["pass", "fail"] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => {
                      set("task_outcome", o);
                      if (o === "pass") setForm((f) => ({ ...f, task_outcome: "pass", first_failure: "", failure_type: "", severity: null }));
                    }}
                    className={cx(
                      "flex-1 rounded-md px-3 py-2 font-semibold ring-1 ring-inset",
                      form.task_outcome === o ? (o === "pass" ? "bg-emerald-600 text-white ring-emerald-600" : "bg-rose-600 text-white ring-rose-600") : "bg-white text-slate-700 ring-slate-300",
                    )}
                  >
                    {o === "pass" ? "✓ Pass" : "✕ Fail"}
                  </button>
                ))}
              </div>
              {fail && (
                <>
                  <label className="block">
                    <span className="text-slate-600">First thing that went wrong</span>
                    <textarea value={form.first_failure} onChange={(e) => set("first_failure", e.target.value)} rows={2} className={cx(inputCls, "mt-1 w-full")} />
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
                      {(["critical", "major", "minor"] as const).map((s) => (
                        <button key={s} onClick={() => set("severity", s)} className={cx("rounded px-2 py-1 text-xs font-medium ring-1 ring-inset", form.severity === s ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300")}>
                          {s}
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
                        ["present", "Yes"],
                        ["absent", "No"],
                        ["not_assessed", "Skip"],
                      ] as const
                    ).map(([v, l]) => (
                      <button key={v} onClick={() => set("judge_label", v)} className={cx("rounded px-2 py-1 text-xs font-medium ring-1 ring-inset", form.judge_label === v ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300")}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Your answer is the reference the judge is measured against.</p>
                </div>
              )}
              <label className="block">
                <span className="text-slate-600">Notes (optional)</span>
                <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={cx(inputCls, "mt-1 w-full")} />
              </label>
              <div className="flex gap-2">
                <Button disabled={busy || !canSave} onClick={() => save(true)}>
                  {nextUnreviewed ? "Save & next unreviewed" : "Save"}
                </Button>
                <Button variant="secondary" disabled={busy || !canSave} onClick={() => save(false)}>
                  Save
                </Button>
              </div>
              {saved && <p className="text-xs text-emerald-700">Saved as {reviewer}.</p>}
              <ErrorList error={error} />
            </div>
          </Card>

          {saved ? (
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
              {view.annotations.filter((a) => a.reviewer !== reviewer).length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600">
                  Other reviewers:{" "}
                  {view.annotations
                    .filter((a) => a.reviewer !== reviewer)
                    .map((a) => `${a.reviewer} (${a.task_outcome})`)
                    .join(", ")}
                </div>
              )}
            </Card>
          ) : (
            <Card title="Automated checks">
              <p className="text-sm text-slate-500">Hidden until you save your review, so they don&apos;t anchor your judgement.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
