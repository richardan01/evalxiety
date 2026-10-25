"use client";

import { useState } from "react";
import { getReviewer, setReviewer } from "@/lib/client/api";

/** Your name, remembered in this browser. Every human action (import, label, reveal, approval) is attributed to it. */
export function useName(): [string, (v: string) => void] {
  const [name, setName] = useState(() => getReviewer());
  return [
    name,
    (v: string) => {
      setName(v);
      setReviewer(v);
    },
  ];
}

export function NameField({ name, setName }: { name: string; setName: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">Your name</span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="required"
        className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

export const inputCls = "rounded border border-slate-300 px-2 py-1 text-sm";

/** POST JSON and return the status with the body, for callers that act on a specific status (409 confirm, 422 problems). */
export async function post<T = Record<string, unknown>>(url: string, payload: unknown): Promise<{ status: number; body: T & { error?: string; details?: string[] } }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** The error a failed response carries, in the words the API wrote it. */
export const errorOf = (body: { error?: string; details?: string[] }, status: number) =>
  `${body.error ?? `Request failed (${status})`}${Array.isArray(body.details) && body.details.length ? `: ${body.details.join("; ")}` : ""}`;

export function ErrorList({ error, problems }: { error: string | null; problems?: Array<{ line: number; message: string }> }) {
  if (!error && !problems?.length) return null;
  return (
    <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
      {error && <div className="font-medium">{error}</div>}
      {problems && problems.length > 0 && (
        <ul className="mt-1 max-h-60 list-disc overflow-auto pl-5 text-xs">
          {problems.map((p, i) => (
            <li key={i}>
              {p.line > 0 && <b>Line {p.line}: </b>}
              {p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pretty-print any trace value: text as text, JSON as indented JSON. */
export function Pretty({ value, className }: { value: unknown; className?: string }) {
  let v = value;
  if (typeof v === "string" && /^\s*[[{]/.test(v)) {
    try {
      v = JSON.parse(v);
    } catch {
      /* keep text */
    }
  }
  return (
    <pre className={`max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-800 ${className ?? ""}`}>
      {typeof v === "string" ? v : v === undefined ? "—" : JSON.stringify(v, null, 2)}
    </pre>
  );
}
