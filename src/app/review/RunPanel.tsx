"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJSON, getReviewer, postJSON } from "@/lib/client/api";
import type { MerchantScenario, Trace } from "@/lib/domain/schemas";
import type { AgentConfig } from "@/lib/agent/configs";
import { Button, InfoTip, SplitBadge, cx, fmtRate } from "@/components/ui";

type ScenarioRow = MerchantScenario & { split: "dev" | "heldout" | null };

function customTemplate(row: ScenarioRow): string {
  const scenario: Partial<ScenarioRow> = { ...row, case_id: "CUSTOM-1", title: "My custom scenario" };
  delete scenario.split;
  return JSON.stringify(scenario, null, 2);
}

const labelCls = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400";
const selectCls = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

/**
 * Collapsed "Run a new case" panel. Executes ONE pricing case (single API call) and opens it for review.
 * Batches live in the Experiments tab and require confirmation.
 */
export function RunPanel({ onRan, defaultOpen = false }: { onRan?: (t: Trace) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          <span aria-hidden className={cx("inline-block text-xs text-slate-400 transition-transform", open && "rotate-90")}>
            ▶
          </span>
          Run a new case
        </button>
        <InfoTip>
          Runs the agent once on one case, saves the answer and opens it for review. Live mode makes one Claude API call
          (identical requests are cached and cost $0). Batches live in Experiments.
        </InfoTip>
      </div>
      {open && <RunForm onRan={onRan} />}
    </section>
  );
}

function RunForm({ onRan }: { onRan?: (t: Trace) => void }) {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState("C01");
  const [configId, setConfigId] = useState("pricing-agent@corrected-v2");
  const [custom, setCustom] = useState(false);
  const [customJson, setCustomJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJSON<{ scenarios: ScenarioRow[]; agent_configs: AgentConfig[] }>("/api/scenarios")
      .then((d) => {
        setScenarios(d.scenarios);
        setConfigs(d.agent_configs);
        if (d.scenarios[0]) setCustomJson(customTemplate(d.scenarios[0]));
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const selected = scenarios.find((s) => s.case_id === caseId);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      let scenario: unknown;
      if (custom) {
        try {
          scenario = JSON.parse(customJson);
        } catch (e) {
          throw new Error(`Custom case is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const actor = getReviewer() || undefined;
      const payload = custom
        ? { config_id: configId, scenario, actor }
        : { config_id: configId, case_id: caseId, actor };
      const { trace } = await postJSON<{ trace: Trace }>("/api/run", payload);
      onRan?.(trace);
      router.push(`/review/${trace.trace_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-100 px-4 py-3">
      {loadError && <p className="mb-2 text-sm text-rose-700">Couldn&apos;t load cases: {loadError}</p>}
      <div className="grid gap-3 md:grid-cols-[1fr_14rem_auto] md:items-end">
        <label className="text-sm">
          <span className={labelCls}>Case</span>
          <select
            className={selectCls}
            value={custom ? "__custom" : caseId}
            onChange={(e) => {
              if (e.target.value === "__custom") setCustom(true);
              else {
                setCustom(false);
                setCaseId(e.target.value);
              }
            }}
          >
            {scenarios.map((s) => (
              <option key={s.case_id} value={s.case_id}>
                {s.case_id} — {s.title}
                {s.split === "heldout" ? " · held-out" : ""}
              </option>
            ))}
            <option value="__custom">Custom JSON…</option>
          </select>
        </label>
        <label className="text-sm">
          <span className={labelCls}>Version</span>
          <select className={selectCls} value={configId} onChange={(e) => setConfigId(e.target.value)}>
            {configs.map((c) => (
              <option key={c.config_id} value={c.config_id} title={c.config_id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={run} disabled={busy || scenarios.length === 0}>
          {busy ? "Running…" : "Run once"}
        </Button>
      </div>
      {selected && !custom && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <SplitBadge split={selected.split} />
          {selected.decision_date} · asks{" "}
          {fmtRate(selected.request.requested_pricing.rate_bps, selected.request.requested_pricing.per_txn_fee_usd)}
        </p>
      )}
      {custom && (
        <>
          <p className="mt-2 text-xs text-slate-500">Custom cases sit outside dev/held-out and never become gold.</p>
          <textarea
            className="mt-1 h-64 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
            value={customJson}
            onChange={(e) => setCustomJson(e.target.value)}
            spellCheck={false}
          />
        </>
      )}
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
