"use client";

import { REVIEW_TARGET } from "@/lib/domain/review";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/client/api";
import { Badge, Button, Callout, Card, EmptyState, MockBadge, SplitBadge, cx, fmtDateTime } from "@/components/ui";
import { firstUnreviewed, readDeferred, reviewOrder } from "./order";
import { ReviewerInput, Segmented } from "./bits";
import type { QueueItem, QueueResponse } from "./types";
import { useReviewerDraft } from "./useReviewer";

type StatusFilter = "all" | "unreviewed" | "reviewed";
type SplitFilter = "all" | "dev" | "heldout" | "custom";
type ModeFilter = "all" | "live" | "mock";

const TARGET_MIN = REVIEW_TARGET.min;
const TARGET_MAX = REVIEW_TARGET.max;

export function AnnotationQueue() {
  const router = useRouter();
  const reviewer = useReviewerDraft();
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [split, setSplit] = useState<SplitFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [config, setConfig] = useState("all");

  useEffect(() => {
    let alive = true;
    getJSON<QueueResponse>("/api/review/queue")
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const ordered = useMemo(() => (data ? reviewOrder(data.items) : []), [data]);
  const configs = useMemo(() => [...new Set(ordered.map((i) => i.trace.agent_version))].sort(), [ordered]);
  const rows = ordered
    .map((item, idx) => ({ item, position: idx + 1 }))
    .filter(({ item }) => {
      if (status === "reviewed" && !item.reviewed) return false;
      if (status === "unreviewed" && item.reviewed) return false;
      if (split === "custom" ? item.split !== null : split !== "all" && item.split !== split) return false;
      if (mode !== "all" && item.trace.execution_mode !== mode) return false;
      if (config !== "all" && item.trace.agent_version !== config) return false;
      return true;
    });

  const firstUp = data ? firstUnreviewed(data.items) : null;
  const live = ordered.filter((i) => i.trace.execution_mode === "live");
  const liveReviewed = live.filter((i) => i.reviewed).length;

  function startReviewing() {
    if (!data) return;
    const target = firstUnreviewed(data.items, readDeferred()) ?? firstUnreviewed(data.items);
    if (target) router.push(`/review/${target.trace.trace_id}`);
  }

  return (
    <Card
      title="Annotation queue — error discovery (open coding)"
      subtitle="Read each trace yourself, write down what you observe, and label it Pass or Fail. These human labels are the ground truth everything else is checked against."
    >
      {error && (
        <Callout tone="red" title="Could not load the queue">
          {error}
        </Callout>
      )}
      {!data && !error && <p className="text-sm text-slate-500">Loading the queue…</p>}

      {data && (
        <div className="space-y-4">
          {/* Progress + how-to */}
          <div className="grid gap-4 lg:grid-cols-[1fr_minmax(260px,320px)]">
            <div className="space-y-2">
              <p className="text-sm text-slate-800">
                <b className="text-lg tabular-nums">{data.reviewed_count}</b> of <b className="tabular-nums">{data.total}</b> traces
                human-reviewed · target {TARGET_MIN}–{TARGET_MAX} for this demo; remaining traces are labelled{" "}
                <Badge>UNREVIEWED</Badge>
              </p>
              <ProgressBar reviewed={data.reviewed_count} total={data.total} />
              <p className="text-xs text-slate-500">
                {progressHint(data.reviewed_count, data.total)} Live traces reviewed: {liveReviewed} of {live.length}. A trace
                counts as reviewed once any named reviewer has saved a label on it.
              </p>
              <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
                <li>
                  <b>Start reviewing</b> opens the first unreviewed trace — live, dev-split traces first.
                </li>
                <li>Read the merchant request, the agent&apos;s answer and the evidence it was given.</li>
                <li>Write what you observe, label Pass/Fail, then save. Automated checks unlock only after you save.</li>
              </ol>
            </div>
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
              <label htmlFor="queue-reviewer" className="block text-xs font-medium text-slate-600">
                Reviewing as
              </label>
              <ReviewerInput
                id="queue-reviewer"
                value={reviewer.value}
                onChange={reviewer.setValue}
                onCommit={reviewer.commit}
              />
              <p className="text-[11px] text-slate-500">Every saved label carries this name. Stored in this browser only.</p>
              <Button onClick={startReviewing} disabled={!firstUp}>
                {firstUp ? "Start reviewing →" : "Nothing left to review"}
              </Button>
            </div>
          </div>

          {data.total > 0 && live.length === 0 && (
            <Callout tone="amber" title="Only MOCK traces so far">
              Labelling mock traces exercises the review workflow, but mock output is not evidence about the real model. Run
              cases in live mode to collect reviewable evidence.
            </Callout>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
            <FilterLabel label="Status">
              <Segmented<StatusFilter>
                label="Review status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "unreviewed", label: "Unreviewed" },
                  { value: "reviewed", label: "Reviewed" },
                  { value: "all", label: "All" },
                ]}
              />
            </FilterLabel>
            <FilterLabel label="Split">
              <Segmented<SplitFilter>
                label="Dataset split"
                value={split}
                onChange={setSplit}
                options={[
                  { value: "all", label: "All" },
                  { value: "dev", label: "Dev" },
                  { value: "heldout", label: "Held-out", title: "Label it, but do not use it for prompt tuning" },
                  { value: "custom", label: "Custom", title: "User-supplied scenarios outside the frozen split" },
                ]}
              />
            </FilterLabel>
            <FilterLabel label="Mode">
              <Segmented<ModeFilter>
                label="Execution mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "all", label: "All" },
                  { value: "live", label: "Live" },
                  { value: "mock", label: "Mock" },
                ]}
              />
            </FilterLabel>
            <FilterLabel label="Agent config">
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              >
                <option value="all">All configs</option>
                {configs.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FilterLabel>
            <span className="ml-auto text-slate-500">
              Showing {rows.length} of {data.total}
            </span>
          </div>

          {/* Table */}
          {data.total === 0 ? (
            <EmptyState title="No traces to review yet">
              Run a pricing case above. Each execution is saved as a trace and appears here as UNREVIEWED.
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState title="No traces match these filters">
              Change the filters above{status === "unreviewed" ? ", or choose “All” to include traces that already have a label" : ""}.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-1.5 pr-2" title="Position in review order (live dev first)">#</th>
                    <th className="pr-3">Case</th>
                    <th className="pr-3">Scenario</th>
                    <th className="pr-3">Agent config</th>
                    <th className="pr-3">Mode</th>
                    <th className="pr-3">Split</th>
                    <th className="pr-3">Human review</th>
                    <th className="pr-3">Executed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, position }) => (
                    <QueueRow key={item.trace.trace_id} item={item} position={position} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function QueueRow({ item, position }: { item: QueueItem; position: number }) {
  const t = item.trace;
  const reviewers = [...new Set(item.annotations.map((a) => a.reviewer))];
  return (
    <tr className={cx("border-b border-slate-100 align-top hover:bg-slate-50", !item.reviewed && "bg-white")}>
      <td className="py-2 pr-2 text-xs tabular-nums text-slate-400">{position}</td>
      <td className="py-2 pr-3 font-semibold text-slate-900">{t.case_id}</td>
      <td className="max-w-xs py-2 pr-3 text-slate-700">{t.input.title}</td>
      <td className="py-2 pr-3">
        <code className="text-xs text-slate-600">{t.agent_version}</code>
      </td>
      <td className="py-2 pr-3">
        <div className="flex flex-wrap gap-1">
          <MockBadge mode={t.execution_mode} />
          {t.execution_error && <Badge tone="red">execution error</Badge>}
        </div>
      </td>
      <td className="py-2 pr-3">
        <SplitBadge split={item.split} />
        {item.split === "heldout" && (
          <p className="mt-0.5 max-w-[11rem] text-[11px] leading-tight text-violet-700">label it, but do not use it for prompt tuning</p>
        )}
      </td>
      <td className="py-2 pr-3">
        {reviewers.length === 0 ? (
          <Badge>UNREVIEWED</Badge>
        ) : (
          <div className="flex flex-wrap gap-1">
            {reviewers.map((r) => (
              <Badge key={r} tone="green" title={`Labelled by ${r} (human annotation)`}>
                reviewed · {r}
              </Badge>
            ))}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-slate-500">{fmtDateTime(t.timestamp)}</td>
      <td className="py-2 text-right">
        <Link
          href={`/review/${t.trace_id}`}
          className="whitespace-nowrap text-xs font-medium text-sky-700 hover:underline"
        >
          {item.reviewed ? "Open" : "Review"} →
        </Link>
      </td>
    </tr>
  );
}

function FilterLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium text-slate-500">{label}</span>
      {children}
    </span>
  );
}

function ProgressBar({ reviewed, total }: { reviewed: number; total: number }) {
  // Visual progress toward the hackathon target (not an evaluation metric).
  const scale = Math.max(TARGET_MAX, total);
  const pct = scale === 0 ? 0 : Math.min(100, (reviewed / scale) * 100);
  const minMark = (TARGET_MIN / scale) * 100;
  const maxMark = (TARGET_MAX / scale) * 100;
  return (
    <div className="relative h-2 w-full max-w-md rounded-full bg-slate-100" aria-hidden>
      <div
        className={cx("h-2 rounded-full", reviewed >= TARGET_MIN ? "bg-emerald-500" : "bg-slate-700")}
        style={{ width: `${pct}%` }}
      />
      <div className="absolute top-[-3px] h-[14px] w-px bg-slate-400" style={{ left: `${minMark}%` }} title={`Target min ${TARGET_MIN}`} />
      <div className="absolute top-[-3px] h-[14px] w-px bg-slate-400" style={{ left: `${maxMark}%` }} title={`Target max ${TARGET_MAX}`} />
    </div>
  );
}

function progressHint(reviewed: number, total: number): string {
  if (reviewed >= TARGET_MIN) return `Minimum target of ${TARGET_MIN} reached.`;
  const needed = TARGET_MIN - reviewed;
  if (total < TARGET_MIN) {
    return `${needed} more label(s) needed for the minimum target, but only ${total} trace(s) exist — run more cases first.`;
  }
  return `${needed} more label(s) needed for the minimum target.`;
}
