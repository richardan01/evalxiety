/**
 * Small presentational helpers local to the Evaluators tab (built on src/components/ui.tsx).
 */
import type { ReactNode } from "react";
import { Badge, cx } from "@/components/ui";

export function SectionHeading({ step, title, phase, children }: { step: number; title: string; phase?: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
        {step}
      </span>
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          {title} {phase && <span className="ml-1 align-middle text-xs font-normal text-slate-500">{phase}</span>}
        </h2>
        {children && <div className="mt-0.5 max-w-4xl text-sm text-slate-600">{children}</div>}
      </div>
    </div>
  );
}

export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-1.5 text-sm text-slate-700">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-300">
            {i + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function ExperimentalBadge() {
  return (
    <Badge tone="purple" title="Not validated well enough to stand alone. Findings require human review; never gold truth.">
      EXPERIMENTAL
    </Badge>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode; hint?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="inline-flex overflow-hidden rounded-md ring-1 ring-inset ring-slate-300">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cx(
              "border-l border-slate-300 px-3 py-1.5 text-xs font-medium first:border-l-0",
              o.value === value ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-900"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "3/12" with the denominator always visible. */
export function Count({ n, of, label, tone }: { n: number; of: number; label: string; tone?: "green" | "red" | "amber" | "purple" | "slate" }) {
  const color = {
    green: "text-emerald-700",
    red: "text-rose-700",
    amber: "text-amber-700",
    purple: "text-violet-700",
    slate: "text-slate-600",
  }[tone ?? "slate"];
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={cx("font-semibold tabular-nums", n > 0 ? color : "text-slate-400")}>
        {n}/{of}
      </span>
    </div>
  );
}
