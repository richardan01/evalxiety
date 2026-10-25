"use client";

/**
 * Test cases without JSON: add a question, edit or remove one, or have Claude draft practice questions that a person
 * accepts one by one (they stay marked AI-drafted). Locked final-exam cases are listed without their content and can't
 * be changed or removed before they're unlocked.
 */
import { useState } from "react";
import { expectedFromText, expectedShape, inputFromText, textFromExpected, textFromInput, type ExpectedShape, type InputShape } from "@/lib/agents/define";
import { Badge, Button, cx, SplitBadge } from "@/components/ui";
import type { AgentOverview, DefinitionView } from "../types";
import { errorOf, ErrorList, inputCls, NameField, post, useName } from "./shared";

type CaseRow = DefinitionView["cases"][number];
type SaveResult = { needs_lock?: boolean; next_version?: number | null };

const inputLabel = (s: InputShape) => (s.kind === "field" ? `Question (sent to your agent as “${s.key}”)` : s.kind === "text" ? "Question (sent to your agent as is)" : "Input (JSON, like your other cases)");
const expectedLabel = (s: ExpectedShape) => (s === "json" ? "Reference answer (JSON, like your other cases; optional)" : "Reference answer (optional: shown to reviewers, used by “matches the reference answer” rules)");

function useSave(agentId: string, def: DefinitionView, onSaved: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(payload: Record<string, unknown>, what: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const { status, body } = await post<SaveResult>(`/api/agents/${agentId}/cases`, { ...payload, base: def.definition_hash });
      if (status >= 400) {
        setError(errorOf(body, status));
        return false;
      }
      onSaved(
        body.needs_lock
          ? `${what} Before the next test, lock the cases as v${body.next_version} (the box above), so old and new results aren't compared as if they were on the same questions.`
          : what,
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, save };
}

export function CaseEditor({ view, def, onChanged }: { view: AgentOverview; def: DefinitionView; onChanged: () => void }) {
  const agentId = view.agent.agent_id;
  const [panel, setPanel] = useState<"add" | "draft" | "list" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const expShape = expectedShape(def.cases.filter((c) => !c.locked).map((c) => c.expected));
  const saved = (message: string) => {
    setNotice(message);
    onChanged();
  };
  const toggle = (p: NonNullable<typeof panel>) => {
    setNotice(null);
    setPanel((cur) => (cur === p ? null : p));
  };

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={panel === "add" ? "primary" : "secondary"} onClick={() => toggle("add")}>
          Add a test case
        </Button>
        <Button variant={panel === "draft" ? "primary" : "secondary"} onClick={() => toggle("draft")}>
          Draft questions with Claude
        </Button>
        <Button variant={panel === "list" ? "primary" : "ghost"} onClick={() => toggle("list")}>
          {panel === "list" ? "Hide cases" : `See and edit all ${def.cases.length} cases`}
        </Button>
      </div>
      {notice && <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div>}
      {panel === "add" && <AddCase agentId={agentId} def={def} expShape={expShape} onSaved={(m) => (setPanel(null), saved(m))} />}
      {panel === "draft" && <DraftCases agentId={agentId} def={def} onSaved={(m) => (setPanel(null), saved(m))} />}
      {panel === "list" && <CaseList agentId={agentId} def={def} expShape={expShape} onSaved={saved} />}
    </div>
  );
}

function AddCase({ agentId, def, expShape, onSaved }: { agentId: string; def: DefinitionView; expShape: ExpectedShape; onSaved: (m: string) => void }) {
  const [name, setName] = useName();
  const [question, setQuestion] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [finalExam, setFinalExam] = useState(false);
  const { busy, error, setError, save } = useSave(agentId, def, onSaved);

  async function add() {
    let input: unknown;
    let exp: unknown;
    try {
      input = inputFromText(def.input_shape, question.trim());
      exp = expectedFromText(expShape, expected);
    } catch (e) {
      return setError(e instanceof Error ? e.message : String(e));
    }
    await save(
      { action: "add", actor: name, cases: [{ input, ...(exp !== undefined ? { expected: exp } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}), split: finalExam ? "heldout" : "dev" }] },
      finalExam ? "Added as a final-exam case: it's locked from now on, until you unlock the final exam." : "Added.",
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-sky-200 bg-sky-50/40 p-3 text-sm">
      <label className="block">
        <span className="text-xs font-medium text-slate-700">{inputLabel(def.input_shape)}</span>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={def.input_shape.kind === "json" ? 4 : 2} className={cx(inputCls, "mt-1 w-full", def.input_shape.kind === "json" && "font-mono")} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">{expectedLabel(expShape)}</span>
        <textarea value={expected} onChange={(e) => setExpected(e.target.value)} rows={expShape === "json" ? 3 : 2} className={cx(inputCls, "mt-1 w-full", expShape === "json" && "font-mono")} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">What it tests (optional, shown to reviewers)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Refund just outside the 30-day window" className={cx(inputCls, "mt-1 w-full")} />
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={finalExam} onChange={(e) => setFinalExam(e.target.checked)} className="mt-0.5" />
        <span>
          Final exam: hidden and locked from now on, so nobody tunes the agent on it. Only you will have seen it; it unlocks with the rest of the final exam.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <NameField name={name} setName={setName} />
        <Button disabled={busy || !name.trim() || !question.trim()} onClick={add}>
          Add test case
        </Button>
      </div>
      <ErrorList error={error} />
    </div>
  );
}

function DraftCases({ agentId, def, onSaved }: { agentId: string; def: DefinitionView; onSaved: (m: string) => void }) {
  const [name, setName] = useName();
  const [request, setRequest] = useState("");
  const [count, setCount] = useState(5);
  const [drafts, setDrafts] = useState<Array<{ text: string; notes: string; keep: boolean }> | null>(null);
  const [drafting, setDrafting] = useState(false);
  const { busy, error, setError, save } = useSave(agentId, def, onSaved);
  const live = def.mode === "live";
  const kept = drafts?.filter((d) => d.keep && d.text.trim()) ?? [];

  async function draft() {
    setDrafting(true);
    setError(null);
    const { status, body } = await post<{ drafts: Array<{ input: unknown; notes: string }> }>(`/api/agents/${agentId}/cases`, { action: "draft", actor: name, request, count, fresh: drafts !== null });
    setDrafting(false);
    if (status >= 400) return setError(errorOf(body, status));
    setDrafts(body.drafts.map((d) => ({ text: textFromInput(def.input_shape, d.input), notes: d.notes, keep: true })));
  }

  async function add() {
    let cases;
    try {
      cases = kept.map((d) => ({ input: inputFromText(def.input_shape, d.text.trim()), ...(d.notes.trim() ? { notes: d.notes.trim() } : {}), split: "dev", origin: "ai_drafted" }));
    } catch (e) {
      return setError(e instanceof Error ? e.message : String(e));
    }
    await save({ action: "add", actor: name, cases }, `Added ${cases.length} practice question(s), marked AI-drafted.`);
  }

  const edit = (i: number, patch: Partial<{ text: string; notes: string; keep: boolean }>) => setDrafts((ds) => ds && ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="mt-3 space-y-3 rounded-md border border-sky-200 bg-sky-50/40 p-3 text-sm">
      <p className="text-xs text-slate-600">
        Claude proposes new practice questions like the ones you have; you keep the ones worth testing. They&apos;re marked <b>AI-drafted</b> on the case and in the release report, so nobody mistakes them for real traffic.
        {live ? " Sends your agent's name, description and up to 20 practice questions to Claude (never final-exam questions). Billed; a few cents." : ""}
      </p>
      {!live && <p className="text-xs text-amber-800">Drafting needs a Claude API key: connect one on the Connect page. You can still add questions yourself with “Add a test case”.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="What to cover, e.g. angry customers asking for refunds after the deadline" className={cx(inputCls, "min-w-72 flex-1")} />
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={inputCls} aria-label="How many">
          {[3, 5, 10].map((n) => (
            <option key={n} value={n}>
              {n} questions
            </option>
          ))}
        </select>
        <NameField name={name} setName={setName} />
        <Button variant="secondary" disabled={!live || drafting || busy || !name.trim()} onClick={draft}>
          {drafting ? "Drafting…" : drafts ? "Draft again" : "Draft"}
        </Button>
      </div>
      {drafts && drafts.length === 0 && <p className="text-xs text-slate-600">Claude didn&apos;t propose anything new. Try another request.</p>}
      {drafts && drafts.length > 0 && (
        <>
          <ul className="space-y-2">
            {drafts.map((d, i) => (
              <li key={i} className={cx("rounded border bg-white p-2", d.keep ? "border-slate-200" : "border-slate-100 opacity-60")}>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={d.keep} onChange={(e) => edit(i, { keep: e.target.checked })} /> Keep
                  <Badge tone="purple">AI-drafted</Badge>
                </label>
                <textarea value={d.text} onChange={(e) => edit(i, { text: e.target.value })} rows={def.input_shape.kind === "json" ? 3 : 2} className={cx(inputCls, "mt-1 w-full", def.input_shape.kind === "json" && "font-mono")} aria-label={`Drafted question ${i + 1}`} />
                <input value={d.notes} onChange={(e) => edit(i, { notes: e.target.value })} className={cx(inputCls, "mt-1 w-full text-xs")} aria-label={`What drafted question ${i + 1} tests`} />
              </li>
            ))}
          </ul>
          <Button disabled={busy || !name.trim() || kept.length === 0} onClick={add}>
            Add {kept.length} practice question{kept.length === 1 ? "" : "s"}
          </Button>
        </>
      )}
      <ErrorList error={error} />
    </div>
  );
}

function CaseList({ agentId, def, expShape, onSaved }: { agentId: string; def: DefinitionView; expShape: ExpectedShape; onSaved: (m: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <ul className="mt-3 divide-y divide-slate-100 rounded border border-slate-200">
      {def.cases.map((c) => (
        <li key={c.case_id} className="p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium">{c.case_id}</span>
            {c.split === "heldout" && <SplitBadge split="heldout" />}
            {c.origin === "ai_drafted" && <Badge tone="purple" title="Claude proposed this question and a person accepted it">AI-drafted</Badge>}
            {c.locked && <span className="text-xs text-violet-800">🔒 hidden until the final exam is unlocked</span>}
            {!c.locked && editing !== c.case_id && removing !== c.case_id && (
              <span className="ml-auto flex gap-3 text-xs">
                <button type="button" className="text-sky-700 hover:underline" onClick={() => setEditing(c.case_id)}>
                  Edit
                </button>
                <button type="button" className="text-slate-500 hover:text-rose-700 hover:underline" onClick={() => setRemoving(c.case_id)}>
                  Remove
                </button>
              </span>
            )}
          </div>
          {editing === c.case_id ? (
            <EditCase agentId={agentId} def={def} row={c} expShape={expShape} onCancel={() => setEditing(null)} onSaved={(m) => (setEditing(null), onSaved(m))} />
          ) : removing === c.case_id ? (
            <RemoveCase agentId={agentId} def={def} row={c} onCancel={() => setRemoving(null)} onSaved={(m) => (setRemoving(null), onSaved(m))} />
          ) : (
            !c.locked && (
              <div className="mt-0.5 text-slate-800">
                <span className="whitespace-pre-wrap">{truncate(textFromInput(def.input_shape, c.input))}</span>
                {c.expected !== null && (
                  <div className="text-xs text-slate-500">Reference: {truncate(expShape === "json" ? JSON.stringify(c.expected) : textFromExpected(expShape, c.expected), 160)}</div>
                )}
                {c.notes && <div className="text-xs text-slate-500">Tests: {c.notes}</div>}
              </div>
            )
          )}
          {c.locked && c.notes && <div className="text-xs text-slate-500">Tests: {c.notes}</div>}
        </li>
      ))}
    </ul>
  );
}

const truncate = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

function EditCase({ agentId, def, row, expShape, onCancel, onSaved }: { agentId: string; def: DefinitionView; row: CaseRow; expShape: ExpectedShape; onCancel: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useName();
  const [question, setQuestion] = useState(textFromInput(def.input_shape, row.input));
  const [expected, setExpected] = useState(textFromExpected(expShape, row.expected));
  const [notes, setNotes] = useState(row.notes ?? "");
  const { busy, error, setError, save } = useSave(agentId, def, onSaved);

  async function submit() {
    let input: unknown;
    let exp: unknown;
    try {
      input = inputFromText(def.input_shape, question.trim());
      exp = expectedFromText(expShape, expected);
    } catch (e) {
      return setError(e instanceof Error ? e.message : String(e));
    }
    await save({ action: "update", actor: name, case_id: row.case_id, input, ...(exp !== undefined ? { expected: exp } : { expected: null }), notes: notes.trim() || undefined }, `Saved ${row.case_id}.`);
  }

  return (
    <div className="mt-2 space-y-2">
      <label className="block">
        <span className="text-xs font-medium text-slate-700">{inputLabel(def.input_shape)}</span>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={def.input_shape.kind === "json" ? 4 : 2} className={cx(inputCls, "mt-1 w-full", def.input_shape.kind === "json" && "font-mono")} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">{expectedLabel(expShape)}</span>
        <textarea value={expected} onChange={(e) => setExpected(e.target.value)} rows={2} className={cx(inputCls, "mt-1 w-full", expShape === "json" && "font-mono")} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">What it tests</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={cx(inputCls, "mt-1 w-full")} />
      </label>
      <p className="text-xs text-slate-500">Changing the question or reference answer means locking the cases as a new version before the next test; earlier tests stay on the old version.</p>
      <div className="flex flex-wrap items-center gap-2">
        <NameField name={name} setName={setName} />
        <Button disabled={busy || !name.trim() || !question.trim()} onClick={submit}>
          Save
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ErrorList error={error} />
    </div>
  );
}

function RemoveCase({ agentId, def, row, onCancel, onSaved }: { agentId: string; def: DefinitionView; row: CaseRow; onCancel: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useName();
  const { busy, error, save } = useSave(agentId, def, onSaved);
  return (
    <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2">
      <div className="text-rose-900">Remove {row.case_id}? Earlier tests keep their answer to it; new tests won&apos;t ask it. Logged under your name.</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <NameField name={name} setName={setName} />
        <Button variant="danger" disabled={busy || !name.trim()} onClick={() => save({ action: "remove", actor: name, case_id: row.case_id }, `Removed ${row.case_id}.`)}>
          Remove case
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ErrorList error={error} />
    </div>
  );
}
