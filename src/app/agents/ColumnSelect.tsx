"use client";

import { cx } from "@/components/ui";

/** Pick one column of an uploaded spreadsheet by its header; `optional` adds a "(none)" choice. */
export function ColumnSelect({ label, header, value, onChange, optional }: { label: string; header: string[]; value: number | null; onChange: (v: number | null) => void; optional?: boolean }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-600">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={cx("max-w-48 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs", !optional && value === null && "border-rose-400")}
      >
        {(optional || value === null) && <option value="">{optional ? "(none)" : "pick a column"}</option>}
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}
