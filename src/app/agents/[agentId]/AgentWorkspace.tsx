"use client";

/**
 * One agent's workspace: release gate first (the answer), then the steps that feed it — add runs, compare,
 * review, checks, judge, cases. The candidate/baseline selection lives in the URL so links are shareable.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { getJSON } from "@/lib/client/api";
import { Button, Callout, ExampleBadge, PageHeader, StatusPill } from "@/components/ui";
import { AddRun } from "./AddRun";
import { CasesCard, ChecksCard, CompareCard, GateCard, JudgeCard, ReviewCard, RunsCard } from "./sections";
import type { AgentOverview } from "../types";

export interface Selection {
  candidate: string;
  baseline: string;
}

function query(sel: Selection): string {
  const qs = new URLSearchParams();
  if (sel.candidate) qs.set("candidate", sel.candidate);
  if (sel.baseline) qs.set("baseline", sel.baseline);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function AgentWorkspace({ agentId, candidate, baseline }: { agentId: string } & Selection) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; view: AgentOverview | null; error: string | null } | null>(null);
  const url = `/api/agents/${agentId}${query({ candidate, baseline })}`;
  const key = `${url}#${nonce}`;

  useEffect(() => {
    let alive = true;
    getJSON<AgentOverview>(url)
      .then((view) => alive && setResult({ key, view, error: null }))
      .catch((e: unknown) => alive && setResult({ key, view: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [url, key]);

  const view = result?.view ?? null;
  const loading = result?.key !== key || navigating;
  const running = view?.runs.some((r) => r.status === "running") ?? false;

  // While an HTTP run is in progress, refresh every 2 s so traces appear as they land.
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setNonce((n) => n + 1), 2000);
    return () => clearTimeout(t);
  }, [running, nonce]);

  const refresh = () => setNonce((n) => n + 1);
  const select = (next: Selection) => startNav(() => router.replace(`/agents/${agentId}${query(next)}`, { scroll: false }));

  if (result?.error && !view) {
    return (
      <div>
        <PageHeader title={agentId} question="Agent" />
        <Callout tone="red" title="Couldn't load this agent">
          {result.error}
        </Callout>
        <p className="mt-3 text-sm">
          <Link href="/agents" className="text-sky-700 hover:underline">
            ← All agents
          </Link>
        </p>
      </div>
    );
  }
  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <div className="mb-1 text-xs">
        <Link href="/agents" className="text-sky-700 hover:underline">
          ← Your agents
        </Link>
      </div>
      <PageHeader
        title={view.agent.name}
        question={
          <span className="flex items-center gap-2">
            <code className="text-xs">agents/{view.agent.agent_id}</code>
            {view.agent.example && <ExampleBadge />}
          </span>
        }
        info={view.agent.description || undefined}
        action={
          <div className="flex items-center gap-2">
            {loading && <span className="text-xs text-slate-500">Updating…</span>}
            <StatusPill status={view.gate.status} approvedLabel="Approved" />
            <Button variant="secondary" onClick={refresh} disabled={loading}>
              Re-check
            </Button>
          </div>
        }
      />
      {view.agent.example && (
        <Callout tone="amber" title="This is the starter kit">
          Its traces come from a toy rule-based bot, so the gate will never say &quot;Ready&quot;. Use it to learn the flow, then start your own agent from the
          blank template: <code>cp -r agents/_template agents/my-agent</code>. Don&apos;t copy this folder: its checks, judge and URL are for the toy bot.
        </Callout>
      )}
      <div className="mt-4 space-y-4">
        <GateCard view={view} url={{ candidate, baseline }} onSelect={select} onChanged={refresh} />
        <AddRun view={view} onDone={refresh} />
        <RunsCard view={view} url={{ candidate, baseline }} onSelect={select} onChanged={refresh} />
        <CompareCard view={view} />
        <ReviewCard view={view} />
        <ChecksCard view={view} />
        <JudgeCard view={view} onChanged={refresh} />
        <CasesCard view={view} onChanged={refresh} />
      </div>
    </div>
  );
}
