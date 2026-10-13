"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/client/api";
import type { DatasetSplit } from "@/lib/domain/schemas";
import { EmptyState, InfoTip, MockBadge, PageHeader, cx, fmtDateTime } from "@/components/ui";
import { Segmented } from "../_queue/bits";
import { GoldTable } from "./GoldTable";
import { PromotionQueue } from "./PromotionQueue";
import type { GoldApiResponse } from "./types";

const INFO = (
  <>
    Writing synthetic cases is separate from labelling them: an answer becomes gold only after a named human reviews it and someone
    promotes it. A set this small can&apos;t prove production reliability. Held-out examples stay untouched — never used to tune the
    prompt or the judge.
  </>
);

type SplitFilter = "all" | DatasetSplit;

function SplitStat({ label, value, of, children, heldout }: { label: string; value: number; of: number; children?: ReactNode; heldout?: boolean }) {
  return (
    <div className={cx("rounded-lg border bg-white px-4 py-3 shadow-sm", heldout ? "border-violet-200" : "border-slate-200")}>
      <div className={cx("text-[11px] font-medium uppercase tracking-wide", heldout ? "text-violet-700" : "text-slate-400")}>{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular-nums text-slate-900">{value}</span>
        <span className="text-xs text-slate-400">of {of} cases</span>
      </div>
      {children && <div className="mt-0.5 text-xs text-slate-500">{children}</div>}
    </div>
  );
}

function SectionHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
      <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">{children}</h2>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

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
    const cases = (split: DatasetSplit) => new Set(data.gold.filter((g) => g.dataset_split === split).map((g) => g.case_id)).size;
    return {
      dev: data.gold.filter((g) => g.dataset_split === "dev").length,
      heldout: data.gold.filter((g) => g.dataset_split === "heldout").length,
      devCases: cases("dev"),
      heldoutCases: cases("heldout"),
      mock: data.gold.filter((g) => g.trace_execution_mode === "mock").length,
    };
  }, [data]);

  const header = <PageHeader title="Gold set" question="Reviewed answers saved as the reference test set." info={INFO} />;

  if (!data || !stats) {
    return (
      <div>
        {header}
        {error ? (
          <p className="text-sm text-rose-700">Couldn&apos;t load the gold set: {error}</p>
        ) : (
          <p className="text-sm text-slate-500">Loading gold set…</p>
        )}
      </div>
    );
  }

  const shown = filter === "all" ? data.gold : data.gold.filter((g) => g.dataset_split === filter);

  return (
    <div className="space-y-4">
      {header}
      {error && <p className="text-xs text-rose-700">Refresh failed — showing the last loaded data: {error}</p>}

      <div className="grid max-w-xl grid-cols-2 gap-3">
        <SplitStat label="Dev" value={stats.dev} of={data.split_case_counts.dev}>
          {stats.dev !== stats.devCases && `${stats.devCases} distinct cases · `}used to check the judge
        </SplitStat>
        <SplitStat label="Held-out" value={stats.heldout} of={data.split_case_counts.heldout} heldout>
          {stats.heldout !== stats.heldoutCases && `${stats.heldoutCases} distinct cases · `}
          {data.heldout.revealed ? (
            <span title={data.heldout.revealed_at ? fmtDateTime(data.heldout.revealed_at) : undefined}>
              revealed by {data.heldout.revealed_by}
            </span>
          ) : (
            <span>locked until the final check</span>
          )}
        </SplitStat>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <SectionHead
          right={
            <>
              {stats.mock > 0 && (
                <span className="inline-flex items-center gap-0.5 text-xs text-slate-500" title="Mock gold labels describe the mock agent, not Claude">
                  <MockBadge mode="mock" /> {stats.mock}
                </span>
              )}
              {data.gold.length > 0 && (
                <Segmented<SplitFilter>
                  label="Set"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: `All ${data.gold.length}` },
                    { value: "dev", label: `Dev ${stats.dev}` },
                    { value: "heldout", label: `Held-out ${stats.heldout}` },
                  ]}
                />
              )}
            </>
          }
        >
          Gold examples
        </SectionHead>
        {data.gold.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">None yet — promote a reviewed answer below.</p>
        ) : shown.length === 0 ? (
          <div className="p-4">
            <EmptyState title="None in this set" />
          </div>
        ) : (
          <GoldTable gold={shown} names={data.failure_mode_names} reload={reload} />
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <SectionHead>
          Ready to promote ({data.candidates.length})
          <InfoTip>
            Human labels on frozen dev/held-out cases that aren&apos;t gold yet, or changed since promotion. One label per trace can be
            gold. Custom cases never qualify.
            {data.superseded_by_other_annotation > 0 &&
              ` ${data.superseded_by_other_annotation} other label(s) hidden: another reviewer's label of the same trace is already gold.`}
          </InfoTip>
        </SectionHead>
        {data.candidates.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">
            Nothing to promote —{" "}
            <Link href="/review" className="text-sky-700 hover:underline">
              review an answer first
            </Link>
            .
          </p>
        ) : (
          <PromotionQueue candidates={data.candidates} names={data.failure_mode_names} reload={reload} />
        )}
      </section>
    </div>
  );
}
