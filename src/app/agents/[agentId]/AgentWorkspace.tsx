"use client";

/**
 * One agent's workspace: the verdict in plain words first (the answer), then the checklist behind it and the steps
 * that feed it — add tests, compare, review, rules, AI reviewer, test cases. The new/current version selection lives
 * in the URL so links are shareable. Each section has an anchor the verdict's "do this next" links point at.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { getJSON } from "@/lib/client/api";
import { Button, Callout, ExampleBadge, PageHeader, StatusPill } from "@/components/ui";
import { AddRun } from "./AddRun";
import { JudgeCard } from "./JudgeCard";
import { ChecksCard } from "./RulesCard";
import { CasesCard, CompareCard, GateCard, ReviewCard, RunsCard } from "./sections";
import { useDefinition } from "./useDefinition";
import { VerdictCard } from "./VerdictCard";
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
  // Bumped only by a person's change (not the poll while a test runs), so open editors aren't disturbed.
  const [defNonce, setDefNonce] = useState(0);
  const { def } = useDefinition(agentId, defNonce);
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

  const refresh = () => {
    setNonce((n) => n + 1);
    setDefNonce((n) => n + 1);
  };
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
          Its answers come from a toy rule-based bot, so it can never be approved. Use it to learn the flow, then{" "}
          <Link href="/agents?connect=1" className="font-medium text-amber-950 underline">
            connect your own agent
          </Link>
          . Don&apos;t copy this folder: its rules, AI reviewer and URL are for the toy bot.
        </Callout>
      )}
      <div className="mt-4 space-y-4">
        <VerdictCard view={view} />
        <div id="checklist" className="scroll-mt-4">
          <GateCard view={view} url={{ candidate, baseline }} onSelect={select} onChanged={refresh} />
        </div>
        <div id="add-run" className="scroll-mt-4">
          <AddRun view={view} onDone={refresh} />
        </div>
        <div id="runs" className="scroll-mt-4">
          <RunsCard view={view} url={{ candidate, baseline }} onSelect={select} onChanged={refresh} />
        </div>
        <div id="compare" className="scroll-mt-4">
          <CompareCard view={view} />
        </div>
        <div id="review" className="scroll-mt-4">
          <ReviewCard view={view} />
        </div>
        <div id="rules" className="scroll-mt-4">
          <ChecksCard view={view} def={def} onChanged={refresh} />
        </div>
        <div id="judge" className="scroll-mt-4">
          <JudgeCard view={view} def={def} onChanged={refresh} />
        </div>
        <div id="cases" className="scroll-mt-4">
          <CasesCard view={view} def={def} onChanged={refresh} />
        </div>
      </div>
    </div>
  );
}
