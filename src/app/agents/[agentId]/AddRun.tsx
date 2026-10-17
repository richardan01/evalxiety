"use client";

/** Add a run: import a JSONL file, or call the agent's HTTP endpoint on every visible case. */
import { useState } from "react";
import { Button, Callout, Card, cx, fmtUsd } from "@/components/ui";
import type { AgentOverview } from "../types";
import { ErrorList, inputCls, NameField, useName } from "./shared";

type Problem = { line: number; message: string };

async function post(url: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export function AddRun({ view, onDone }: { view: AgentOverview; onDone: () => void }) {
  // The starter-kit tour starts with an import; your own agent defaults to HTTP when it has a connection.
  const [tab, setTab] = useState<"import" | "http">(view.agent.connection && !view.agent.example ? "http" : "import");
  // Suggest each version once (as first written), from completed non-scratch runs.
  const labels = [
    ...new Map(
      view.runs
        .filter((r) => r.status === "completed" && !r.agent_version.trim().toLowerCase().startsWith("scratch-"))
        .map((r) => [r.agent_version.trim().toLowerCase(), r.agent_version.trim()] as const),
    ).values(),
  ];
  const [name, setName] = useName();
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState<{ message: string } | null>(null);
  const base = `/api/agents/${view.agent.agent_id}`;
  const ready = name.trim() && version.trim();

  function reset() {
    setError(null);
    setProblems([]);
    setNotice(null);
  }

  async function importFile(dryRun: boolean) {
    reset();
    setBusy(true);
    try {
      const { status, body } = await post(`${base}/import`, { text, agent_version: version, actor: name, dry_run: dryRun });
      if (dryRun && status === 200) {
        const b = body as { ok: boolean; problems: Problem[]; lines: number; missing_case_ids: string[] };
        if (b.ok) setNotice(`Looks good: ${b.lines} trace(s).${b.missing_case_ids.length ? ` No trace for ${b.missing_case_ids.length} case(s): ${b.missing_case_ids.join(", ")} — the run will be incomplete.` : ""}`);
        else setProblems(b.problems);
        return;
      }
      if (status === 201 || status === 200) {
        const b = body as { created: boolean; missing_case_ids: string[] };
        const missing = b.missing_case_ids.length ? ` No trace for ${b.missing_case_ids.join(", ")}, so this run is incomplete.` : "";
        setNotice((b.created ? "Imported." : "This exact file was already imported — nothing new was added.") + missing);
        setText("");
        onDone();
        return;
      }
      setError(String(body.error ?? `Import failed (${status})`));
      if (Array.isArray(body.problems)) setProblems(body.problems as Problem[]);
    } finally {
      setBusy(false);
    }
  }

  async function runHttp(confirmed: boolean) {
    reset();
    setBusy(true);
    try {
      const { status, body } = await post(`${base}/run`, { agent_version: version, actor: name, confirm_batch: confirmed });
      if (status === 409 && body.confirmation_required) {
        setConfirm({ message: String(body.error) });
        return;
      }
      setConfirm(null);
      if (status === 202) {
        setNotice("Running — results appear below as each case finishes.");
        onDone();
        return;
      }
      setError(String(body.error ?? `Run failed (${status})`));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setText(await f.text());
    reset();
  }

  const conn = view.agent.connection;
  return (
    <Card
      title="Add a run"
      subtitle="Run the version you ship today as the baseline, then your change as the candidate."
      actions={
        <div className="flex rounded-md bg-slate-100 p-0.5 text-xs">
          {(["import", "http"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                reset();
              }}
              className={cx("rounded px-2.5 py-1 font-medium", tab === t ? "bg-white shadow-sm" : "text-slate-600")}
            >
              {t === "import" ? "Import a file" : "Call my agent (HTTP)"}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <NameField name={name} setName={setName} />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Version label</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} list="version-labels" placeholder="e.g. prompt-v2 or a git SHA" className={cx(inputCls, "w-56")} />
          <datalist id="version-labels">
            {labels.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>
        <span className="text-xs text-slate-500">Re-running a version? Reuse its exact label. Testing a check? Start the label with scratch- so it&apos;s never a default.</span>
      </div>

      {tab === "import" ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            JSONL, one line per case: <code>{`{"case_id": "c01", "output": ..., "evidence": [{"id": "...", "text": "..."}]}`}</code>. Optional:{" "}
            <code>tool_calls</code>, <code>model_id</code>, <code>latency_ms</code>, <code>cost_usd</code>, <code>error</code>, <code>metadata</code>.
            {view.agent.example && (
              <>
                {" "}
                Try it: upload <code>agents/{view.agent.agent_id}/traces.v1-baseline.jsonl</code> as <b>v1</b>, then <code>traces.v2-candidate.jsonl</code> as{" "}
                <b>v2</b>.
              </>
            )}
          </p>
          <input type="file" accept=".jsonl,.json,.txt" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="…or paste JSONL here" className={cx(inputCls, "w-full font-mono text-xs")} />
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy || !text.trim()} onClick={() => importFile(true)}>
              Check file
            </Button>
            <Button disabled={busy || !text.trim() || !ready} onClick={() => importFile(false)} title={ready ? undefined : "Enter your name and a version label"}>
              Import run
            </Button>
          </div>
        </div>
      ) : conn ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-slate-600">
            POSTs <code>{`{"case_id", "input"}`}</code> to <code>{conn.url}</code> for each case
            {conn.header_names.length ? (
              <>
                {" "}
                with header(s) <code>{conn.header_names.join(", ")}</code>
              </>
            ) : null}
            . Cost per call: {conn.cost_per_call_usd === null ? "unknown" : fmtUsd(conn.cost_per_call_usd, 4)}.
            {conn.env_sent.length > 0 && (
              <>
                {" "}
                Sends <code>{conn.env_sent.join(", ")}</code> from <code>.env.local</code> to <b>{conn.host}</b>.
              </>
            )}
          </p>
          {conn.unsafe && (
            <Callout tone="red" title="Connection refused">
              {conn.unsafe}
            </Callout>
          )}
          {conn.missing_env.length > 0 && (
            <Callout tone="red" title="Missing secrets">
              Set {conn.missing_env.map((n) => <code key={n}>{n} </code>)} in <code>.env.local</code> and restart the app.
            </Callout>
          )}
          {view.agent.example && (
            <p className="text-xs text-slate-500">
              Start the toy agent first: <code>npm run example-agent -- --version=v1</code> (then <code>--version=v2</code> for the candidate).
            </p>
          )}
          {confirm ? (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2">
              <p>{confirm.message}</p>
              <div className="mt-2 flex gap-2">
                <Button disabled={busy} onClick={() => runHttp(true)}>
                  Confirm and run
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button disabled={busy || !ready || conn.missing_env.length > 0 || !!conn.unsafe} onClick={() => runHttp(false)} title={ready ? undefined : "Enter your name and a version label"}>
              Run on {view.cases.filter((c) => !c.locked).length} cases
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          No HTTP endpoint configured. Add <code>{`"connection": {"type": "http", "url": "http://localhost:8000/agent"}`}</code> to{" "}
          <code>agents/{view.agent.agent_id}/agent.json</code>, or import a file instead.
        </p>
      )}
      <div className="mt-3 space-y-2">
        <ErrorList error={error} problems={problems} />
        {notice && <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div>}
      </div>
    </Card>
  );
}
