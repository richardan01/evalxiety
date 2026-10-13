"use client";

import type { ExecutionMode } from "@/lib/domain/schemas";
import { Ratio, SeverityBadge } from "@/components/ui";
import { ModeMix, StatusBadge } from "./FailureModeCard";
import type { FrequencyRow } from "./derive";
import type { FailureMode } from "@/lib/domain/schemas";

function CountCell({ count, share, reviewed }: { count: number; share: number | null; reviewed: number }) {
  return (
    <span className="tabular-nums">
      <b className={count === 0 ? "text-slate-400" : "text-slate-900"}>{count}</b>
      <span className="text-slate-500"> of {reviewed}</span>
      <span className="ml-1 text-xs text-slate-500">
        (<Ratio value={share} undefinedReason="No human-reviewed traces yet: denominator is zero" />)
      </span>
    </span>
  );
}

export function FrequencyTable({
  rows,
  modes,
  reviewed,
  uncategorisedTraces,
  traceModes,
}: {
  rows: FrequencyRow[];
  modes: FailureMode[];
  reviewed: number;
  uncategorisedTraces: number;
  traceModes: Record<string, ExecutionMode>;
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-1.5 pr-2">#</th>
              <th className="pr-2">Category</th>
              <th className="pr-2">Status</th>
              <th className="pr-2">Severity</th>
              <th className="pr-2">
                First failure in
                <span className="block font-normal">of {reviewed} human-reviewed traces</span>
              </th>
              <th className="pr-2">
                Mentioned in (first or additional)
                <span className="block font-normal">of {reviewed} human-reviewed traces</span>
              </th>
              <th>Execution mode of those traces</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.mode.failure_mode_id} className="border-b border-slate-100 align-top">
                <td className="py-1.5 pr-2 text-xs text-slate-400">{i + 1}</td>
                <td className="pr-2">
                  <div className="font-medium text-slate-900">{r.mode.name}</div>
                  <code className="font-mono text-[11px] text-slate-500">{r.mode.failure_mode_id}</code>
                </td>
                <td className="pr-2">
                  <StatusBadge mode={r.mode} modes={modes} />
                </td>
                <td className="pr-2">
                  <SeverityBadge severity={r.mode.severity} />
                </td>
                <td className="pr-2">
                  <CountCell count={r.freq.first_failure_count} share={r.first_share} reviewed={reviewed} />
                </td>
                <td className="pr-2">
                  <CountCell count={r.freq.any_count} share={r.any_share} reviewed={reviewed} />
                  {r.freq.any_count === 0 && <div className="text-xs text-amber-800">0 observed — hypothesis</div>}
                </td>
                <td>
                  {r.freq.trace_ids.length ? <ModeMix traceIds={r.freq.trace_ids} traceModes={traceModes} /> : <span className="text-xs text-slate-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
        <li>
          Each count is the number of <b>distinct human-reviewed traces</b> where a reviewer tagged the category; a trace counts once
          per category even if several reviewers tagged it. Merged categories are counted under their target.
        </li>
        <li>
          {uncategorisedTraces === 0
            ? "Every recorded first failure has a category."
            : `${uncategorisedTraces} failed trace${uncategorisedTraces === 1 ? " has" : "s have"} a first failure with no category yet and ${uncategorisedTraces === 1 ? "is" : "are"} not counted in any row (see Step 1).`}
        </li>
        <li>
          Synthetic cases and a small sample: these are observed counts in this review set, not production failure rates. Deterministic
          evaluators and the LLM judge never contribute to them.
        </li>
      </ul>
    </div>
  );
}
