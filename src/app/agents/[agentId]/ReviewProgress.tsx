"use client";

/**
 * How far review of one test has got: decided answers (green), answers reviewers disagree on (orange, still counted as
 * reviewed: the fail counts), "not sure" ones (amber, still to decide) and the rest. Optionally, how many this reviewer
 * has marked.
 */
import type { Progress } from "@/lib/agents/review";
import { cx } from "@/components/ui";

export function ReviewProgress({ progress: p, label, showMine = false, className }: { progress: Progress; label?: string; showMine?: boolean; className?: string }) {
  if (!p.total) return null;
  const disputed = Math.min(p.disputed, p.reviewed);
  const segments = [
    { n: p.reviewed - disputed, cls: "bg-emerald-500", title: "decided" },
    { n: disputed, cls: "bg-orange-400", title: "reviewers disagree" },
    { n: p.unsure, cls: "bg-amber-300", title: "not sure: still to decide" },
  ];
  const pct = (n: number) => `${(n / p.total) * 100}%`;
  return (
    <div className={className}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.reviewed}
        aria-label={`${p.reviewed} of ${p.total} answers reviewed`}
      >
        {segments.map((s) => (s.n > 0 ? <div key={s.title} className={cx("h-full", s.cls)} style={{ width: pct(s.n) }} title={`${s.n} ${s.title}`} /> : null))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600">
        <span>
          {label ? `${label}: ` : ""}
          <b className="text-slate-800">
            {p.reviewed} of {p.total}
          </b>{" "}
          reviewed
        </span>
        {p.unsure > 0 && <span className="text-amber-800">{p.unsure} not sure</span>}
        {p.disputed > 0 && <span className="text-orange-700">{p.disputed === 1 ? "1 disagreement" : `${p.disputed} disagreements`}</span>}
        {showMine && <span>you: {p.mine} marked</span>}
      </div>
    </div>
  );
}
