"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

const SUB_TABS = [
  { href: "/review", label: "Queue & traces", step: "Review", hint: "Run cases, read traces, answer the checklist" },
  { href: "/review/rubric", label: "Rubric", step: "Criteria", hint: "Edit the review checklist and the AI judge criterion" },
  { href: "/review/taxonomy", label: "Failure taxonomy", step: "Axial coding", hint: "Group reviewer notes into failure categories" },
  { href: "/review/gold", label: "Gold dataset", step: "Gold labels", hint: "Promote human-reviewed frozen cases with provenance" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/review") {
    // Queue & traces also owns the per-trace pages (/review/[traceId]).
    return pathname === "/review" || (pathname.startsWith("/review/") && !SUB_TABS.slice(1).some((t) => pathname.startsWith(t.href)));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sub-navigation inside the Trace Review tab. */
export default function ReviewLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/review";
  return (
    <div className="space-y-4">
      <nav aria-label="Trace review sections" className="flex flex-wrap gap-2">
        {SUB_TABS.map((t, i) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              title={t.hint}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ring-1 ring-inset transition-colors",
                active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
              )}
            >
              <span
                className={cx(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                  active ? "bg-white text-slate-900" : "bg-slate-100 text-slate-600",
                )}
              >
                {i + 1}
              </span>
              <span className="font-medium">{t.label}</span>
              <span className={cx("text-xs", active ? "text-slate-300" : "text-slate-400")}>{t.step}</span>
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
