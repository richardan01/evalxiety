"use client";

/**
 * Rules (code checks): the list, and adding or removing one without JSON. A person describes the rule (Claude can draft
 * it), tries it on the agent's latest answers and on a bad answer they write, and can add it only once it has failed at
 * least once. The server checks that again when it saves.
 */
import { useState } from "react";
import { EDITABLE_RULE_TYPES, expectedShape, patternToPhrases, phrasesToPattern, ruleIdFrom } from "@/lib/agents/define";
import type { RuleDraft } from "@/lib/agents/draft";
import type { RulePreview } from "@/lib/agents/rules";
import type { CheckConfig } from "@/lib/agents/schemas";
import { Badge, Button, Callout, Card, cx, EmptyState, OutcomeBadge, SeverityBadge } from "@/components/ui";
import type { AgentOverview, DefinitionView } from "../types";
import { errorOf, ErrorList, inputCls, NameField, post, useName } from "./shared";

type EditableType = (typeof EDITABLE_RULE_TYPES)[number]["type"];

interface Form {
  question: string;
  id: string;
  idTouched: boolean;
  type: EditableType;
  field: string;
  must: "match" | "no_match";
  phrases: string;
  pattern: string;
  useRegex: boolean;
  ignoreCase: boolean;
  /** Flags other than i on a drafted pattern, kept as they were. */
  extraFlags: string;
  max_words: string;
  max_chars: string;
  expected_field: string;
  mode: "exact" | "case_insensitive" | "contains";
  required_fields: string;
  citations_field: string;
  require_at_least_one: boolean;
  max: string;
  severity: "critical" | "major" | "minor";
  blocking: boolean;
  fix_hint: string;
}

const emptyForm = (field: string): Form => ({
  question: "",
  id: "",
  idTouched: false,
  type: "regex",
  field,
  must: "no_match",
  phrases: "",
  pattern: "",
  useRegex: false,
  ignoreCase: true,
  extraFlags: "",
  max_words: "",
  max_chars: "",
  expected_field: "",
  mode: "case_insensitive",
  required_fields: "",
  citations_field: "",
  require_at_least_one: false,
  max: "",
  severity: "major",
  blocking: false,
  fix_hint: "",
});

function formFromRule(r: CheckConfig, fallbackField: string): Form {
  const f: Form = { ...emptyForm(fallbackField), question: r.question, id: r.id, idTouched: true, type: r.type as EditableType, severity: r.severity, blocking: r.blocking, fix_hint: r.fix_hint ?? "" };
  switch (r.type) {
    case "regex": {
      const phrases = patternToPhrases(r.pattern);
      f.field = r.field;
      f.must = r.must;
      f.ignoreCase = r.flags.includes("i");
      f.extraFlags = r.flags.replace("i", "");
      if (phrases !== null && !f.extraFlags) f.phrases = phrases;
      else Object.assign(f, { useRegex: true, pattern: r.pattern });
      break;
    }
    case "non_empty":
      f.field = r.field;
      break;
    case "max_length":
      Object.assign(f, { field: r.field, max_words: r.max_words?.toString() ?? "", max_chars: r.max_chars?.toString() ?? "" });
      break;
    case "matches_expected":
      Object.assign(f, { field: r.field, expected_field: r.expected_field, mode: r.mode });
      break;
    case "json_output":
      f.required_fields = r.required_fields.join(", ");
      break;
    case "cites_evidence":
      Object.assign(f, { citations_field: r.citations_field, require_at_least_one: r.require_at_least_one });
      break;
    case "max_latency_ms":
    case "max_cost_usd":
      f.max = String(r.max);
      break;
  }
  return f;
}

/** The rule as the API takes it, or what's missing. */
function ruleFromForm(f: Form, taken: string[]): { rule: Record<string, unknown> | null; problem: string | null } {
  const no = (problem: string) => ({ rule: null, problem });
  const yes = (rule: Record<string, unknown>) => ({ rule, problem: null });
  if (!f.question.trim()) return no("Write the yes/no question this rule answers.");
  const base = {
    id: f.idTouched && f.id.trim() ? f.id.trim() : ruleIdFrom(f.question, taken),
    question: f.question.trim(),
    severity: f.severity,
    blocking: f.blocking,
    ...(f.fix_hint.trim() ? { fix_hint: f.fix_hint.trim() } : {}),
  };
  const field = f.field.trim();
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  switch (f.type) {
    case "regex": {
      const pattern = f.useRegex ? f.pattern.trim() : phrasesToPattern(f.phrases);
      if (!pattern) return no(f.useRegex ? "Write the pattern." : "Write at least one word or phrase.");
      return yes({ ...base, type: "regex", field, must: f.must, pattern, flags: `${f.ignoreCase ? "i" : ""}${f.extraFlags}` });
    }
    case "non_empty":
      if (!field) return no("Name the part of the answer that must be filled in. (A wholly empty answer already fails every rule.)");
      return yes({ ...base, type: "non_empty", field });
    case "max_length": {
      const w = num(f.max_words);
      const c = num(f.max_chars);
      if (w === undefined && c === undefined) return no("Set a word limit, a character limit, or both.");
      if ([w, c].some((x) => x !== undefined && !(Number.isInteger(x) && x > 0))) return no("Limits are whole numbers above 0.");
      return yes({ ...base, type: "max_length", field, ...(w !== undefined ? { max_words: w } : {}), ...(c !== undefined ? { max_chars: c } : {}) });
    }
    case "matches_expected":
      return yes({ ...base, type: "matches_expected", field, expected_field: f.expected_field.trim(), mode: f.mode });
    case "json_output":
      return yes({ ...base, type: "json_output", required_fields: f.required_fields.split(",").map((x) => x.trim()).filter(Boolean) });
    case "cites_evidence":
      if (!f.citations_field.trim()) return no("Name the part of the answer that lists the cited ids.");
      return yes({ ...base, type: "cites_evidence", citations_field: f.citations_field.trim(), require_at_least_one: f.require_at_least_one });
    case "max_latency_ms":
    case "max_cost_usd": {
      const m = num(f.max);
      if (m === undefined || !Number.isFinite(m) || m < 0 || (f.type === "max_latency_ms" && m === 0)) return no(f.type === "max_latency_ms" ? "Set the time limit in milliseconds (3000 = 3 seconds)." : "Set the cost limit in US dollars.");
      return yes({ ...base, type: f.type, max: m });
    }
    case "no_tool_errors":
      return yes({ ...base, type: "no_tool_errors" });
  }
}

const PROBE_LABEL: Partial<Record<EditableType, string>> = {
  max_latency_ms: "Try it on a slow answer: how long did it take? e.g. 9000 ms or 9 s",
  max_cost_usd: "Try it on an expensive answer: what did it cost? e.g. $0.50",
  no_tool_errors: "Try it on an answer where a tool call failed: write the tool's error, e.g. Timeout calling the orders API",
  json_output: "Try it on a bad answer: one that isn't JSON or lacks a field",
  cites_evidence: "Try it on a bad answer: an id it was never given (e.g. KB-99)",
};

// ---------------------------------------------------------------------------

export function ChecksCard({ view, def, onChanged }: { view: AgentOverview; def: DefinitionView | null; onChanged: () => void }) {
  const cand = view.runs.find((r) => r.run_id === view.selected.candidate);
  const editable = def?.editable ?? false;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [name, setName] = useName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function remove(id: string) {
    if (!def) return;
    setBusy(true);
    setError(null);
    try {
      const { status, body } = await post(`/api/agents/${view.agent.agent_id}/rules`, { action: "remove", actor: name, base: def.definition_hash, id });
      if (status >= 400) return setError(errorOf(body, status));
      setRemoving(null);
      setNotice(`Removed “${id}”. Every test's results were recomputed without it.`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Rules (code checks)"
      subtitle={
        editable ? (
          <>Automatic yes/no tests on every answer. No AI is involved in checking. Saved in <code>agents/{view.agent.agent_id}/agent.json</code>.</>
        ) : (
          <>Automatic yes/no tests on every answer, defined in <code>agents/{view.agent.agent_id}/agent.json</code>. No AI involved.</>
        )
      }
      actions={editable && !adding ? <Button onClick={() => (setAdding(true), setNotice(null))}>Add a rule</Button> : undefined}
    >
      {view.agent.example && <p className="mb-2 text-xs text-slate-500">The starter kit&apos;s rules are read-only. Connect your own agent to define its rules here.</p>}
      {notice && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div>}
      {adding && def && (
        <RuleEditor
          view={view}
          def={def}
          onCancel={() => setAdding(false)}
          onDone={(message) => {
            setAdding(false);
            setNotice(message);
            onChanged();
          }}
        />
      )}
      {view.checks.length === 0 ? (
        <EmptyState title="No rules yet">
          {editable ? (
            <>Add one with “Add a rule”: describe it in plain words, try it on your agent&apos;s answers, then add it.</>
          ) : (
            <>Add objective rules to <code>checks</code> in agent.json. See <code>docs/use-your-agent.md</code> for the rule types.</>
          )}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {view.checks.map((d) => {
            const t = cand?.summary.per_evaluator[d.evaluator_id];
            return (
              <li key={d.evaluator_id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{d.evaluator_id}</span>
                  <Badge>{d.type}</Badge>
                  <SeverityBadge severity={d.severity} />
                  {d.blocking && <Badge tone="red">blocking</Badge>}
                  {d.validation === "custom" && <Badge tone="purple" title="Your own TypeScript in agents/custom-checks.ts — force it to FAIL once to prove it can">custom code</Badge>}
                  {t && (
                    <span className="ml-auto text-xs text-slate-600">
                      new version: {t.pass} pass · <span className={cx(t.fail > 0 && "font-semibold text-rose-700")}>{t.fail} fail</span> · {t.not_applicable} n/a
                      {t.error ? <span className="text-purple-700"> · {t.error} error</span> : null}
                    </span>
                  )}
                  {editable && removing !== d.evaluator_id && (
                    <button type="button" className={cx("text-xs text-slate-500 hover:text-rose-700 hover:underline", !t && "ml-auto")} onClick={() => (setRemoving(d.evaluator_id), setError(null))}>
                      Remove
                    </button>
                  )}
                </div>
                <div className="mt-0.5 text-sm text-slate-700">{d.question}</div>
                <div className="text-xs text-slate-500">{d.rule}</div>
                {d.fix_hint && <div className="mt-0.5 text-xs text-slate-600">Fix: {d.fix_hint}</div>}
                {removing === d.evaluator_id && (
                  <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-sm">
                    <div className="text-rose-900">
                      Remove this rule? Every test&apos;s results change without it, and an approval already given no longer applies. The removal is logged under your name.
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <NameField name={name} setName={setName} />
                      <Button variant="danger" disabled={busy || !name.trim()} onClick={() => remove(d.evaluator_id)}>
                        Remove rule
                      </Button>
                      <Button variant="secondary" onClick={() => setRemoving(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2">
        <ErrorList error={error} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function RuleEditor({ view, def, onCancel, onDone }: { view: AgentOverview; def: DefinitionView; onCancel: () => void; onDone: (message: string) => void }) {
  const agentId = view.agent.agent_id;
  const url = `/api/agents/${agentId}/rules`;
  const taken = def.rules.map((r) => r.id);
  const defaultField = view.agent.answer_field ?? "";
  // References written as { "answer": … } (a spreadsheet's or the case editor's) are compared on their "answer".
  const defaultExpectedField = expectedShape(def.cases.filter((c) => !c.locked && c.expected !== null).map((c) => c.expected)) === "answer" && def.cases.some((c) => c.expected !== null) ? "answer" : "";
  const [name, setName] = useName();
  const [form, setForm] = useState<Form>(() => ({ ...emptyForm(defaultField), expected_field: defaultExpectedField }));
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [draftedByAi, setDraftedByAi] = useState(false);
  const [probe, setProbe] = useState("");
  const [probeCase, setProbeCase] = useState("");
  const [preview, setPreview] = useState<{ key: string; result: RulePreview } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<"draft" | "preview" | "add" | "judge" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const built = ruleFromForm(form, taken);
  const probeBody = probe.trim() || form.type === "non_empty" ? { answer: form.type === "non_empty" ? "(the rest of the answer)" : probe, ...(probeCase ? { case_id: probeCase } : {}) } : null;
  const key = JSON.stringify({ rule: built.rule, probe: probeBody });
  const fresh = preview?.key === key ? preview.result : null;
  const visibleCases = def.cases.filter((c) => !c.locked);
  const fields = def.answers.fields.map((f) => f.path);
  const hasField = !["json_output", "cites_evidence", "no_tool_errors", "max_latency_ms", "max_cost_usd"].includes(form.type);

  async function call<T>(kind: NonNullable<typeof busy>, payload: unknown, target = url): Promise<{ status: number; body: T & { error?: string; details?: string[] } } | null> {
    setBusy(kind);
    setError(null);
    try {
      return await post<T>(target, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function askClaude(again = false) {
    const res = await call<RuleDraft & { cost_usd: number | null }>("draft", { action: "draft", actor: name, request, fresh: again });
    if (!res) return;
    if (res.status >= 400) return setError(errorOf(res.body, res.status));
    setDraft(res.body);
    if (res.body.kind === "rule") {
      setForm(formFromRule(res.body.rule, defaultField));
      setProbe(res.body.bad_example ?? "");
      setDraftedByAi(true);
      setPreview(null);
    }
  }

  async function tryIt() {
    if (!built.rule) return;
    const res = await call<RulePreview>("preview", { action: "preview", rule: built.rule, probe: probeBody });
    if (!res) return;
    if (res.status >= 400) return setError(errorOf(res.body, res.status));
    setPreview({ key, result: res.body });
  }

  async function add() {
    if (!built.rule) return;
    const res = await call<{ preview?: RulePreview }>("add", { action: "add", actor: name, base: def.definition_hash, rule: built.rule, probe: probeBody, drafted_by_ai: draftedByAi });
    if (!res) return;
    if (res.status === 422 && res.body.preview) setPreview({ key, result: res.body.preview });
    if (res.status >= 400) return setError(errorOf(res.body, res.status));
    onDone(`Added “${built.rule.question}”. Every test's results now include it; an approval already given no longer applies.`);
  }

  async function saveAsReviewer(judge: { question: string; fail_definition: string; pass_definition: string }) {
    const res = await call(
      "judge",
      { actor: name, base: def.definition_hash, judge: { ...judge, model: def.judge?.model ?? "claude-sonnet-5-5" }, drafted_by_ai: true },
      `/api/agents/${agentId}/judge-config`,
    );
    if (!res) return;
    if (res.status >= 400) return setError(errorOf(res.body, res.status));
    onDone("Saved as the AI reviewer question. Run the AI reviewer on a test to see its verdicts; how far to trust it is measured against your labels.");
  }

  const rows = fresh ? [...fresh.results].sort((a, b) => rank(a.outcome) - rank(b.outcome)) : [];
  const typeInfo = EDITABLE_RULE_TYPES.find((t) => t.type === form.type)!;

  return (
    <div className="mb-4 rounded-md border border-sky-200 bg-sky-50/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">Add a rule</div>
        <NameField name={name} setName={setName} />
      </div>

      {/* 1. Describe */}
      <div className="mt-3">
        <label className="block text-xs font-medium text-slate-700" htmlFor="rule-request">
          1. Describe it in plain English <span className="font-normal text-slate-500">(optional: Claude drafts the rule, you check it)</span>
        </label>
        <div className="mt-1 flex flex-wrap items-start gap-2">
          <textarea
            id="rule-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={2}
            placeholder="e.g. The bot must never promise a refund or say “guaranteed”."
            className={cx(inputCls, "min-w-72 flex-1")}
          />
          <Button variant="secondary" disabled={busy !== null || def.mode !== "live" || !name.trim() || request.trim().length < 5} onClick={() => askClaude()}>
            {busy === "draft" ? "Drafting…" : "Draft with Claude"}
          </Button>
        </div>
        {def.mode !== "live" && <p className="mt-1 text-xs text-slate-500">Drafting needs a Claude API key (connect one on the Connect page). You can always fill in the rule yourself below.</p>}
        {def.mode === "live" && <p className="mt-1 text-xs text-slate-500">Sends the request, your agent&apos;s name and description, and the field names of its answers (not their content) to Claude. Billed; a few cents.</p>}
        {draft?.kind === "rule" && (
          <Callout tone="blue" title="Claude's draft is filled in below">
            {draft.explanation} Check it, then try it before adding it.{" "}
            <button type="button" className="underline" onClick={() => askClaude(true)} disabled={busy !== null}>
              Draft again
            </button>
          </Callout>
        )}
        {draft?.kind === "ai_reviewer" && (
          <Callout tone="blue" title="This needs judgement, so it fits the AI reviewer better than a rule">
            <p>{draft.explanation}</p>
            <dl className="mt-2 space-y-1 text-xs">
              <div><dt className="inline font-medium">Question: </dt><dd className="inline">{draft.judge.question}</dd></div>
              <div><dt className="inline font-medium">A problem is: </dt><dd className="inline">{draft.judge.fail_definition}</dd></div>
              <div><dt className="inline font-medium">Fine is: </dt><dd className="inline">{draft.judge.pass_definition}</dd></div>
            </dl>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button disabled={busy !== null || !name.trim()} onClick={() => saveAsReviewer(draft.judge)}>
                {def.judge ? "Replace the AI reviewer question" : "Use as the AI reviewer question"}
              </Button>
              {def.judge && <span className="text-xs text-slate-600">Replaces “{def.judge.question}”. A new question is a new reviewer: its agreement with your labels is measured again.</span>}
            </div>
          </Callout>
        )}
        {draft?.kind === "unclear" && (
          <Callout tone="amber" title="Claude couldn't make one rule out of this">
            {draft.explanation}
          </Callout>
        )}
      </div>

      {/* 2. The rule */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-slate-700">2. The yes/no question it answers (“yes” is good)</span>
          <input value={form.question} onChange={(e) => set({ question: e.target.value })} placeholder="e.g. Does the answer avoid promising refunds?" className={cx(inputCls, "mt-1 w-full")} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Kind of rule</span>
          <select value={form.type} onChange={(e) => set({ type: e.target.value as EditableType })} className={cx(inputCls, "mt-1 w-full")}>
            {EDITABLE_RULE_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-xs text-slate-500">{typeInfo.hint}</span>
        </label>
        {hasField && (
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Which part of the answer</span>
            <input value={form.field} onChange={(e) => set({ field: e.target.value })} list={`fields-${agentId}`} placeholder="the whole answer" className={cx(inputCls, "mt-1 w-full font-mono")} />
            <span className="mt-0.5 block text-xs text-slate-500">
              {fields.length ? `Your agent's answers have: ${fields.slice(0, 8).join(", ")}${fields.length > 8 ? "…" : ""}` : "Leave blank to check the whole answer."}
            </span>
          </label>
        )}
        <datalist id={`fields-${agentId}`}>
          {fields.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>

        {form.type === "regex" && (
          <div className="space-y-2 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>The answer must</span>
              <label className="flex items-center gap-1">
                <input type="radio" checked={form.must === "no_match"} onChange={() => set({ must: "no_match" })} /> not contain
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={form.must === "match"} onChange={() => set({ must: "match" })} /> contain
              </label>
              <label className="ml-auto flex items-center gap-1 text-xs">
                <input type="checkbox" checked={form.ignoreCase} onChange={(e) => set({ ignoreCase: e.target.checked })} /> ignore capitals
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={form.useRegex} onChange={(e) => set({ useRegex: e.target.checked, pattern: e.target.checked ? form.pattern || phrasesToPattern(form.phrases) : form.pattern })} /> write a regular expression
              </label>
            </div>
            {form.useRegex ? (
              <input value={form.pattern} onChange={(e) => set({ pattern: e.target.value })} placeholder="\b(guarantee|no questions asked)\b" className={cx(inputCls, "w-full font-mono")} aria-label="Regular expression" />
            ) : (
              <textarea value={form.phrases} onChange={(e) => set({ phrases: e.target.value })} rows={3} placeholder={"One word or phrase per line, e.g.\nguarantee\nno questions asked"} className={cx(inputCls, "w-full")} aria-label="Words or phrases" />
            )}
            {!form.useRegex && form.must === "match" && form.phrases.trim().includes("\n") && <p className="text-xs text-slate-500">Any one of these phrases is enough.</p>}
          </div>
        )}
        {form.type === "max_length" && (
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <label className="text-xs">
              At most <input value={form.max_words} onChange={(e) => set({ max_words: e.target.value })} inputMode="numeric" className={cx(inputCls, "w-20")} /> words
            </label>
            <label className="text-xs">
              and/or <input value={form.max_chars} onChange={(e) => set({ max_chars: e.target.value })} inputMode="numeric" className={cx(inputCls, "w-24")} /> characters
            </label>
          </div>
        )}
        {form.type === "matches_expected" && (
          <>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Which part of the reference answer</span>
              <input value={form.expected_field} onChange={(e) => set({ expected_field: e.target.value })} placeholder="the whole reference answer" className={cx(inputCls, "mt-1 w-full font-mono")} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">How close</span>
              <select value={form.mode} onChange={(e) => set({ mode: e.target.value as Form["mode"] })} className={cx(inputCls, "mt-1 w-full")}>
                <option value="case_insensitive">The same, ignoring capitals and spaces around it</option>
                <option value="exact">Exactly the same</option>
                <option value="contains">Contains the reference answer</option>
              </select>
            </label>
          </>
        )}
        {form.type === "json_output" && (
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">Fields that must be filled in (comma-separated)</span>
            <input value={form.required_fields} onChange={(e) => set({ required_fields: e.target.value })} placeholder={fields.slice(0, 3).join(", ") || "answer, citations"} className={cx(inputCls, "mt-1 w-full font-mono")} />
          </label>
        )}
        {form.type === "cites_evidence" && (
          <>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Field that lists the cited ids</span>
              <input value={form.citations_field} onChange={(e) => set({ citations_field: e.target.value })} list={`fields-${agentId}`} placeholder="citations" className={cx(inputCls, "mt-1 w-full font-mono")} />
            </label>
            <label className="flex items-center gap-2 self-end text-xs">
              <input type="checkbox" checked={form.require_at_least_one} onChange={(e) => set({ require_at_least_one: e.target.checked })} /> It must cite at least one source
            </label>
          </>
        )}
        {(form.type === "max_latency_ms" || form.type === "max_cost_usd") && (
          <label className="block">
            <span className="text-xs font-medium text-slate-700">{form.type === "max_latency_ms" ? "At most (milliseconds; 3000 = 3 s)" : "At most (US dollars per answer)"}</span>
            <input value={form.max} onChange={(e) => set({ max: e.target.value })} inputMode="decimal" className={cx(inputCls, "mt-1 w-full")} />
          </label>
        )}

        <label className="block">
          <span className="text-xs font-medium text-slate-700">How bad is a failure</span>
          <select value={form.severity} onChange={(e) => set({ severity: e.target.value as Form["severity"] })} className={cx(inputCls, "mt-1 w-full")}>
            <option value="critical">Critical: harms users or breaks policy (always blocks a release)</option>
            <option value="major">Major: the answer is wrong or unusable</option>
            <option value="minor">Minor: style or polish</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end text-xs">
          <input type="checkbox" checked={form.blocking || form.severity === "critical"} disabled={form.severity === "critical"} onChange={(e) => set({ blocking: e.target.checked })} /> One failure blocks a release on its own
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-slate-700">What to fix when it fails (optional, shown to whoever fixes the agent)</span>
          <input value={form.fix_hint} onChange={(e) => set({ fix_hint: e.target.value })} className={cx(inputCls, "mt-1 w-full")} />
        </label>
        <label className="block text-xs text-slate-500 sm:col-span-2">
          Saved as{" "}
          <input
            value={form.idTouched ? form.id : (built.rule?.id as string | undefined) ?? ""}
            onChange={(e) => set({ id: e.target.value, idTouched: true })}
            className={cx(inputCls, "w-64 py-0.5 font-mono text-xs")}
            aria-label="Rule id"
          />
        </label>
      </div>

      {/* 3. Try it */}
      <div className="mt-4">
        <div className="text-xs font-medium text-slate-700">3. Try it before it counts</div>
        <p className="text-xs text-slate-500">
          It runs on your latest test&apos;s answers and on a bad answer you write. You can add it only once it has failed at least once: a rule that never fails can&apos;t catch anything.
        </p>
        {form.type !== "non_empty" && (
          <div className="mt-1 flex flex-wrap items-start gap-2">
            <textarea
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
              rows={2}
              placeholder={PROBE_LABEL[form.type] ?? "Try it on a bad answer it should catch, e.g. “I guarantee you a full refund, no questions asked.”"}
              aria-label="A bad answer to try it on"
              className={cx(inputCls, "min-w-72 flex-1")}
            />
            {form.type === "matches_expected" && (
              <label className="text-xs">
                as the answer to{" "}
                <select value={probeCase} onChange={(e) => setProbeCase(e.target.value)} className={inputCls}>
                  <option value="">a case with a reference answer</option>
                  {visibleCases.filter((c) => c.expected !== null).map((c) => (
                    <option key={c.case_id} value={c.case_id}>
                      {c.case_id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {form.type === "non_empty" && <p className="mt-1 text-xs text-slate-600">It&apos;s also tried on an answer where “{form.field || "…"}” is blank.</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={busy !== null || !built.rule} onClick={tryIt}>
            {busy === "preview" ? "Trying…" : "Try it"}
          </Button>
          {built.problem && (form.question || form.phrases || form.pattern) && <span className="text-xs text-amber-800">{built.problem}</span>}
          {preview && !fresh && <span className="text-xs text-slate-500">You changed the rule since you tried it: try it again.</span>}
        </div>

        {fresh && (
          <div className="mt-3 space-y-2">
            {fresh.proven ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                ✓ It can catch a problem: it failed on{" "}
                {fresh.proven_by?.kind === "answer" ? <>your agent&apos;s answer to <b>{fresh.proven_by.case_id}</b></> : <>your bad answer</>}.
              </div>
            ) : (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                {fresh.counts.fail > 0 || fresh.probe?.outcome === "FAIL"
                  ? "Its failures don't prove anything yet: see why below, fix the rule, and try again."
                  : "It hasn't failed on anything yet, so there's no proof it can catch a problem. Write a bad answer it should catch, and try again."}
              </div>
            )}
            {fresh.warnings.map((w) => (
              <div key={w} className="text-xs text-amber-800">
                ⚠ {w}
              </div>
            ))}
            {fresh.probe && (
              <div className="text-xs">
                Your bad answer: <OutcomeBadge outcome={fresh.probe.outcome} /> {fresh.probe.summary}
              </div>
            )}
            {fresh.run && (
              <div className="text-xs text-slate-600">
                On <b>{fresh.run.agent_version}</b>&apos;s {fresh.results.length} answers: {fresh.counts.pass} pass · <span className={cx(fresh.counts.fail > 0 && "font-semibold text-rose-700")}>{fresh.counts.fail} fail</span> · {fresh.counts.not_applicable} n/a
                {fresh.counts.error ? <> · {fresh.counts.error} couldn&apos;t check</> : null}
              </div>
            )}
            {rows.length > 0 && (
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Case</th>
                    <th className="py-1 pr-2 font-medium">Result</th>
                    <th className="py-1 pr-2 font-medium">What it read</th>
                    <th className="py-1 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(showAll ? rows : rows.slice(0, 6)).map((r) => (
                    <tr key={r.case_id} className="align-top">
                      <td className="py-1 pr-2 font-mono">{r.case_id}</td>
                      <td className="py-1 pr-2">
                        <OutcomeBadge outcome={r.outcome} />
                      </td>
                      <td className="max-w-md py-1 pr-2 text-slate-700">{r.answer || "—"}</td>
                      <td className="py-1 text-slate-600">{r.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {rows.length > 6 && (
              <button type="button" className="text-xs text-sky-700 hover:underline" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show fewer" : `Show all ${rows.length}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 4. Add */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sky-100 pt-3">
        <Button disabled={busy !== null || !name.trim() || !fresh?.proven} onClick={add}>
          {busy === "add" ? "Adding…" : "Add rule"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-xs text-slate-500">
          {!name.trim() ? "Enter your name: every change is logged under it. " : ""}
          Adding a rule changes every test&apos;s results; an approval already given no longer applies.
          {draftedByAi ? " Logged as drafted by AI." : ""}
        </span>
      </div>
      <div className="mt-2">
        <ErrorList error={error} />
      </div>
    </div>
  );
}

const rank = (o: string) => ({ FAIL: 0, ERROR: 1, PASS: 2, NOT_APPLICABLE: 3 })[o] ?? 4;
