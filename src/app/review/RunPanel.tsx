"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJSON, getReviewer, postJSON } from "@/lib/client/api";
import type { MerchantScenario, Trace } from "@/lib/domain/schemas";
import type { AgentConfig } from "@/lib/agent/configs";
import { Button, Card, SplitBadge, fmtRate } from "@/components/ui";

type ScenarioRow = MerchantScenario & { split: "dev" | "heldout" | null };

function customTemplate(row: ScenarioRow): string {
  const scenario: Partial<ScenarioRow> = { ...row, case_id: "CUSTOM-1", title: "My custom scenario" };
  delete scenario.split;
  return JSON.stringify(scenario, null, 2);
}

/** Execute ONE pricing case (single API call). Batches live in the Experiments tab and require confirmation. */
export function RunPanel({ onRan }: { onRan?: (t: Trace) => void }) {
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
          throw new Error(`Custom scenario is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
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
    <Card
      title="Execute a pricing case"
      subtitle="Runs the agent once on one scenario, saves the trace and opens it for review. One Claude API call in live mode (cached identical requests cost $0)."
    >
      {loadError && <p className="mb-2 text-sm text-rose-700">Could not load scenarios: {loadError}</p>}
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Scenario</span>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
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
                {s.case_id} — {s.title} {s.split === "heldout" ? "[HELD-OUT]" : ""}
              </option>
            ))}
            <option value="__custom">Custom scenario (JSON)…</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Agent configuration</span>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            value={configId}
            onChange={(e) => setConfigId(e.target.value)}
          >
            {configs.map((c) => (
              <option key={c.config_id} value={c.config_id}>
                {c.label} — {c.config_id}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={run} disabled={busy || scenarios.length === 0}>
          {busy ? "Running…" : "Run agent"}
        </Button>
      </div>
      {selected && !custom && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <SplitBadge split={selected.split} /> decision date {selected.decision_date} · requested{" "}
          {fmtRate(selected.request.requested_pricing.rate_bps, selected.request.requested_pricing.per_txn_fee_usd)} ·{" "}
          {selected.variation && Object.values(selected.variation).join(" · ")}
          {selected.split === "heldout" && (
            <span className="text-violet-700">· held-out: label it, but do not use it for prompt tuning</span>
          )}
        </p>
      )}
      {custom && (
        <>
          <p className="mt-2 text-xs text-slate-500">
            Custom scenarios are tagged user-supplied with a CUSTOM- id. They are outside the frozen dev/held-out split, so they
            never join frozen sets or the gold dataset.
          </p>
          <textarea
            className="mt-2 h-64 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
            value={customJson}
            onChange={(e) => setCustomJson(e.target.value)}
            spellCheck={false}
          />
        </>
      )}
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </Card>
  );
}
