"use client";

import { Badge, Callout, Card, KeyValue, cx } from "@/components/ui";
import { paragraphDiff } from "./promptDiff";
import { humanize } from "./shared";
import type { AgentConfigRow } from "./types";

export function ConfigsSection({ configs, modelId }: { configs: AgentConfigRow[]; modelId: string }) {
  const baseline = configs.find((c) => c.role === "baseline");
  const corrected = configs.find((c) => c.role === "corrected");
  if (!baseline || !corrected) {
    return <Callout tone="red">Expected one baseline and one corrected agent configuration; the API returned {configs.length}.</Callout>;
  }
  const rows = paragraphDiff(baseline.system_prompt, corrected.system_prompt);
  const changed = rows.filter((r) => r.changed);
  const identical = rows.filter((r) => !r.changed);
  const sameEffort = baseline.effort === corrected.effort;
  const sameRetrieval = baseline.retrieval_strategy === corrected.retrieval_strategy;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {[baseline, corrected].map((c) => (
          <Card
            key={c.config_id}
            title={
              <span className="flex items-center gap-2">
                {c.label}
                <Badge tone={c.role === "baseline" ? "neutral" : "blue"}>{c.role}</Badge>
              </span>
            }
            subtitle={<code className="font-mono">{c.config_id}</code>}
          >
            <KeyValue
              rows={[
                ["Prompt version", <code key="p" className="font-mono">{c.prompt_version}</code>],
                [
                  "Retrieval strategy",
                  <span key="r" className={cx(!sameRetrieval && "rounded bg-amber-100 px-1 font-medium")}>
                    {humanize(c.retrieval_strategy)}
                  </span>,
                ],
                ["Effort", c.effort],
                ["Description", <span key="d" className="text-slate-700">{c.description}</span>],
              ]}
            />
          </Card>
        ))}
      </div>

      <Callout tone="slate" title="What is held constant, and what changes">
        <ul className="list-disc space-y-0.5 pl-5">
          <li>
            Both configurations call the <b>same model</b> (<code className="font-mono">{modelId}</code> in live mode; the mock agent in
            mock mode), with the <b>same effort</b> ({sameEffort ? baseline.effort : `${baseline.effort} vs ${corrected.effort} — NOT the same`}), the{" "}
            <b>same structured output schema</b> and the same approval/citation instructions, and they run on the <b>same frozen cases</b>.
          </li>
          <li>
            They differ in {sameRetrieval ? "" : <><b>retrieval strategy</b> ({humanize(baseline.retrieval_strategy)} → {humanize(corrected.retrieval_strategy)}) and </>}
            <b>{changed.length} system-prompt paragraph{changed.length === 1 ? "" : "s"}</b>
            {changed.length === 1 ? " — the policy-selection rule, highlighted below" : ""}. So any difference in results is attributable to policy
            handling, not to the model.
          </li>
        </ul>
      </Callout>

      <Card
        title="System prompts side by side"
        subtitle="Paragraph-level diff computed from the live prompt text. Highlighted rows differ; everything else is word-for-word identical."
      >
        <div className="grid grid-cols-2 gap-3 pb-2 text-xs font-semibold text-slate-600">
          <div>
            {baseline.label} · <code className="font-mono">{baseline.prompt_version}</code>
          </div>
          <div>
            {corrected.label} · <code className="font-mono">{corrected.prompt_version}</code>
          </div>
        </div>
        <div className="space-y-2">
          {changed.map((r, i) => (
            <div key={`c${i}`} className="grid grid-cols-2 gap-3">
              <PromptBlock text={r.left} tone="removed" label={changed.length === 1 ? "Differs — policy selection" : `Difference ${i + 1}`} />
              <PromptBlock text={r.right} tone="added" label={changed.length === 1 ? "Differs — policy selection" : `Difference ${i + 1}`} />
            </div>
          ))}
          <details className="rounded border border-slate-200">
            <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium text-slate-600">
              Show the {identical.length} identical paragraph{identical.length === 1 ? "" : "s"} (shared instructions)
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
      </Card>
    </div>
  );
}

function PromptBlock({ text, tone, label }: { text: string | null; tone: "removed" | "added" | "same"; label?: string }) {
  if (text === null) {
    return <div className="rounded border border-dashed border-slate-300 px-3 py-2 text-xs italic text-slate-400">(no paragraph)</div>;
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
      {label && <div className="mb-1 text-[10px] font-semibold tracking-wide uppercase">{label}</div>}
      {text}
    </div>
  );
}
