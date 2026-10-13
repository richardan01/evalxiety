"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { REVIEW_TARGET } from "@/lib/domain/review";
import { getJSON } from "@/lib/client/api";
import { Badge, EmptyState, InfoTip, MockBadge, PageHeader, cx, fmtDateTime } from "@/components/ui";
import { firstUnreviewed, readDeferred, reviewOrder } from "./order";
import { Segmented } from "./bits";
import type { QueueItem, QueueResponse } from "./types";

type StatusFilter = "all" | "todo" | "done";
type SetFilter = "all" | "dev" | "heldout" | "custom";
type ModeFilter = "all" | "live" | "mock";

const TARGET_MIN = REVIEW_TARGET.min;
const TARGET_MAX = REVIEW_TARGET.max;
/** Rows shown before "Show all" — keeps the first screen short. */
const FIRST_ROWS = 12;

/** "pricing-agent@corrected-v2" -> "Corrected". Falls back to the raw id. */
export function versionLabel(agentVersion: string): string {
  if (/baseline/i.test(agentVersion)) return "Baseline";
  if (/corrected/i.test(agentVersion)) return "Corrected";
  return agentVersion;
}

/** "Ada Lovelace" -> "AL", "grace" -> "GR". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const raw = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return raw.toUpperCase();
}

const setOf = (item: QueueItem): Exclude<SetFilter, "all"> => item.split ?? "custom";

export function AnnotationQueue() {
  const router = useRouter();
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [set, setSet] = useState<SetFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [version, setVersion] = useState("all");
  const [showAll, setShowAll] = useState(false);

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
  const present = useMemo(
    () => ({
      versions: [...new Set(ordered.map((i) => i.trace.agent_version))].sort(),
      sets: new Set(ordered.map(setOf)),
      modes: new Set(ordered.map((i) => i.trace.execution_mode)),
    }),
    [ordered],
  );
  const rows = ordered.filter((item) => {
    if (status === "done" && !item.reviewed) return false;
    if (status === "todo" && item.reviewed) return false;
    if (set !== "all" && setOf(item) !== set) return false;
    if (mode !== "all" && item.trace.execution_mode !== mode) return false;
    if (version !== "all" && item.trace.agent_version !== version) return false;
    return true;
  });
  const visible = showAll ? rows : rows.slice(0, FIRST_ROWS);

  const firstUp = data ? firstUnreviewed(data.items) : null;
  const mockOnly = data !== null && data.total > 0 && !present.modes.has("live");

  function startReviewing() {
    if (!data) return;
    const target = firstUnreviewed(data.items, readDeferred()) ?? firstUnreviewed(data.items);
    if (target) router.push(`/review/${target.trace.trace_id}`);
  }

  return (
    <div>
      <PageHeader
        title="Review"
        question={`Label ${TARGET_MIN}–${TARGET_MAX} agent answers so the checks can be trusted.`}
        info={
          <>
            Open an answer, tick the checklist, mark Pass or Fail. These human labels are the ground truth the automated checks and
            the AI judge are measured against. Live answers on dev cases come first; MOCK answers only exercise the workflow.
          </>
        }
        action={
          <button
            type="button"
            onClick={startReviewing}
            disabled={!firstUp}
            title={data && data.total === 0 ? "Run a case first" : undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {data && data.total > 0 && !firstUp ? "All reviewed ✓" : "Start reviewing →"}
          </button>
        }
      />

      {error && <p className="text-sm text-rose-700">Couldn&apos;t load the queue: {error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading the queue…</p>}

      {data && (
        <div className="space-y-4">
          <Progress reviewed={data.reviewed_count} total={data.total} mockOnly={mockOnly} />

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
              <Segmented<StatusFilter>
                label="Review status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "all", label: "All" },
                  { value: "todo", label: "To review" },
                  { value: "done", label: "Reviewed" },
                ]}
              />
              {present.versions.length > 1 && (
                <Segmented<string>
                  label="Agent version"
                  value={version}
                  onChange={setVersion}
                  options={[{ value: "all", label: "Any version" }, ...present.versions.map((v) => ({ value: v, label: versionLabel(v), title: v }))]}
                />
              )}
              {present.modes.size > 1 && (
                <Segmented<ModeFilter>
                  label="Execution mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "all", label: "Live + mock" },
                    { value: "live", label: "Live" },
                    { value: "mock", label: "Mock" },
                  ]}
                />
              )}
              {present.sets.size > 1 && (
                <Segmented<SetFilter>
                  label="Case set"
                  value={set}
                  onChange={setSet}
                  options={[
                    { value: "all", label: "Any set" },
                    ...(["dev", "heldout", "custom"] as const)
                      .filter((s) => present.sets.has(s))
                      .map((s) => ({ value: s, label: s === "dev" ? "Dev" : s === "heldout" ? "Held-out" : "Custom" })),
                  ]}
                />
              )}
              <span className="ml-auto text-xs tabular-nums text-slate-400">
                {rows.length} of {data.total}
              </span>
            </div>

            {data.total === 0 ? (
              <div className="p-4">
                <EmptyState title="No answers yet">Run a case below.</EmptyState>
              </div>
            ) : rows.length === 0 ? (
              <div className="p-4">
                <EmptyState title="Nothing matches these filters" />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    <th className="py-2 pl-4 pr-3">Case</th>
                    <th className="pr-3">Answer</th>
                    <th className="pr-3">Version</th>
                    <th className="pr-3" />
                    <th className="pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <QueueRow key={item.trace.trace_id} item={item} onOpen={() => router.push(`/review/${item.trace.trace_id}`)} />
                  ))}
                </tbody>
              </table>
            )}
            {!showAll && rows.length > FIRST_ROWS && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full border-t border-slate-100 py-2 text-xs font-medium text-sky-700 hover:bg-slate-50"
              >
                Show all {rows.length}
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function QueueRow({ item, onOpen }: { item: QueueItem; onOpen: () => void }) {
  const t = item.trace;
  const reviewers = [...new Set(item.annotations.map((a) => a.reviewer))];
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
      title={`Run ${fmtDateTime(t.timestamp)} · ${t.agent_version}`}
    >
      <td className="py-2 pl-4 pr-3 font-semibold text-slate-900">{t.case_id}</td>
      <td className="max-w-md py-2 pr-3">
        <Link
          href={`/review/${t.trace_id}`}
          onClick={(e) => e.stopPropagation()}
          className="block truncate text-slate-800 hover:underline"
        >
          {t.input.title}
        </Link>
      </td>
      <td className="py-2 pr-3 text-xs text-slate-600">{versionLabel(t.agent_version)}</td>
      <td className="py-2 pr-3">
        <span className="flex flex-wrap gap-1">
          <MockBadge mode={t.execution_mode} />
          {item.split === "heldout" && (
            <Badge tone="purple" title="Held-out case: label it, but never use it to tune the prompt or judge">
              HELD-OUT
            </Badge>
          )}
          {item.split === null && <Badge title="User-supplied case, outside the frozen dev/held-out split">custom</Badge>}
          {t.execution_error && <Badge tone="red" title={t.execution_error}>error</Badge>}
        </span>
      </td>
      <td className="py-2 pr-4">
        {reviewers.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <span aria-hidden className="h-2 w-2 rounded-full ring-1 ring-inset ring-slate-300" />
            to review
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5" title={`Reviewed by ${reviewers.join(", ")}`}>
            <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="sr-only">Reviewed by</span>
            {reviewers.slice(0, 3).map((r) => (
              <span
                key={r}
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200"
              >
                {initials(r)}
              </span>
            ))}
            {reviewers.length > 3 && <span className="text-[10px] text-slate-500">+{reviewers.length - 3}</span>}
          </span>
        )}
      </td>
    </tr>
  );
}

function Progress({ reviewed, total, mockOnly }: { reviewed: number; total: number; mockOnly: boolean }) {
  // Visual progress toward the demo target (not an evaluation metric).
  const pct = Math.min(100, (reviewed / TARGET_MAX) * 100);
  const minMark = (TARGET_MIN / TARGET_MAX) * 100;
  const done = reviewed >= TARGET_MIN;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="relative h-2.5 w-full max-w-sm rounded-full bg-slate-200" aria-hidden>
        <div className={cx("h-2.5 rounded-full", done ? "bg-emerald-500" : "bg-slate-800")} style={{ width: `${pct}%` }} />
        <div className="absolute -top-1 h-[18px] w-0.5 rounded bg-slate-400" style={{ left: `${minMark}%` }} />
      </div>
      <p className="text-sm text-slate-600">
        <b className="text-base tabular-nums text-slate-900">{reviewed}</b> of {TARGET_MIN} minimum{" "}
        <span className="text-slate-400">({TARGET_MAX} ideal)</span>
        {done && <span className="ml-1 text-emerald-700">✓</span>}
      </p>
      {total < TARGET_MIN && <span className="text-xs text-amber-700">Only {total} answers — run more below</span>}
      {mockOnly && (
        <span className="inline-flex items-center gap-1">
          <Badge tone="amber">MOCK only</Badge>
          <InfoTip label="Why MOCK matters">
            Every answer here came from the mock agent. Labelling them exercises the workflow but says nothing about the real model.
          </InfoTip>
        </span>
      )}
    </div>
  );
}
