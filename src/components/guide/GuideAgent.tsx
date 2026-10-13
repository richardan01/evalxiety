"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { demoSteps, type DemoStep } from "@/app/_overview/demoPath";
import type { ModeData, OverviewData } from "@/app/_overview/types";
import { nextStep } from "@/lib/guide/next";
import { Mascot, moodFor } from "../Mascot";
import { cx } from "../ui";
import { Markdown } from "./Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STORE_KEY = "agenttrust.guide.chat";
const SEEN_KEY = "agenttrust.guide.seen";

const PAGE_SUGGESTIONS: Array<[string, string[]]> = [
  ["/review/taxonomy", ["How do I group my notes into failure modes?", "Why are seed categories only hypotheses?"]],
  ["/review/gold", ["What makes a trace gold?", "Dev vs held-out — what's the difference?"]],
  ["/review", ["Walk me through reviewing my first trace", "What should I write as the first failure?"]],
  ["/evaluators", ["What's the difference between the checks and the judge?", "How do I read TPR and TNR?"]],
  ["/experiments", ["How do I compare Baseline vs Corrected?", "What counts as a regression?"]],
  ["/release", ["Why is my release blocked?", "What do I need for demo approval?"]],
  ["/start", ["Where should I begin?", "Explain the 5 stages"]],
  ["/connect", ["How do I connect Claude Code?", "What can the MCP tools do?"]],
  ["/", ["Give me the 5-minute tour", "What does each page do?"]],
];

function suggestionsFor(path: string): string[] {
  const hit = PAGE_SUGGESTIONS.find(([p]) => (p === "/" ? path === "/" : path.startsWith(p)));
  return [
    "What do I do on this page?",
    "What's my next step?",
    ...(hit?.[1] ?? []),
    "How do I evaluate my own agent?",
  ];
}

const STEP_ICON: Record<DemoStep["state"], string> = { done: "✓", todo: "", neutral: "·" };

export function GuideAgent() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(true);
  const [steps, setSteps] = useState<DemoStep[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeData | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore chat + first-visit flag.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved) setMessages(JSON.parse(saved));
      setSeen(localStorage.getItem(SEEN_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages]);

  const refresh = useCallback(() => {
    fetch("/api/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((o: OverviewData | null) => {
        if (!o) return;
        setSteps(demoSteps(o));
        setStatus(o.release_status);
      })
      .catch(() => undefined);
    fetch("/api/mode", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMode)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    if (open) {
      refresh();
      inputRef.current?.focus();
      if (!seen) {
        setSeen(true);
        try {
          localStorage.setItem(SEEN_KEY, "1");
        } catch {
          /* ignore */
        }
      }
    }
  }, [open, refresh, seen]);

  // Keyboard: Cmd/Ctrl+J toggles, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const history: Msg[] = [...messages, { role: "user", content: q }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setInput("");
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/guide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page: pathname, messages: history.slice(-20) }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages([...history, { role: "assistant", content: acc }]);
        }
        if (!acc.trim()) setMessages([...history, { role: "assistant", content: "_No answer came back — try again._" }]);
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === "AbortError";
        setMessages((m) => {
          const last = m[m.length - 1];
          const note = aborted ? "_(stopped)_" : `⚠️ ${e instanceof Error ? e.message : String(e)}`;
          return [...m.slice(0, -1), { role: "assistant", content: last?.content ? `${last.content}\n\n${note}` : note }];
        });
      } finally {
        setBusy(false);
        abortRef.current = null;
        refresh();
      }
    },
    [busy, messages, pathname, refresh],
  );

  const done = steps?.filter((s) => s.state === "done").length ?? 0;
  const next = steps ? nextStep(steps) : null;
  const live = mode?.mode === "live";
  const mood = status ? moodFor(status) : "worried";

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="guide-panel"
        className={cx(
          "fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-full bg-slate-900 py-2.5 pl-3 pr-5 text-left text-white shadow-lg shadow-slate-900/20 ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-slate-800",
          open && "pointer-events-none translate-y-2 opacity-0",
        )}
      >
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white">
          <Mascot mood={mood} size={32} />
          {!seen && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-ping rounded-full bg-amber-400" />}
          {!seen && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-amber-400" />}
        </span>
        <span>
          <span className="block text-sm font-semibold leading-tight">Ask the Guide</span>
          <span className="block text-[11px] leading-tight text-slate-300">
            {next ? `Next: step ${next.n} · ${next.title}` : steps ? "All tracked steps done" : "How to use Evalxiety"}
          </span>
        </span>
      </button>

      {/* Backdrop on small screens */}
      {open && <div className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px] lg:hidden" onClick={() => setOpen(false)} />}

      {/* Panel */}
      <aside
        id="guide-panel"
        aria-label="Evalxiety Guide"
        className={cx(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        <header className="bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-900 px-5 pb-4 pt-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ring-white/20">
                <Mascot mood={mood} size={34} />
              </span>
              <div>
                <h2 className="text-base font-semibold leading-tight">Evalxiety Guide</h2>
                <p className="text-xs text-indigo-200">Nervous so your launch doesn&apos;t have to be</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {mode && (
                <span
                  title={live ? "Answers come from Claude and count toward your spend cap" : `Offline answers (${mode.reason})`}
                  className={cx(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ring-1",
                    live ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/40" : "bg-amber-400/15 text-amber-200 ring-amber-300/40",
                  )}
                >
                  {live ? "LIVE · CLAUDE" : "OFFLINE"}
                </span>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close guide"
                className="rounded-md p-1 text-indigo-200 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Progress */}
          {steps && (
            <div className="mt-4">
              <button type="button" onClick={() => setShowSteps((s) => !s)} className="flex w-full items-center justify-between text-xs">
                <span className="font-medium text-indigo-100">
                  Demo path · {done}/{steps.length} done
                </span>
                <span className="text-indigo-300">{showSteps ? "Hide steps ▴" : "Show steps ▾"}</span>
              </button>
              <div className="mt-2 flex gap-1">
                {steps.map((s) => (
                  <span
                    key={s.n}
                    title={`${s.n}. ${s.title}`}
                    className={cx(
                      "h-1.5 flex-1 rounded-full",
                      s.state === "done" ? "bg-emerald-400" : s === next ? "bg-amber-300" : "bg-white/20",
                    )}
                  />
                ))}
              </div>
            </div>
          )}
        </header>

        {steps && showSteps && (
          <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 px-3 py-2">
            <ol className="space-y-1">
              {steps.map((s) => {
                const isNext = s === next;
                return (
                  <li key={s.n}>
                    <Link
                      href={s.href}
                      title={s.detail}
                      className={cx(
                        "group flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm transition",
                        isNext ? "bg-white shadow-sm ring-1 ring-amber-300" : "hover:bg-white",
                      )}
                    >
                      <span
                        className={cx(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                          s.state === "done"
                            ? "bg-emerald-500 text-white"
                            : isNext
                              ? "bg-amber-400 text-amber-950"
                              : "bg-slate-200 text-slate-600",
                        )}
                      >
                        {STEP_ICON[s.state] || s.n}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cx("block font-medium", s.state === "done" ? "text-slate-500" : "text-slate-800")}>
                          {s.title}
                          {isNext && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">DO THIS NEXT</span>}
                        </span>
                        {isNext && <span className="mt-0.5 block text-xs text-slate-500">{s.detail}</span>}
                      </span>
                      <span className="mt-0.5 text-slate-300 group-hover:text-slate-500">→</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Hi! I&apos;m your (slightly nervous) guide.</p>
              <p className="mt-1">
                Evalxiety worries about whether an AI agent is really ready to ship: you run it, judge its answers yourself,
                turn the failures you find into automatic checks, compare fixes, and make a release decision. Ask me anything, or tap a
                question below. New here? Open{" "}
                <Link href="/start" className="font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2">
                  Start here
                </Link>{" "}
                for the full path.
              </p>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-sm text-white shadow-sm">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="flex gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs text-white">
                  ✦
                </span>
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-slate-50 px-3.5 py-2.5 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200">
                  {m.content ? (
                    <Markdown text={m.content} onNavigate={() => window.innerWidth < 1024 && setOpen(false)} />
                  ) : (
                    <span className="flex items-center gap-1 py-1" aria-label="Thinking">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" />
                      <span className="ml-2 text-xs text-slate-400">thinking…</span>
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
        </div>

        {/* Suggestions + input */}
        <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-3">
          <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {suggestionsFor(pathname).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => send(s)}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-1.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Ask how to use Evalxiety or evaluate your agent…"
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-300"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
              >
                Send
              </button>
            )}
          </form>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>{live ? "Claude answers ≈ $0.02–0.05 each · counts toward your spend cap" : "Offline answers are free"}</span>
            <span className="flex items-center gap-2">
              {messages.length > 0 && !busy && (
                <button type="button" onClick={() => setMessages([])} className="hover:text-slate-600">
                  Clear
                </button>
              )}
              <kbd className="rounded border border-slate-200 px-1 font-mono">⌘J</kbd>
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
