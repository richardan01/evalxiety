"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/client/api";
import type { DatasetSplit } from "@/lib/domain/schemas";
import { Badge, Callout, Card, EmptyState, MockBadge, Stat, cx, fmtDateTime } from "@/components/ui";
import { ReviewerBar } from "../taxonomy/_shared/forms";
import { CandidateCard } from "./PromotionQueue";
import { GoldTable } from "./GoldTable";
import type { GoldApiResponse } from "./types";

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{n}</span>
      {children}
    </span>
  );
}

type SplitFilter = "all" | DatasetSplit;

export function GoldDataset() {
  const [data, setData] = useState<GoldApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<SplitFilter>("all");
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    getJSON<GoldApiResponse>("/api/gold")
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [tick]);

  const stats = useMemo(() => {
    if (!data) return null;
    const by = (split: DatasetSplit) => data.gold.filter((g) => g.dataset_split === split);
    const traceCounts = new Map<string, number>();
    for (const c of data.candidates) traceCounts.set(c.trace_id, (traceCounts.get(c.trace_id) ?? 0) + 1);
    return {
      dev: by("dev"),
      heldout: by("heldout"),
      pass: data.gold.filter((g) => g.human_label === "pass").length,
      fail: data.gold.filter((g) => g.human_label === "fail").length,
      live: data.gold.filter((g) => g.trace_execution_mode === "live").length,
      mock: data.gold.filter((g) => g.trace_execution_mode === "mock").length,
      present: data.gold.filter((g) => g.unsupported_justification_label === "present").length,
      absent: data.gold.filter((g) => g.unsupported_justification_label === "absent").length,
      notAssessed: data.gold.filter((g) => g.unsupported_justification_label === "not_assessed").length,
      traceCounts,
    };
  }, [data]);

  if (error && !data) {
    return (
      <Callout tone="red" title="Could not load the gold dataset">
        {error}
      </Callout>
    );
  }
  if (!data || !stats) return <p className="text-sm text-slate-500">Loading gold dataset…</p>;

  const shown = filter === "all" ? data.gold : data.gold.filter((g) => g.dataset_split === filter);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Gold dataset</h1>
        <p className="text-sm text-slate-600">
          Human-labelled reference examples, each traceable to the reviewer, the trace and the label version it came from.
        </p>
      </div>

      {error && (
        <Callout tone="red" title="Refresh failed — showing the last loaded data">
          {error}
        </Callout>
      )}

      <Callout tone="amber" title="What gold means here">
        Synthetic scenario creation is separate from human labelling. A case becomes gold only after a named human reviews its trace;
        Claude-generated content is never gold by itself. Small hackathon datasets cannot establish production reliability.
      </Callout>

      <Callout tone="blue" title="How a case becomes gold">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Run one of the frozen synthetic cases (C01–C20) in{" "}
            <Link href="/review" className="text-sky-700 underline">
              Queue &amp; traces
            </Link>
            . The synthetic scenario is only the input.
          </li>
          <li>A named reviewer reads that trace and records pass/fail, the first failure, and whether an unsupported pricing claim is present.</li>
          <li>
            Below, check the expected behaviour, edit it if needed, and promote it under your name. Categorise first failures in{" "}
            <Link href="/review/taxonomy" className="text-sky-700 underline">
              Failure taxonomy
            </Link>{" "}
            first so the gold example carries its failure modes.
          </li>
          <li>Dev gold is used to calibrate the EXPERIMENTAL LLM judge. Held-out gold is kept for one final check.</li>
        </ol>
      </Callout>

      <ReviewerBar purpose="Promotions and removals are recorded under this name in the audit log." />

      <Card
        title={<StepTitle n={1}>Dataset split ({data.split_version})</StepTitle>}
        subtitle="Each frozen synthetic case is assigned to one split before any review. Counts are gold examples, not cases run."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Dev gold examples"
            value={stats.dev.length}
            hint={`From ${new Set(stats.dev.map((g) => g.case_id)).size} of ${data.split_case_counts.dev} dev cases. Used to iterate on and calibrate the judge.`}
          />
          <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              Held-out gold examples <Badge tone="purple">untouched — not for prompt or judge tuning</Badge>
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.heldout.length}</div>
            <div className="mt-1 text-xs text-slate-500">
              From {new Set(stats.heldout.map((g) => g.case_id)).size} of {data.split_case_counts.heldout} held-out cases.{" "}
              {data.heldout.revealed ? (
                <>
                  Revealed by {data.heldout.revealed_by}
                  {data.heldout.revealed_at ? ` on ${fmtDateTime(data.heldout.revealed_at)}` : ""} (audited).
                </>
              ) : (
                <>Locked: held-out calibration stays hidden until an audited reveal.</>
              )}
            </div>
          </div>
          <Stat
            label="Human pass / fail labels"
            value={
              <span>
                <span className="text-emerald-700">{stats.pass}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-rose-700">{stats.fail}</span>
              </span>
            }
            hint={`Task outcome across all ${data.gold.length} gold examples.`}
          />
          <Stat
            label="Unsupported-claim label"
            value={
              <span className="text-base">
                {stats.present} present · {stats.absent} absent
              </span>
            }
            hint={`${stats.notAssessed} not assessed (excluded from judge calibration).`}
          />
        </div>
        {data.gold.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            Trace execution mode of gold examples:
            <span className="inline-flex items-center gap-1">
              <MockBadge mode="live" /> {stats.live}
            </span>
            <span className="inline-flex items-center gap-1">
              <MockBadge mode="mock" /> {stats.mock}
            </span>
            {stats.mock > 0 && <span className="text-amber-800">Mock gold labels describe the mock agent, not Claude; calibration is reported per mode.</span>}
          </div>
        )}
      </Card>

      <Card
        title={<StepTitle n={2}>Promotion queue</StepTitle>}
        subtitle="Human annotations on frozen synthetic cases that are not gold yet, or whose annotation changed after promotion."
      >
        {data.candidates.length === 0 ? (
          <EmptyState title="Nothing to promote">
            A candidate appears here after a named reviewer labels a trace of a frozen synthetic case (C01–C20) in{" "}
            <Link href="/review" className="text-sky-700 underline">
              Queue &amp; traces
            </Link>
            . Custom (user-supplied) cases cannot become gold.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {data.candidates.map((c) => (
              <CandidateCard
                key={c.annotation.annotation_id}
                c={c}
                names={data.failure_mode_names}
                sameTraceCount={stats.traceCounts.get(c.trace_id) ?? 1}
                reload={reload}
              />
            ))}
          </ul>
        )}
        {data.superseded_by_other_annotation > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {data.superseded_by_other_annotation} other human annotation{data.superseded_by_other_annotation === 1 ? " is" : "s are"} not
            listed because a different reviewer&apos;s annotation of the same trace is already gold.
          </p>
        )}
      </Card>

      <Card
        title={<StepTitle n={3}>Gold examples</StepTitle>}
        subtitle="Every provenance field is shown. Scroll sideways for the full record; expand cells for long text."
        actions={
          <div className="flex gap-1">
            {(["all", "dev", "heldout"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cx(
                  "rounded px-2 py-1 text-xs font-medium ring-1 ring-inset",
                  filter === f ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                )}
              >
                {f === "all" ? `All (${data.gold.length})` : f === "dev" ? `Dev (${stats.dev.length})` : `Held-out (${stats.heldout.length})`}
              </button>
            ))}
          </div>
        }
      >
        {data.gold.length === 0 ? (
          <EmptyState title="No gold examples yet">Promote a human-reviewed trace from the queue above to create the first gold example.</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title="No gold examples in this split">Switch the filter, or promote a reviewed trace of a case in this split.</EmptyState>
        ) : (
          <GoldTable gold={shown} names={data.failure_mode_names} reload={reload} />
        )}
      </Card>
    </div>
  );
}
