"use client";

import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { Badge, Button, cx, fmtDateTime } from "@/components/ui";
import type { AuditResponse } from "./types";

function detailText(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
}

/** (h) Collapsible recent audit log. Loads on first open; reloads when `reloadToken` changes while open. */
export function AuditLog({ reloadToken }: { reloadToken: number }) {
  const [open, setOpen] = useState(false);
  const [releaseOnly, setReleaseOnly] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AuditResponse | null; error: string | null } | null>(null);
  const key = `${reloadToken}|${nonce}`;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getJSON<AuditResponse>("/api/audit")
      .then((data) => alive && setResult({ key, data, error: null }))
      .catch((e: unknown) => alive && setResult({ key, data: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [open, key]);

  const loading = open && result?.key !== key;
  const events = (result?.data?.events ?? []).filter((e) => !releaseOnly || e.action.startsWith("release."));

  return (
    <details
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-slate-700">
        Audit log <span className="font-normal text-slate-400">· latest 200</span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={releaseOnly} onChange={(e) => setReleaseOnly(e.target.checked)} />
            Release decisions only
          </label>
          <Button variant="secondary" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
          {result?.data && (
            <span className="text-xs text-slate-500">
              {events.length} of {result.data.total}
            </span>
          )}
        </div>
        {result?.error && <p className="text-sm text-rose-700">{result.error}</p>}
        {result?.data && events.length === 0 && (
          <p className="text-sm text-slate-500">
            {releaseOnly ? "No release decisions yet." : "The audit log is empty."}
          </p>
        )}
        {events.length > 0 && (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-1 pr-2">When</th>
                  <th className="pr-2">Actor</th>
                  <th className="pr-2">Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.event_id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap py-1 pr-2 text-slate-500">{fmtDateTime(e.at)}</td>
                    <td className="pr-2 font-medium text-slate-800">{e.actor}</td>
                    <td className="whitespace-nowrap pr-2">
                      {e.action.startsWith("release.") ? (
                        <Badge tone={e.action === "release.approval_blocked" ? "amber" : "blue"}>{e.action}</Badge>
                      ) : (
                        <code className="font-mono text-slate-700">{e.action}</code>
                      )}
                    </td>
                    <td className={cx("break-all font-mono text-[11px] text-slate-600")}>{detailText(e.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
