"use client";

import type { ExecutionMode } from "@/lib/domain/schemas";
import { Badge, MockBadge, cx } from "@/components/ui";
import { modeSplit } from "./derive";

/** Horizontal bar: share of human-reviewed traces where a reviewer tagged this failure type. */
export function FrequencyBar({ count, reviewed, muted }: { count: number; reviewed: number; muted?: boolean }) {
  const pct = reviewed > 0 ? Math.min(100, (count / reviewed) * 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-slate-100" aria-hidden>
      {count > 0 && <div className={cx("h-2 rounded-full", muted ? "bg-slate-400" : "bg-rose-500")} style={{ width: `${pct}%` }} />}
    </div>
  );
}

/** "seen in N of R reviewed traces", or "not seen yet" — counts are human labels only. */
export function SeenCount({
  count,
  reviewed,
  traceIds,
  traceModes,
}: {
  count: number;
  reviewed: number;
  traceIds: string[];
  traceModes: Record<string, ExecutionMode>;
}) {
  if (count === 0) return <span className="text-xs text-slate-400">not seen yet</span>;
  const s = modeSplit(traceIds, traceModes);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
      <span>
        seen in <b className="tabular-nums text-slate-900">{count}</b> of {reviewed} reviewed traces
      </span>
      {s.mock > 0 && (
        <span className="inline-flex items-center gap-0.5" title={`${s.mock} of these traces came from the mock agent`}>
          <MockBadge mode="mock" />
          <span className="tabular-nums">{s.mock}</span>
        </span>
      )}
      {s.unknown > 0 && (
        <Badge tone="red" title="Trace file not found">
          {s.unknown} missing
        </Badge>
      )}
    </span>
  );
}
