"use client";

/**
 * One-page release report for people who weren't in the tool. Prints cleanly (the app's sidebar, banner and guide are
 * hidden on paper) and copies or downloads as text. Built from the same overview, and carrying the same evidence
 * fingerprint, as the agent page.
 */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/client/api";
import { Button, Callout, StatusPill, cx, fmtDateTime } from "@/components/ui";
import type { PlainItem } from "@/lib/agents/plain";
import { judgeLine, reportMarkdown, selectedRuns, verdictOf } from "@/lib/agents/report";
import type { AgentOverview, RunRow } from "../../types";

function query(candidate: string, baseline: string): string {
  const qs = new URLSearchParams();
  if (candidate) qs.set("candidate", candidate);
  if (baseline) qs.set("baseline", baseline);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-slate-200 pt-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="text-sm text-slate-800">{children}</div>
    </section>
  );
}

function Items({ items }: { items: PlainItem[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((i, n) => (
        <li key={`${i.code}-${n}`}>
          {i.text}
          {i.case_ids.length > 0 && <span className="ml-1 font-mono text-xs text-slate-500">({i.case_ids.slice(0, 12).join(", ")}{i.case_ids.length > 12 ? ", …" : ""})</span>}
        </li>
      ))}
    </ul>
  );
}

function RunText({ run }: { run: RunRow | null }) {
  if (!run) return <span className="text-slate-500">none yet</span>;
  return (
    <>
      <b>{run.agent_version}</b>, tested {fmtDateTime(run.created_at)} by {run.created_by} ({run.execution_mode === "http" ? "called over HTTP" : "imported from a file"}),{" "}
      {run.summary.n_with_trace} of {run.summary.n_cases} cases answered
    </>
  );
}

const pct = (v: number | null) => (v === null ? "undefined" : `${(v * 100).toFixed(0)}%`);

export function ReleaseReport({ agentId, candidate, baseline }: { agentId: string; candidate: string; baseline: string }) {
  const [view, setView] = useState<AgentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const qs = query(candidate, baseline);

  useEffect(() => {
    let alive = true;
    getJSON<AgentOverview>(`/api/agents/${agentId}${qs}`)
      .then((v) => alive && setView(v))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [agentId, qs]);

  if (error) return <Callout tone="red" title="Couldn't build the report">{error}</Callout>;
  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;

  const v = verdictOf(view);
  const runs = selectedRuns(view);
  const generated = new Date();
  const heldout = view.cases.filter((c) => c.split === "heldout").length;
  const latest = view.frozen.versions[view.frozen.versions.length - 1];
  const approval = view.gate.latest_approval;

  const copy = () => {
    navigator.clipboard.writeText(reportMarkdown(view, generated)).then(
      () => setCopied("copied"),
      () => setCopied("failed"),
    );
    setTimeout(() => setCopied("idle"), 1800);
  };
  const download = () => {
    const blob = new Blob([reportMarkdown(view, generated)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `release-report-${view.agent.agent_id}-${generated.toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/agents/${agentId}${qs}`} className="text-xs text-sky-700 hover:underline">
          ← Back to {view.agent.name}
        </Link>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={copy} title="Copy as text for a doc, email or Slack">
            {copied === "copied" ? "Copied ✓" : copied === "failed" ? "Copy failed" : "Copy as text"}
          </Button>
          <Button variant="secondary" onClick={download}>
            Download (.md)
          </Button>
          <Button onClick={() => window.print()}>Print or save as PDF</Button>
        </div>
      </div>

      <article className="space-y-5 rounded-lg border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header>
          <div className="text-xs uppercase tracking-wide text-slate-500">Release report</div>
          <h1 className="mt-0.5 text-2xl font-semibold text-slate-900">{view.agent.name}</h1>
          {view.agent.description && <p className="mt-1 text-sm text-slate-600">{view.agent.description}</p>}
          <p className="mt-1 text-xs text-slate-500">Generated {fmtDateTime(generated.toISOString())} by Evalxiety</p>
        </header>

        {view.agent.example && (
          <Callout tone="amber">Practice data from the starter kit. It shows how the decision works; it is not evidence about a real agent.</Callout>
        )}

        <section className={cx("rounded-lg border p-4", v.tone === "red" ? "border-rose-300 bg-rose-50" : v.tone === "green" ? "border-emerald-300 bg-emerald-50" : v.tone === "blue" ? "border-sky-300 bg-sky-50" : v.tone === "slate" ? "border-slate-300 bg-slate-50" : "border-amber-300 bg-amber-50")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{v.headline}</h2>
            <StatusPill status={view.gate.status} approvedLabel="Approved" />
          </div>
          <p className="mt-1 text-sm text-slate-700">{v.summary}</p>
        </section>

        <Section title="What was compared">
          <ul className="space-y-1">
            <li>
              New version: <RunText run={runs.candidate} />
            </li>
            <li>
              Current version: <RunText run={runs.baseline} />
            </li>
          </ul>
        </Section>

        <Section title="Results">
          {runs.candidate ? (
            <p>
              Passed every rule: new version <b>{runs.candidate.summary.pass_all_count}</b> of {runs.candidate.summary.n_cases} ({pct(runs.candidate.summary.pass_all_rate)})
              {runs.baseline && (
                <>
                  , current version <b>{runs.baseline.summary.pass_all_count}</b> of {runs.baseline.summary.n_cases} ({pct(runs.baseline.summary.pass_all_rate)})
                </>
              )}
              . The bar is {pct(view.agent.pass_all_threshold)}.
            </p>
          ) : (
            <p className="text-slate-500">No new version tested yet.</p>
          )}
          {v.changes && (
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="w-40 py-1 font-medium text-emerald-800">Fixed</td>
                  <td className="py-1">
                    {v.changes.fixed.length} <span className="font-mono text-xs text-slate-500">{v.changes.fixed.join(", ")}</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-1 font-medium text-rose-800">Got worse</td>
                  <td className="py-1">
                    {v.changes.got_worse.length}
                    {v.changes.got_worse.map((g) => (
                      <div key={g.case_id} className="text-xs text-slate-600">
                        <span className="font-mono">{g.case_id}</span> now fails {g.rules.map((r) => `“${r}”`).join(", ") || "a rule it passed before"}
                      </div>
                    ))}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 font-medium text-amber-800">Still failing</td>
                  <td className="py-1">
                    {v.changes.still_failing.length} <span className="font-mono text-xs text-slate-500">{v.changes.still_failing.join(", ")}</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-1 font-medium text-slate-700">Unchanged and passing</td>
                  <td className="py-1">{v.changes.still_passing}</td>
                </tr>
                {v.changes.incomplete.length > 0 && (
                  <tr>
                    <td className="py-1 font-medium text-violet-800">Can&apos;t compare</td>
                    <td className="py-1 font-mono text-xs">{v.changes.incomplete.join(", ")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Section>

        {v.blockers.length > 0 && (
          <Section title="Must fix before shipping">
            <Items items={v.blockers} />
          </Section>
        )}
        {v.todo.length > 0 && (
          <Section title="Still needed before a decision">
            <Items items={v.todo} />
          </Section>
        )}
        {v.notes.length > 0 && (
          <Section title="Worth knowing">
            <Items items={v.notes} />
          </Section>
        )}

        <Section title="Human review">
          <p>
            {view.reviewed_trace_count} answer{view.reviewed_trace_count === 1 ? "" : "s"} reviewed by a person (at least {view.agent.min_reviewed_traces} needed).
          </p>
          {view.failure_types.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {view.failure_types.map((f) => (
                <li key={f.name}>
                  {f.name}: {f.count}
                  {f.critical > 0 && <span className="text-rose-700"> ({f.critical} critical)</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">No problems marked yet.</p>
          )}
        </Section>

        <Section title="Rules checked on the new version">
          {view.checks.length === 0 ? (
            <p className="text-slate-500">No rules are set up.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Rule</th>
                  <th className="py-1 pr-2">Severity</th>
                  <th className="py-1 pr-2 text-right">Passed</th>
                  <th className="py-1 pr-2 text-right">Failed</th>
                  <th className="py-1 text-right">Couldn&apos;t check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {view.checks.map((d) => {
                  const t = runs.candidate?.summary.per_evaluator[d.evaluator_id];
                  return (
                    <tr key={d.evaluator_id}>
                      <td className="py-1 pr-2">{d.question}</td>
                      <td className="py-1 pr-2 text-xs">
                        {d.severity}
                        {d.blocking ? ", must pass" : ""}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{t?.pass ?? "—"}</td>
                      <td className={cx("py-1 pr-2 text-right tabular-nums", t && t.fail > 0 && "font-semibold text-rose-700")}>{t?.fail ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">{t ? t.not_applicable + t.error : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="AI reviewer">
          {view.agent.judge && <p>Question: “{view.agent.judge.question}”</p>}
          <p className="mt-1">{judgeLine(view)} It never replaces a human review.</p>
        </Section>

        <Section title="Test set">
          <p>
            {view.cases.length} test cases, {heldout} final-exam case{heldout === 1 ? "" : "s"}
            {heldout > 0 && (view.heldout.revealed && view.heldout.revealed_at ? ` (unlocked ${fmtDateTime(view.heldout.revealed_at)} by ${view.heldout.revealed_by})` : " (still locked)")}.
          </p>
          <p className="mt-1">{latest ? `Cases locked as version ${latest.version} (fingerprint ${latest.content_hash.slice(0, 12)}).` : "Cases not locked yet (the first test locks them)."}</p>
        </Section>

        <Section title="Decision">
          {approval && view.gate.approval_state !== "stale" ? (
            <p>
              <b>{approval.decision === "approved" ? "Approved" : "Rejected"}</b> by {approval.approver} on {fmtDateTime(approval.created_at)}
              {approval.notes && <>: “{approval.notes}”</>}.
            </p>
          ) : approval ? (
            <p>The last decision ({approval.decision} by {approval.approver}) was for older evidence, so it no longer applies.</p>
          ) : (
            <p>No decision yet.</p>
          )}
        </Section>

        <Section title="Evidence fingerprint">
          <p className="break-all font-mono text-xs">{view.evidence_snapshot_hash}</p>
          <p className="mt-1 text-xs text-slate-500">Any change to the tests, reviews, rules or cases changes this fingerprint. An approval only covers the fingerprint it was given for.</p>
        </Section>

        <Section title="Limits">
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
            {view.gate.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Section>
      </article>
    </div>
  );
}
