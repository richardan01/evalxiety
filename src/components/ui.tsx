/**
 * Shared presentational primitives. Server- and client-safe (no hooks).
 */
import type { ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ title, subtitle, actions, children, className }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "green" | "red" | "amber" | "blue" | "purple" | "slate";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  slate: "bg-slate-800 text-white ring-slate-800",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-rose-50 text-rose-800 ring-rose-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-300",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  purple: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone])}
    >
      {children}
    </span>
  );
}

/** Mandatory label on anything produced by mock execution. */
export function MockBadge({ mode }: { mode: "live" | "mock" | "imported" | "http" }) {
  if (mode === "imported") return <Badge tone="blue" title="Produced by your agent outside Evalxiety and imported from a file">IMPORTED</Badge>;
  if (mode === "http") return <Badge tone="blue" title="Produced by calling your agent's HTTP endpoint">HTTP</Badge>;
  return mode === "mock" ? (
    <Badge tone="amber" title="Produced by the mock agent/judge. Not evidence about the real model.">
      MOCK
    </Badge>
  ) : (
    <Badge tone="blue" title="Produced by a real Claude API call">LIVE</Badge>
  );
}

/** Mandatory label on starter-kit data: shows the workflow, never evidence about a real agent. */
export function ExampleBadge() {
  return (
    <Badge tone="amber" title="Starter-kit example data. It shows how the workflow works and never counts as release evidence.">
      EXAMPLE
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const tone: Tone =
    outcome === "PASS" ? "green"
    : outcome === "FAIL" ? "red"
    : outcome === "REQUIRES_REVIEW" ? "amber"
    : outcome === "ERROR" ? "purple"
    : "neutral";
  return <Badge tone={tone}>{outcome.replace(/_/g, " ")}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  if (!severity) return null;
  const tone: Tone = severity === "critical" ? "red" : severity === "major" ? "amber" : "neutral";
  return <Badge tone={tone}>{severity}</Badge>;
}

export function SplitBadge({ split }: { split: "dev" | "heldout" | null | undefined }) {
  if (!split) return <Badge>custom</Badge>;
  return split === "heldout" ? (
    <Badge tone="purple" title="Held-out case: do not use for prompt or judge tuning">HELD-OUT</Badge>
  ) : (
    <Badge tone="neutral">dev</Badge>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "green" | "amber" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div
        className={cx(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "red" && "text-rose-700",
          tone === "green" && "text-emerald-700",
          tone === "amber" && "text-amber-700",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function KeyValue({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(140px,max-content)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JsonDetails({ summary, value, open }: { summary: ReactNode; value: unknown; open?: boolean }) {
  return (
    <details open={open} className="rounded border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium text-slate-600">{summary}</summary>
      <pre className="max-h-96 overflow-auto border-t border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-800">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Callout({ tone = "amber", title, children }: { tone?: "amber" | "red" | "blue" | "slate"; title?: ReactNode; children: ReactNode }) {
  const cls = {
    amber: "border-amber-300 bg-amber-50 text-amber-950",
    red: "border-rose-300 bg-rose-50 text-rose-950",
    blue: "border-sky-300 bg-sky-50 text-sky-950",
    slate: "border-slate-300 bg-slate-50 text-slate-900",
  }[tone];
  return (
    <div className={cx("rounded-lg border px-4 py-3 text-sm", cls)}>
      {title && <div className="mb-1 font-semibold">{title}</div>}
      <div>{children}</div>
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = "primary", type = "button", title }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
  title?: string;
}) {
  const cls = {
    primary: "bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400",
    secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    danger: "bg-rose-700 text-white hover:bg-rose-600 disabled:bg-rose-300",
    ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
  }[variant];
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed", cls)}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const fmtUsd = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const fmtPct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}%`;

export const fmtRate = (bps: number, fee: number) => `${(bps / 100).toFixed(2)}% + $${fee.toFixed(2)}`;

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** A ratio that may be undefined. Never renders undefined as 0% or 100%. */
export function Ratio({ value, undefinedReason }: { value: number | null; undefinedReason?: string }) {
  if (value === null) {
    return (
      <span className="text-slate-500" title={undefinedReason ?? "Denominator is zero"}>
        undefined
      </span>
    );
  }
  return <span className="tabular-nums">{(value * 100).toFixed(1)}%</span>;
}

// ---------------------------------------------------------------------------
// Low-text layout helpers (shared by every tab)
// ---------------------------------------------------------------------------

/** Small ⓘ that reveals an explanation on click/hover. Use instead of paragraphs of helper text. */
export function InfoTip({ children, label = "What is this?" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group relative inline-block align-middle">
      <summary
        aria-label={label}
        title={label}
        className="flex h-4 w-4 cursor-pointer list-none items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-500 hover:border-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden"
      >
        i
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-slate-200 bg-white p-3 text-xs font-normal leading-relaxed text-slate-700 shadow-lg">
        {children}
      </div>
    </details>
  );
}

/** One-line page header: what you're looking at + the single primary action. */
export function PageHeader({ title, question, info, action }: { title: string; question: ReactNode; info?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
          {question}
          {info && <InfoTip>{info}</InfoTip>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Big status pill with an icon so status is never colour-only. */
export function StatusPill({ status, approvedLabel = "Approved for demo" }: { status: string; approvedLabel?: string }) {
  const map: Record<string, { label: string; icon: string; cls: string }> = {
    NO_SHIP: { label: "No ship", icon: "✕", cls: "bg-rose-600 text-white" },
    INSUFFICIENT_EVIDENCE: { label: "Not enough evidence", icon: "…", cls: "bg-amber-400 text-amber-950" },
    ELIGIBLE_FOR_DEMO_APPROVAL: { label: "Ready for approval", icon: "✓", cls: "bg-sky-600 text-white" },
    APPROVED_FOR_DEMO: { label: approvedLabel, icon: "✓", cls: "bg-emerald-600 text-white" },
  };
  const m = map[status] ?? { label: status, icon: "•", cls: "bg-slate-700 text-white" };
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", m.cls)}>
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}
