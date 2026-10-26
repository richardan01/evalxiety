"use client";

/**
 * Add a test (a run): import the agent's answers (a JSONL file, or a spreadsheet with a question or case id column and
 * an answer column), or call the agent's HTTP endpoint on every visible case.
 */
import { useMemo, useState } from "react";
import { ANSWER_WORDS, CASE_ID_WORDS, guessColumn, looksLikeTable, parseTable, QUESTION_WORDS, type Table } from "@/lib/agents/csv";
import { Button, Callout, Card, cx, fmtUsd } from "@/components/ui";
import { runWords } from "@/lib/launcher";
import { ColumnSelect } from "../ColumnSelect";
import { TokenField } from "../TokenField";
import type { AgentOverview } from "../types";
import { ErrorList, inputCls, NameField, post, useName } from "./shared";

type Problem = { line: number; message: string };

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
  // A pasted or uploaded spreadsheet (anything that isn't JSONL) needs its columns mapped before import.
  const sheet = useMemo((): { table: Table | null; error: string | null } => {
    if (!looksLikeTable(text)) return { table: null, error: null };
    try {
      return { table: parseTable(text), error: null };
    } catch (e) {
      return { table: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);
  const [cols, setCols] = useState<{ answer: number | null; by: "question" | "case_id"; question: number | null; case_id: number | null } | null>(null);
  // Rules that read a field (e.g. `answer`) need spreadsheet answers in that field, like answers that came over HTTP.
  const [asField, setAsField] = useState(view.agent.answer_field !== null);
  const header = sheet.table?.header ?? [];
  const guessed = {
    answer: guessColumn(header, ANSWER_WORDS),
    by: (guessColumn(header, CASE_ID_WORDS) !== null ? "case_id" : "question") as "question" | "case_id",
    question: guessColumn(header, QUESTION_WORDS),
    case_id: guessColumn(header, CASE_ID_WORDS),
  };
  const map = cols ?? guessed;
  const sheetReady = !sheet.table || (map.answer !== null && (map.by === "case_id" ? map.case_id !== null : map.question !== null));
  const source = sheet.table
    ? {
        format: "csv" as const,
        mapping: {
          answer: map.answer,
          answer_field: asField ? view.agent.answer_field : null,
          question: map.by === "question" ? map.question : null,
          case_id: map.by === "case_id" ? map.case_id : null,
        },
      }
    : {};
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
      const { status, body } = await post(`${base}/import`, { text, ...source, agent_version: version, actor: name, dry_run: dryRun });
      const lockedNote = (ids: string[] | undefined) =>
        ids?.length ? ` ${ids.length} row(s) are final-exam questions and were left out while they're locked (${ids.join(", ")}).` : "";
      if (dryRun && status === 200) {
        const b = body as { ok: boolean; problems: Problem[]; lines: number; missing_case_ids: string[]; skipped_locked?: string[] };
        if (b.ok) {
          setNotice(
            `Looks good: ${b.lines} answer(s).${b.missing_case_ids.length ? ` No answer for ${b.missing_case_ids.length} case(s): ${b.missing_case_ids.join(", ")} — the test will be incomplete.` : ""}${lockedNote(b.skipped_locked)}`,
          );
        } else setProblems(b.problems);
        return;
      }
      if (status === 201 || status === 200) {
        const b = body as { created: boolean; missing_case_ids: string[]; skipped_locked?: string[] };
        const missing = b.missing_case_ids.length ? ` No answer for ${b.missing_case_ids.join(", ")}, so this test is incomplete.` : "";
        setNotice((b.created ? "Imported." : "This exact file was already imported — nothing new was added.") + missing + lockedNote(b.skipped_locked));
        setText("");
        setCols(null);
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
    setCols(null);
    reset();
  }

  const conn = view.agent.connection;
  return (
    <Card
      title="Add a test"
      subtitle="First test the version you ship today (the current version), then your change (the new version)."
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
          <span className="text-slate-600">Version name</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} list="version-labels" placeholder="e.g. prompt-v2 or a git SHA" className={cx(inputCls, "w-56")} />
          <datalist id="version-labels">
            {labels.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>
        <span className="text-xs text-slate-500">Testing the same version again? Reuse its exact name. Just trying out a rule? Start the name with scratch- so it&apos;s never picked by default.</span>
      </div>

      {tab === "import" ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            A spreadsheet (CSV, or cells pasted from Google Sheets or Excel) with a question column and an answer column, or JSONL, one line per case:{" "}
            <code>{`{"case_id": "c01", "output": ..., "evidence": [{"id": "...", "text": "..."}]}`}</code>. JSONL can also carry <code>tool_calls</code>,{" "}
            <code>model_id</code>, <code>latency_ms</code>, <code>cost_usd</code>, <code>error</code> and <code>metadata</code>.
            {view.agent.example && (
              <>
                {" "}
                Try it: upload <code>agents/{view.agent.agent_id}/traces.v1-baseline.jsonl</code> as <b>v1</b>, then <code>traces.v2-candidate.jsonl</code> as{" "}
                <b>v2</b>.
              </>
            )}
          </p>
          <input type="file" accept=".jsonl,.json,.txt,.csv,.tsv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCols(null);
            }}
            rows={5}
            placeholder="…or paste JSONL, or cells copied from a spreadsheet (with the header row)"
            className={cx(inputCls, "w-full font-mono text-xs")}
          />
          {sheet.error && <div className="text-xs text-rose-700">Couldn&apos;t read this as a spreadsheet: {sheet.error}</div>}
          {sheet.table && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
              <div className="text-slate-700">
                Spreadsheet with {sheet.table.rows.length} row{sheet.table.rows.length === 1 ? "" : "s"}. Which columns hold the answer, and which test case each row is?
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ColumnSelect label="Agent's answer" header={header} value={map.answer} onChange={(v) => setCols({ ...map, answer: v })} />
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-600">Match rows by</span>
                  <select value={map.by} onChange={(e) => setCols({ ...map, by: e.target.value as "question" | "case_id" })} className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs">
                    <option value="question">question text</option>
                    <option value="case_id">case id</option>
                  </select>
                </label>
                {map.by === "question" ? (
                  <ColumnSelect label="Question" header={header} value={map.question} onChange={(v) => setCols({ ...map, question: v })} />
                ) : (
                  <ColumnSelect label="Case id" header={header} value={map.case_id} onChange={(v) => setCols({ ...map, case_id: v })} />
                )}
              </div>
              {view.agent.answer_field && (
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-600">Store each answer as</span>
                  <select value={asField ? "field" : "text"} onChange={(e) => setAsField(e.target.value === "field")} className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs">
                    <option value="field">the “{view.agent.answer_field}” field (what your rules read)</option>
                    <option value="text">plain text</option>
                  </select>
                </label>
              )}
              <div className="text-slate-500">
                Questions are matched to your test cases ignoring capitals and extra spaces. Final-exam questions are left out while they&apos;re locked. Import every
                version the same way (or with answers in the same shape), so a difference in format doesn&apos;t show up as a fix or a regression.
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy || !text.trim() || !sheetReady} onClick={() => importFile(true)}>
              Check file
            </Button>
            <Button disabled={busy || !text.trim() || !ready || !sheetReady} onClick={() => importFile(false)} title={ready ? undefined : "Enter your name and a version name"}>
              Import answers
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
                Sends <code>{conn.env_sent.join(", ")}</code> (your agent&apos;s token) to <b>{conn.host}</b>.
              </>
            )}
          </p>
          {conn.unsafe && (
            <Callout tone="red" title="Connection refused">
              {conn.unsafe}
            </Callout>
          )}
          {conn.missing_env.length > 0 && (
            <Callout tone="red" title={conn.missing_env.length === 1 ? "Your agent's token is missing" : "Your agent's tokens are missing"}>
              <div className="space-y-3">
                {conn.missing_env.map((n) => {
                  const prefix = `EVALXIETY_AGENT_${view.agent.agent_id.toUpperCase().replace(/-/g, "_")}_`;
                  return n.startsWith(prefix) ? (
                    <TokenField key={n} agentId={view.agent.agent_id} suffix={n.slice(prefix.length)} onSaved={onDone} />
                  ) : (
                    <div key={n}>
                      Set <code>{n}</code> in {runWords(view.launcher).settingsFile} and restart the app.
                    </div>
                  );
                })}
              </div>
            </Callout>
          )}
          {view.agent.example && (
            <p className="text-xs text-slate-500">
              Start the toy agent first: <code>{runWords(view.launcher).exampleAgent} --version=v1</code> (then <code>--version=v2</code> for the candidate).
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
            <Button disabled={busy || !ready || conn.missing_env.length > 0 || !!conn.unsafe} onClick={() => runHttp(false)} title={ready ? undefined : "Enter your name and a version name"}>
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
