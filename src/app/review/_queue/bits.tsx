/** Small presentational pieces shared by the queue and the review workspace. */
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-slate-50 px-1 py-px font-mono text-[10px] font-medium text-slate-600">
      {children}
    </kbd>
  );
}

export function StepHeading({ n, title, required, hint }: { n: number | string; title: ReactNode; required?: boolean; hint?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
          {n}
        </span>
        <span>{title}</span>
        {required && <span className="text-[11px] font-normal text-slate-500">required</span>}
      </h3>
      {hint && <p className="mt-0.5 pl-7 text-xs leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-rose-700">{message}</p>;
}

/** A row of mutually exclusive toggle buttons. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md ring-1 ring-inset ring-slate-300">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "px-2.5 py-1 text-xs font-medium transition-colors",
            i > 0 && "border-l border-slate-300",
            i === 0 && "rounded-l-md",
            i === options.length - 1 && "rounded-r-md",
            value === o.value ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A large choice button used for labels (Pass/Fail, severity, judge reference label). */
export function ChoiceButton({
  selected,
  onClick,
  tone,
  children,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  tone: "green" | "red" | "amber" | "slate";
  children: ReactNode;
  hint?: ReactNode;
}) {
  const on = {
    green: "bg-emerald-600 text-white ring-emerald-600",
    red: "bg-rose-700 text-white ring-rose-700",
    amber: "bg-amber-500 text-white ring-amber-500",
    slate: "bg-slate-800 text-white ring-slate-800",
  }[tone];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "flex flex-1 flex-col items-center justify-center rounded-md px-2 py-1.5 text-sm font-semibold ring-1 ring-inset transition-colors",
        selected ? on : "bg-white text-slate-800 ring-slate-300 hover:bg-slate-50",
      )}
    >
      <span className="inline-flex items-center gap-1.5">{children}</span>
      {hint && <span className={cx("text-[10px] font-normal", selected ? "text-white/90" : "text-slate-500")}>{hint}</span>}
    </button>
  );
}

export function ReviewerInput({
  value,
  onChange,
  onCommit,
  invalid,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  invalid?: boolean;
  id: string;
}) {
  return (
    <input
      id={id}
      type="text"
      autoComplete="name"
      placeholder="Your name"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          onCommit();
        }
      }}
      className={cx(
        "w-full rounded-md border bg-white px-2 py-1.5 text-sm",
        invalid ? "border-rose-400 ring-1 ring-rose-300" : "border-slate-300",
      )}
    />
  );
}
