"use client";

/**
 * The answer first, in plain words: can the new version ship, what changed, and what's still needed. Everything here
 * is the release gate below, reworded; nothing is decided differently.
 */
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, cx, InfoTip } from "@/components/ui";
import { GlossaryList, Term } from "@/components/Term";
import { ANCHOR, type PlainItem, type PlainTone, type PlainWhere } from "@/lib/agents/plain";
import { reportMarkdown, selectedRuns, verdictOf } from "@/lib/agents/report";
import type { AgentOverview } from "../types";

const TONE: Record<PlainTone, { box: string; title: string; dot: string }> = {
  red: { box: "border-rose-300 bg-rose-50", title: "text-rose-950", dot: "bg-rose-600" },
  amber: { box: "border-amber-300 bg-amber-50", title: "text-amber-950", dot: "bg-amber-500" },
  blue: { box: "border-sky-300 bg-sky-50", title: "text-sky-950", dot: "bg-sky-600" },
  green: { box: "border-emerald-300 bg-emerald-50", title: "text-emerald-950", dot: "bg-emerald-600" },
  slate: { box: "border-slate-300 bg-slate-50", title: "text-slate-900", dot: "bg-slate-500" },
};

const ACTION: Record<Exclude<PlainWhere, null>, string> = {
  review: "Start reviewing",
  "add-run": "Add a test",
  runs: "See tests",
  cases: "See test cases",
  rules: "See rules",
  approve: "Decide",
};

export function query(view: AgentOverview): string {
  const qs = new URLSearchParams();
  if (view.selected.candidate) qs.set("candidate", view.selected.candidate);
  qs.set("baseline", view.selected.baseline ?? "none");
  return `?${qs.toString()}`;
}

function CaseLinks({ ids, traces, agentId }: { ids: string[]; traces: Map<string, string>; agentId: string }) {
  if (!ids.length) return null;
  return (
    <span className="ml-1 font-mono text-xs text-slate-500">
      {ids.slice(0, 8).map((id, i) => (
        <span key={id}>
          {i > 0 && ", "}
          {traces.get(id) ? (
            <Link href={`/agents/${agentId}/traces/${traces.get(id)}`} className="text-sky-700 hover:underline">
              {id}
            </Link>
          ) : (
            id
          )}
        </span>
      ))}
      {ids.length > 8 && "…"}
    </span>
  );
}

function ItemList({ title, items, tone, view, traces, reviewHref }: { title: string; items: PlainItem[]; tone: "red" | "amber" | "slate"; view: AgentOverview; traces: Map<string, string>; reviewHref: string | null }) {
  if (!items.length) return null;
  const dot = { red: "bg-rose-600", amber: "bg-amber-500", slate: "bg-slate-400" }[tone];
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="space-y-2 text-sm">
        {items.map((it, i) => {
          const href = it.where === "review" ? reviewHref : it.where ? `#${ANCHOR[it.where]}` : null;
          return (
            <li key={`${it.code}-${i}`} className="flex gap-2">
              <span aria-hidden className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot)} />
              <span className="text-slate-800">
                {it.text}
                <CaseLinks ids={it.case_ids} traces={traces} agentId={view.agent.agent_id} />
                {href && it.where && (
                  <>
                    {" "}
                    <Link href={href} className="whitespace-nowrap text-xs font-medium text-sky-700 hover:underline">
                      {ACTION[it.where]} →
                    </Link>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function VerdictCard({ view }: { view: AgentOverview }) {
  const v = verdictOf(view);
  const t = TONE[v.tone];
  const { candidate, baseline } = selectedRuns(view);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  // Link each case to the new version's answer, so every sentence can be checked against the evidence.
  const traces = new Map(Object.entries(candidate?.trace_ids ?? {}));
  const firstOpen = view.gate.unresolved_reviews[0]?.trace_id ?? Object.values(candidate?.trace_ids ?? {})[0] ?? null;
  const reviewHref = firstOpen ? `/agents/${view.agent.agent_id}/traces/${firstOpen}` : "#review";
  const lockedCount = view.cases.filter((c) => c.locked).length;

  const copy = () => {
    navigator.clipboard.writeText(reportMarkdown(view)).then(
      () => setCopied("copied"),
      () => setCopied("failed"),
    );
    setTimeout(() => setCopied("idle"), 1800);
  };

  return (
    <section className={cx("rounded-xl border p-5 shadow-sm", t.box)} aria-label="Release verdict">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden className={cx("h-2.5 w-2.5 rounded-full", t.dot)} />
            <h2 className={cx("text-lg font-semibold", t.title)}>{v.headline}</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-700">{v.summary}</p>
          <p className="mt-2 text-sm text-slate-600">
            {candidate ? (
              <>
                <Term k="candidate">New version</Term> <b className="text-slate-900">{candidate.agent_version}</b>
                {baseline ? (
                  <>
                    {" "}
                    compared with <Term k="baseline">current version</Term> <b className="text-slate-900">{baseline.agent_version}</b>
                  </>
                ) : (
                  <>, not compared with anything yet</>
                )}
                , on {view.cases.length} <Term k="case">test cases</Term>
                {lockedCount > 0 && (
                  <>
                    {" "}
                    ({lockedCount} still locked as <Term k="heldout">final-exam cases</Term>)
                  </>
                )}
                .
              </>
            ) : (
              <>Nothing tested yet.</>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/agents/${view.agent.agent_id}/report${query(view)}`}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Release report
          </Link>
          <Button variant="secondary" onClick={copy} title="Copy the report as text for a doc, email or Slack">
            {copied === "copied" ? "Copied ✓" : copied === "failed" ? "Copy failed" : "Copy summary"}
          </Button>
        </div>
      </div>

      {v.changes && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={v.changes.fixed.length ? "green" : "neutral"}>{v.changes.fixed.length} fixed</Badge>
          <Badge tone={v.changes.got_worse.length ? "red" : "neutral"}>
            {v.changes.got_worse.length} <Term k="regression">got worse</Term>
          </Badge>
          <Badge tone={v.changes.still_failing.length ? "amber" : "neutral"}>{v.changes.still_failing.length} still failing</Badge>
          <Badge>{v.changes.still_passing} unchanged and passing</Badge>
          {v.changes.incomplete.length > 0 && <Badge tone="purple">{v.changes.incomplete.length} can&apos;t compare</Badge>}
        </div>
      )}
      {v.changes && v.changes.got_worse.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-slate-800">
          {v.changes.got_worse.map((g) => (
            <li key={g.case_id}>
              <CaseLinks ids={[g.case_id]} traces={traces} agentId={view.agent.agent_id} /> now fails{" "}
              {g.rules.length ? g.rules.map((r) => `“${r}”`).join(", ") : "a rule it passed before"}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 border-t border-black/5 pt-4 md:grid-cols-3">
        <ItemList title="Must fix before shipping" items={v.blockers} tone="red" view={view} traces={traces} reviewHref={reviewHref} />
        <ItemList title="Still needed before a decision" items={v.todo} tone="amber" view={view} traces={traces} reviewHref={reviewHref} />
        <ItemList title={view.agent.example ? "Worth knowing (and what a real release would block)" : "Worth knowing"} items={v.notes} tone="slate" view={view} traces={traces} reviewHref={reviewHref} />
        {!v.blockers.length && !v.todo.length && !v.notes.length && <p className="text-sm text-slate-600 md:col-span-3">Nothing is missing or failing.</p>}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        What do these words mean?
        <InfoTip label="Words used on this page">
          <GlossaryList keys={["candidate", "baseline", "case", "trace", "check", "pass_all", "regression", "heldout", "judge", "gate"]} />
        </InfoTip>
      </div>
    </section>
  );
}
