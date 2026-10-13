"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "./ui";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/review", label: "Trace Review" },
  { href: "/evaluators", label: "Evaluators" },
  { href: "/experiments", label: "Experiments" },
  { href: "/release", label: "Release Gate" },
];

interface ModeResponse {
  mode: "live" | "mock";
  reason: string;
  model_id: string;
  spend_cap_usd: number;
  ledger: { total_estimated_usd: number; live_calls: number };
}

export function AppHeader() {
  const pathname = usePathname();
  const [mode, setMode] = useState<ModeResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/mode", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => alive && m && typeof m.mode === "string" && m.ledger && setMode(m))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <header className="border-b border-slate-200 bg-white">
      {mode?.mode === "mock" && (
        <div className="bg-amber-100 px-6 py-1.5 text-center text-xs font-medium text-amber-950">
          MOCK MODE — new executions use a deterministic mock agent and judge ({mode.reason}). Mock results are labelled
          and are not evidence about the real model.
        </div>
      )}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 pt-4">
        <div>
          <Link href="/" className="text-lg font-semibold tracking-tight text-slate-900">
            AgentTrust
          </Link>
          <p className="text-xs text-slate-500">Don&apos;t just build AI agents. Prove they&apos;re ready to ship.</p>
        </div>
        {mode && (
          <div className="text-right text-xs text-slate-500">
            <div>
              Mode:{" "}
              <span className={cx("font-semibold", mode.mode === "live" ? "text-sky-700" : "text-amber-700")}>
                {mode.mode.toUpperCase()}
              </span>{" "}
              · model <code className="font-mono">{mode.model_id}</code>
            </div>
            <div>
              Live spend (estimated): ${mode.ledger.total_estimated_usd.toFixed(2)} of ${mode.spend_cap_usd.toFixed(2)} cap ·{" "}
              {mode.ledger.live_calls} live calls
            </div>
          </div>
        )}
      </div>
      <nav className="mx-auto flex max-w-7xl gap-1 px-6 pt-3">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cx(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
