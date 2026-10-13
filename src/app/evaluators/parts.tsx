/**
 * Small presentational helpers local to the Evaluators tab (built on src/components/ui.tsx).
 */
import type { ReactNode } from "react";
import { Badge, InfoTip, cx } from "@/components/ui";

/** Section title with an optional ⓘ and a right-hand slot. InfoTip sits outside the heading (it renders a <details>). */
export function SectionTitle({ id, title, info, infoLabel, right }: {
  id?: string;
  title: ReactNode;
  info?: ReactNode;
  infoLabel?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <h2 id={id} className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {info && <InfoTip label={infoLabel}>{info}</InfoTip>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-3">{right}</div>}
    </div>
  );
}

/** Shared <InfoTip> whose popup opens leftwards — for icons near the right edge of the page. */
export function InfoTipLeft({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <span className="inline-flex [&>details>div]:right-0 [&>details>div]:left-auto">
      <InfoTip label={label}>{children}</InfoTip>
    </span>
  );
}

export function ExperimentalBadge() {
  return (
    <Badge tone="purple" title="Not validated well enough to stand alone. Findings require human review; never gold truth.">
      EXPERIMENTAL
    </Badge>
  );
}

/** "CODE · validated by tests" / "AI JUDGE · experimental" */
export function CheckTag({ kind }: { kind: "code-tested" | "code-experimental" | "judge" }) {
  if (kind === "judge") {
    return (
      <Badge tone="purple" title="LLM judge. Experimental: its findings need human review and it is never gold truth.">
        AI JUDGE · experimental
      </Badge>
    );
  }
  return kind === "code-tested" ? (
    <Badge tone="green" title="Deterministic code check with pass/fail/boundary unit tests">
      CODE · validated by tests
    </Badge>
  ) : (
    <Badge tone="amber" title="Deterministic code check without unit-test validation">
      CODE · experimental
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
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
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
              "border-l border-slate-300 px-2.5 py-1 text-xs font-medium first:border-l-0",
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
