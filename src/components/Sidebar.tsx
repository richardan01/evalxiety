"use client";

/**
 * App sidebar: navigation grouped by workflow stage and live system status
 * (mode, model, spend).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "./ui";
import { Mascot } from "./Mascot";

const NAV: Array<{ section: string; items: Array<{ href: string; label: string; icon: string; hint: string }> }> = [
  {
    section: "Overview",
    items: [
      { href: "/start", label: "Start here", icon: "➜", hint: "The 5-stage path, what to improve next, how to bring your own agent" },
      { href: "/", label: "Dashboard", icon: "▦", hint: "Eval progress and release status" },
    ],
  },
  {
    section: "Human review",
    items: [
      { href: "/review", label: "Review traces", icon: "✎", hint: "Label agent answers (open coding)" },
      { href: "/review/taxonomy", label: "Axial coding", icon: "⧉", hint: "Group your notes into failure types" },
      { href: "/review/rubric", label: "Rubric", icon: "☰", hint: "Checklist and AI judge criterion" },
      { href: "/review/gold", label: "Gold set", icon: "★", hint: "Reviewed answers kept as reference" },
    ],
  },
  {
    section: "Evaluate",
    items: [
      { href: "/evaluators", label: "Checks", icon: "✓", hint: "Code checks and AI judge calibration" },
      { href: "/experiments", label: "Experiments", icon: "⇄", hint: "Baseline vs corrected on frozen cases" },
      { href: "/release", label: "Release gate", icon: "⚑", hint: "Ship or not" },
    ],
  },
  { section: "Integrate", items: [{ href: "/connect", label: "Connect (MCP)", icon: "⌁", hint: "Claude Desktop / Claude Code" }] },
];

interface ModeResponse {
  mode: "live" | "mock";
  reason: string;
  model_id: string;
  spend_cap_usd: number;
  ledger: { total_estimated_usd: number; live_calls: number };
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/review") {
    return pathname === "/review" || (pathname.startsWith("/review/") && !["/review/taxonomy", "/review/rubric", "/review/gold"].some((p) => pathname.startsWith(p)));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
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

  const spendPct = mode ? Math.min(100, (mode.ledger.total_estimated_usd / Math.max(mode.spend_cap_usd, 0.01)) * 100) : 0;

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-slate-950 text-slate-300">
      <Link href="/" className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <Mascot mood="worried" size={34} />
        <span>
          <span className="block text-sm font-semibold text-white">Evalxiety</span>
          <span className="block text-[11px] text-slate-500">Nervous before shipping</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3">
        {NAV.map((group) => (
          <div key={group.section} className="mb-3">
            <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{group.section}</div>
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.hint}
                  className={cx(
                    "mb-0.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active ? "bg-slate-800 text-white ring-1 ring-inset ring-slate-700" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
                  )}
                >
                  <span aria-hidden className={cx("w-4 text-center", active ? "text-sky-400" : "text-slate-500")}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}

      </nav>

      <div className="border-t border-slate-800 px-5 py-4 text-xs">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">System</div>
        <div className="flex items-center gap-2">
          <span className={cx("h-2 w-2 rounded-full", mode?.mode === "live" ? "bg-emerald-400" : mode ? "bg-amber-400" : "bg-slate-600")} />
          <span className="text-slate-300">{mode ? (mode.mode === "live" ? "Live · Claude API connected" : "Mock mode · no spend") : "Checking…"}</span>
        </div>
        {mode && (
          <div className="mt-2 text-[11px] text-slate-500">
            Model <span className="font-mono text-slate-300">{mode.model_id}</span>
          </div>
        )}
        {mode && (
          <div className="mt-3">
            <div className="flex justify-between text-slate-400">
              <span>API spend</span>
              <span className="tabular-nums text-slate-200">
                ${mode.ledger.total_estimated_usd.toFixed(2)} / ${mode.spend_cap_usd.toFixed(0)}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className={cx("h-full rounded-full", spendPct > 80 ? "bg-rose-500" : "bg-sky-500")} style={{ width: `${spendPct}%` }} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Thin banner at the top of the content area when running in mock mode. */
export function MockBanner() {
  const [mode, setMode] = useState<ModeResponse | null>(null);
  useEffect(() => {
    fetch("/api/mode", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && setMode(m))
      .catch(() => undefined);
  }, []);
  if (mode?.mode !== "mock") return null;
  return (
    <div className="bg-amber-100 px-6 py-1.5 text-center text-xs font-medium text-amber-950">
      MOCK MODE — new runs use a mock agent and judge ({mode.reason}). Mock results are labelled and are not evidence.
    </div>
  );
}
