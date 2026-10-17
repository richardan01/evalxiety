"use client";

/** "Your agents": every agent folder found under agents/, its status, and how to add your own. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { Badge, Callout, Card, EmptyState, ExampleBadge, PageHeader, StatusPill } from "@/components/ui";
import type { AgentsListView } from "./types";

export function AgentsHome() {
  const [view, setView] = useState<AgentsListView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getJSON<AgentsListView>("/api/agents")
      .then((v) => alive && setView(v))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Your agents"
        question="Evaluate any agent: import its runs, or let Evalxiety call it over HTTP."
        info={
          <>
            Each agent is a folder: <code>agents/&lt;id&gt;/agent.json</code> (checks, judge question, optional HTTP endpoint) and{" "}
            <code>cases.jsonl</code> (test cases). The built-in pricing agent lives in the other tabs.
          </>
        }
      />
      {error && <Callout tone="red" title="Couldn't load agents">{error}</Callout>}
      {view && view.problems.length > 0 && (
        <Callout tone="red" title="Some agent folders have problems">
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {view.problems.map((p, i) => (
              <li key={i}>
                <code>
                  agents/{p.agent_id}/{p.file}
                  {p.line ? `:${p.line}` : ""}
                </code>{" "}
                — {p.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {view?.agents.map((a) => (
          <Link key={a.agent_id} href={`/agents/${a.agent_id}`} className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-400">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{a.name}</span>
                  {a.example && <ExampleBadge />}
                </div>
                <div className="mt-0.5 font-mono text-xs text-slate-500">agents/{a.agent_id}</div>
              </div>
              {a.status && <StatusPill status={a.status} approvedLabel="Approved" />}
            </div>
            {a.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{a.description}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge>{a.cases} cases</Badge>
              <Badge>{a.checks} code checks</Badge>
              <Badge>{a.runs} runs</Badge>
              <Badge>{a.reviewed} reviewed</Badge>
              {a.has_connection && <Badge tone="blue">HTTP</Badge>}
              {a.has_judge && <Badge tone="purple">judge</Badge>}
            </div>
          </Link>
        ))}
      </div>
      {view && view.agents.length === 0 && view.problems.length === 0 && (
        <EmptyState title="No agents yet">
          No folders found in <code>{view.agents_dir}</code>. Copy the blank template there to begin: <code>cp -r agents/_template {view.agents_dir}/my-agent</code>.
        </EmptyState>
      )}
      <Card title="Add your own agent" subtitle="About 15 minutes for a first import" className="mt-6">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            Copy the blank template: <code>cp -r agents/_template agents/my-agent</code>, and name it in <code>agent.json</code>. (Don&apos;t copy the starter
            kit: its checks, judge and URL are for the toy bot.)
          </li>
          <li>
            Replace <code>cases.jsonl</code> with 10–30 real questions your agent gets, one per line:{" "}
            <code>{`{"case_id": "q1", "input": {...}, "expected": {...}}`}</code>. Mark a few <code>&quot;split&quot;: &quot;heldout&quot;</code> for the
            final check.
          </li>
          <li>
            Get traces in, either way:
            <ul className="mt-1 list-disc pl-5">
              <li>
                <b>Import</b>: edit <code>run-my-agent.mjs</code> to call your agent, run it, and upload the JSONL file it writes (one line per case:{" "}
                <code>{`{"case_id": "q1", "output": ..., "evidence": [{"id","text"}]}`}</code>).
              </li>
              <li>
                <b>HTTP</b>: add a <code>{`"connection": {"type": "http", "url": "..."}`}</code> block; after you confirm, Evalxiety POSTs{" "}
                <code>{`{"case_id", "input"}`}</code> and records the reply.
              </li>
            </ul>
          </li>
          <li>Review at least 10 traces by hand, name the failure types you see, then turn the objective ones into code checks.</li>
          <li>
            Import (or run) your change as the candidate and review enough to see whether it helped. When you&apos;re done tuning, reveal the held-out cases,
            re-run both versions, review every trace of that final candidate run, then read the gate.
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          Full guide: <code>docs/use-your-agent.md</code>. Check a file offline first: <code>npm run validate -- my-agent traces.jsonl</code>.
        </p>
      </Card>
    </div>
  );
}
