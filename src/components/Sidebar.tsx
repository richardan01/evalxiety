"use client";

/**
 * App sidebar. Your own agents come first (each one linked by name, plus "Connect your agent"); the built-in pricing
 * demo sits under "Learn on the demo", folded away once you have an agent of your own.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "./ui";
import { Mascot } from "./Mascot";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  hint: string;
}

const DEMO: Array<{ section: string; items: NavItem[] }> = [
  {
    section: "Demo · review",
    items: [
      { href: "/demo", label: "Dashboard", icon: "▦", hint: "The pricing demo's eval progress and release status" },
      { href: "/review", label: "Review traces", icon: "✎", hint: "Label agent answers (open coding)" },
      { href: "/review/taxonomy", label: "Axial coding", icon: "⧉", hint: "Group your notes into failure types" },
      { href: "/review/rubric", label: "Rubric", icon: "☰", hint: "Checklist and AI judge criterion" },
      { href: "/review/gold", label: "Gold set", icon: "★", hint: "Reviewed answers kept as reference" },
    ],
  },
  {
    section: "Demo · evaluate",
    items: [
      { href: "/evaluators", label: "Checks", icon: "✓", hint: "Code checks and AI judge calibration" },
      { href: "/experiments", label: "Experiments", icon: "⇄", hint: "Baseline vs corrected on frozen cases" },
      { href: "/release", label: "Release gate", icon: "⚑", hint: "Ship or not" },
    ],
  },
];

const DEMO_PATHS = DEMO.flatMap((g) => g.items.map((i) => i.href));

interface ModeResponse {
  mode: "live" | "mock";
  reason: string;
  model_id: string;
  spend_cap_usd: number;
  ledger: { total_estimated_usd: number; live_calls: number };
}

interface AgentRow {
  agent_id: string;
  name: string;
  example: boolean;
  status: string | null;
}

const STATUS_DOT: Record<string, string> = {
  NO_SHIP: "bg-rose-500",
  INSUFFICIENT_EVIDENCE: "bg-amber-400",
  ELIGIBLE_FOR_DEMO_APPROVAL: "bg-sky-400",
  APPROVED_FOR_DEMO: "bg-emerald-400",
};
const STATUS_LABEL: Record<string, string> = {
  NO_SHIP: "Not ready to ship",
  INSUFFICIENT_EVIDENCE: "Not enough evidence yet",
  ELIGIBLE_FOR_DEMO_APPROVAL: "Ready for your decision",
  APPROVED_FOR_DEMO: "Approved",
};

function isActive(pathname: string, href: string) {
  if (href === "/review") {
    return pathname === "/review" || (pathname.startsWith("/review/") && !["/review/taxonomy", "/review/rubric", "/review/gold"].some((p) => pathname.startsWith(p)));
  }
  if (href === "/agents") return pathname === "/agents";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, dot }: { item: NavItem; active: boolean; dot?: string }) {
  return (
    <Link
      href={item.href}
      title={item.hint}
      className={cx(
        "mb-0.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-slate-800 text-white ring-1 ring-inset ring-slate-700" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
      )}
    >
      {dot ? (
        <span aria-hidden className="flex w-4 justify-center">
          <span className={cx("h-2 w-2 rounded-full", dot)} />
        </span>
      ) : (
        <span aria-hidden className={cx("w-4 text-center", active ? "text-sky-400" : "text-slate-500")}>
          {item.icon}
        </span>
      )}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{children}</div>;
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const [mode, setMode] = useState<ModeResponse | null>(null);
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [demoOpen, setDemoOpen] = useState<boolean | null>(null);
  // Agents can be created (wizard) or change status while you work on them, so refresh on every agent page.
  const agentsKey = pathname.startsWith("/agents") ? pathname : "";

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

  useEffect(() => {
    let alive = true;
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && Array.isArray(d.agents) && setAgents(d.agents))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [agentsKey]);

  const own = agents?.filter((a) => !a.example) ?? [];
  const onDemo = DEMO_PATHS.some((h) => isActive(pathname, h));
  const showDemo = demoOpen ?? (own.length === 0 || onDemo);

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-slate-950 text-slate-300 print:hidden">
      <Link href="/" className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <Mascot mood="worried" size={34} />
        <span>
          <span className="block text-sm font-semibold text-white">Evalxiety</span>
          <span className="block text-[11px] text-slate-500">Nervous before shipping</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3">
        <div className="mb-3">
          <NavLink item={{ href: "/start", label: "Start here", icon: "➜", hint: "Your agent's path to a release decision, and how the method works" }} active={isActive(pathname, "/start")} />
        </div>

        <div className="mb-3">
          <SectionLabel>Your agents</SectionLabel>
          {own.map((a) => (
            <NavLink
              key={a.agent_id}
              item={{ href: `/agents/${a.agent_id}`, label: a.name, icon: "◎", hint: a.status ? STATUS_LABEL[a.status] ?? a.status : a.name }}
              active={isActive(pathname, `/agents/${a.agent_id}`)}
              dot={a.status ? STATUS_DOT[a.status] ?? "bg-slate-500" : "bg-slate-600"}
            />
          ))}
          <NavLink
            item={{ href: "/agents", label: own.length ? "All agents" : "Evaluate your agent", icon: "◎", hint: "Every agent folder, its status, and the starter kit" }}
            active={isActive(pathname, "/agents")}
          />
          <Link
            href="/agents?connect=1"
            className="mb-0.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sky-300 transition-colors hover:bg-slate-900 hover:text-sky-200"
            title="Test your agent's endpoint, pick starter rules and paste test questions (about 3 minutes)"
          >
            <span aria-hidden className="w-4 text-center">+</span>
            Connect your agent
          </Link>
        </div>

        <div className="mb-3">
          <button
            type="button"
            onClick={() => setDemoOpen(!showDemo)}
            aria-expanded={showDemo}
            className="flex w-full items-center justify-between px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-300"
            title="A built-in pricing agent with real results, for learning the method"
          >
            Learn on the demo
            <span aria-hidden>{showDemo ? "▴" : "▾"}</span>
          </button>
          {showDemo &&
            DEMO.map((group) => (
              <div key={group.section} className="mb-2">
                <div className="px-2 pb-0.5 pt-1 text-[10px] text-slate-600">{group.section}</div>
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
                ))}
              </div>
            ))}
        </div>

        <div className="mb-3">
          <SectionLabel>Integrate</SectionLabel>
          <NavLink item={{ href: "/connect", label: "Connect (MCP)", icon: "⌁", hint: "Claude Desktop / Claude Code" }} active={isActive(pathname, "/connect")} />
        </div>
      </nav>

      <div className="border-t border-slate-800 px-3 py-3 text-xs">
        <Link
          href="/connect"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-slate-300 transition-colors hover:bg-slate-900 hover:text-white"
          title="Connect your Claude API key and your agent"
        >
          <span className={cx("h-2 w-2 shrink-0 rounded-full", mode?.mode === "live" ? "bg-emerald-400" : mode ? "bg-amber-400" : "bg-slate-600")} />
          <span className="flex-1">{!mode ? "Checking…" : mode.mode === "live" ? "AI connected" : "Connect your AI"}</span>
          <span aria-hidden className="text-slate-500">→</span>
        </Link>
      </div>
    </aside>
  );
}

/** Thin banner at the top of the content area when running in mock mode. */
export function MockBanner() {
  const pathname = usePathname() ?? "/";
  const [mode, setMode] = useState<ModeResponse | null>(null);
  useEffect(() => {
    fetch("/api/mode", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && setMode(m))
      .catch(() => undefined);
  }, []);
  if (mode?.mode !== "mock") return null;
  return (
    <div className="bg-amber-100 px-6 py-1.5 text-center text-xs font-medium text-amber-950 print:hidden">
      {pathname.startsWith("/agents")
        ? `MOCK MODE (${mode.reason}) — your agent's answers are real; only the AI reviewer is mocked, and it only runs on starter-kit data.`
        : `MOCK MODE — new runs use a mock agent and judge (${mode.reason}). Mock results are labelled and are not evidence.`}
    </div>
  );
}
