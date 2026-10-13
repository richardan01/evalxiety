"use client";

import { cx } from "@/components/ui";
import { paragraphDiff } from "./promptDiff";
import { humanize } from "./shared";
import type { AgentConfigRow } from "./types";

function pickPair(configs: AgentConfigRow[]) {
  const baseline = configs.find((c) => c.role === "baseline");
  const corrected = configs.find((c) => c.role === "corrected");
  return baseline && corrected ? { baseline, corrected } : null;
}

/** One-line summary for the collapsed section header. */
export function configsSummary(configs: AgentConfigRow[]): string {
  const p = pickPair(configs);
  if (!p) return "";
  const changed = paragraphDiff(p.baseline.system_prompt, p.corrected.system_prompt).filter((r) => r.changed).length;
  const parts = [];
  if (p.baseline.retrieval_strategy !== p.corrected.retrieval_strategy) {
    parts.push(`policy lookup: ${humanize(p.baseline.retrieval_strategy)} → ${humanize(p.corrected.retrieval_strategy)}`);
  }
  parts.push(`${changed} prompt paragraph${changed === 1 ? "" : "s"} changed`);
  return parts.join(" · ");
}

export function ConfigsSection({ configs, modelId }: { configs: AgentConfigRow[]; modelId: string }) {
  const p = pickPair(configs);
  if (!p) {
    return <p className="text-sm text-rose-700">Expected one Baseline and one Corrected version; the API returned {configs.length}.</p>;
  }
  const { baseline, corrected } = p;
  const rows = paragraphDiff(baseline.system_prompt, corrected.system_prompt);
  const changed = rows.filter((r) => r.changed);
  const identical = rows.filter((r) => !r.changed);
  const facts: Array<[string, string, string]> = [
    ["Policy lookup", humanize(baseline.retrieval_strategy), humanize(corrected.retrieval_strategy)],
    ["Prompt", baseline.prompt_version, corrected.prompt_version],
    ["Effort", baseline.effort, corrected.effort],
  ];

  return (
    <div className="space-y-3">
      <table className="w-full max-w-3xl text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr className="border-b border-slate-100">
            <th className="py-1.5 pr-3 font-medium" />
            <th className="py-1.5 pr-3 font-medium" title={baseline.description}>
              {baseline.label} <code className="font-mono text-[11px] font-normal text-slate-400">{baseline.config_id}</code>
            </th>
            <th className="py-1.5 font-medium" title={corrected.description}>
              {corrected.label} <code className="font-mono text-[11px] font-normal text-slate-400">{corrected.config_id}</code>
            </th>
          </tr>
        </thead>
        <tbody>
          {facts.map(([k, b, c]) => (
            <tr key={k} className="border-b border-slate-50">
              <td className="py-1.5 pr-3 text-slate-500">{k}</td>
              <td className={cx("py-1.5 pr-3", b !== c && "font-medium text-rose-800")}>{b}</td>
              <td className={cx("py-1.5", b !== c && "font-medium text-emerald-800")}>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">
        Same model (<code className="font-mono">{modelId}</code>), same output schema, same cases — only policy handling changes.
      </p>

      <div className="space-y-2">
        {changed.map((r, i) => (
          <div key={`c${i}`} className="grid grid-cols-2 gap-3">
            <PromptBlock text={r.left} tone="removed" label={`${baseline.label} prompt`} />
            <PromptBlock text={r.right} tone="added" label={`${corrected.label} prompt`} />
          </div>
        ))}
        <details className="rounded border border-slate-200">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-slate-600 select-none">
            {identical.length} identical paragraph{identical.length === 1 ? "" : "s"}
          </summary>
          <div className="space-y-2 border-t border-slate-200 p-2">
            {identical.map((r, i) => (
              <div key={`s${i}`} className="grid grid-cols-2 gap-3">
                <PromptBlock text={r.left} tone="same" />
                <PromptBlock text={r.right} tone="same" />
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

function PromptBlock({ text, tone, label }: { text: string | null; tone: "removed" | "added" | "same"; label?: string }) {
  if (text === null) {
    return <div className="rounded border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400 italic">(no paragraph)</div>;
  }
  return (
    <div
      className={cx(
        "rounded border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
        tone === "removed" && "border-rose-300 bg-rose-50 text-rose-950",
        tone === "added" && "border-emerald-300 bg-emerald-50 text-emerald-950",
        tone === "same" && "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {label && (
        <div className="mb-1 text-[10px] font-semibold tracking-wide uppercase">
          {tone === "removed" ? "− " : tone === "added" ? "+ " : ""}
          {label}
        </div>
      )}
      {text}
    </div>
  );
}
