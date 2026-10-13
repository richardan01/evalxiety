"use client";

import Link from "next/link";
import { useState } from "react";
import { Mascot, moodFor } from "@/components/Mascot";
import { StatusPill, cx } from "@/components/ui";
import { headline, worries } from "./worries";
import type { OverviewData } from "./types";

const DOT: Record<string, string> = { blocker: "bg-rose-500", evidence: "bg-amber-400", caveat: "bg-slate-300" };

/** Evalxiety reads the evidence and says what it's nervous about. */
export function EvalxietyBanner({ o, next }: { o: OverviewData; next: { href: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const all = worries(o);
  const top = all[0];
  const rest = all.slice(1);
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        <Mascot mood={moodFor(o.release_status)} size={60} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={o.release_status} />
            <span className="text-base font-semibold text-slate-900">“{headline(o.release_status)}”</span>
          </div>
          {top && (
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-700">
              <span className={cx("inline-block h-2 w-2 shrink-0 rounded-full", DOT[top.level])} />
              {top.text}
              {rest.length > 0 && (
                <button type="button" onClick={() => setOpen((v) => !v)} className="whitespace-nowrap text-xs text-sky-700 hover:underline">
                  {open ? "hide" : `+${rest.length} more worr${rest.length === 1 ? "y" : "ies"}`}
                </button>
              )}
            </p>
          )}
        </div>
        <Link href={next.href} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          {next.label} →
        </Link>
      </div>
      {open && (
        <ul className="mt-3 space-y-1.5 border-t border-slate-100 pl-[76px] pt-3">
          {rest.map((w) => (
            <li key={w.text} className="flex items-center gap-2 text-sm text-slate-700">
              <span className={cx("inline-block h-2 w-2 shrink-0 rounded-full", DOT[w.level])} />
              <Link href={w.href} className="hover:underline">
                {w.text}
              </Link>
            </li>
          ))}
          <li className="pt-1 text-xs text-slate-400">● blocks release · ● missing evidence · ● caveat</li>
        </ul>
      )}
    </section>
  );
}
