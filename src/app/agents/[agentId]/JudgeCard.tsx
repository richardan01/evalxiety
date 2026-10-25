"use client";

/**
 * The AI reviewer: one yes/no question Claude answers about each answer, measured against the person's own labels.
 * Editable for your own agents. Any change to the question, its definitions or the model is a new reviewer version, so
 * how often it agrees with you is measured again from scratch (the labels are kept).
 */
import { useState } from "react";
import { Badge, Button, Card, cx, Ratio, Stat } from "@/components/ui";
import type { AgentOverview, DefinitionView } from "../types";
import { errorOf, ErrorList, inputCls, NameField, post, useName } from "./shared";

const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced, the default)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most careful, costs more)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
] as const;
type Model = (typeof MODELS)[number]["id"];

export function JudgeCard({ view, def, onChanged }: { view: AgentOverview; def: DefinitionView | null; onChanged: () => void }) {
  const j = view.agent.judge;
  const cal = view.calibration;
  const editable = def?.editable ?? false;
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (message: string) => {
    setEditing(false);
    setNotice(message);
    onChanged();
  };

  if (!j) {
    return (
      <Card title="AI reviewer (optional)" actions={editable && !editing ? <Button variant="secondary" onClick={() => setEditing(true)}>Add an AI reviewer question</Button> : undefined}>
        {notice && <Notice text={notice} />}
        <p className="text-sm text-slate-600">
          No AI reviewer set up. For a problem your rules can&apos;t catch because it needs judgement (tone, a wrong fact, a hand-off that should have happened), ask
          Claude one yes/no question about each answer.{" "}
          {editable ? "" : <>Add it under <code>judge</code> in agent.json. </>}
          It is always experimental: how often it agrees with you is reported once you&apos;ve labelled 30+ problems and 30+ fine answers, and it never replaces your review.
        </p>
        {editing && def && <JudgeForm agentId={view.agent.agent_id} def={def} initial={null} onCancel={() => setEditing(false)} onDone={done} />}
      </Card>
    );
  }
  return (
    <Card
      title="AI reviewer (experimental)"
      subtitle="Claude answering one yes/no question about each answer, measured against your own labels. Never counts toward “passed every rule”."
      actions={
        <span className="flex items-center gap-2">
          <Badge tone="purple">{j.model}</Badge>
          {editable && !editing && (
            <Button variant="secondary" onClick={() => (setEditing(true), setNotice(null))}>
              Edit
            </Button>
          )}
        </span>
      }
    >
      {notice && <Notice text={notice} />}
      {editing && def ? (
        <JudgeForm agentId={view.agent.agent_id} def={def} initial={j} onCancel={() => setEditing(false)} onDone={done} />
      ) : (
        <>
          <p className="text-sm font-medium">{j.question}</p>
          <dl className="mt-1 space-y-0.5 text-xs text-slate-600">
            <div>
              <dt className="inline font-medium">A problem is: </dt>
              <dd className="inline">{j.fail_definition}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Fine is: </dt>
              <dd className="inline">{j.pass_definition}</dd>
            </div>
          </dl>
        </>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Version <code>{j.version}</code> · runs in {view.mode === "live" ? "live mode (billed)" : "mock mode: example traces only — real traces need MOCK_MODE=false and an API key"}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Answers you labelled" value={cal.pairs} hint={`need ${cal.min_per_class} problems and ${cal.min_per_class} fine`} />
        <Stat label="Catches real problems (TPR)" value={<Ratio value={cal.tpr} undefinedReason={cal.undefined_reasons[0]} />} hint={`${cal.matrix.positives} human failures`} />
        <Stat label="Avoids false alarms (TNR)" value={<Ratio value={cal.tnr} undefinedReason={cal.undefined_reasons[1] ?? cal.undefined_reasons[0]} />} hint={`${cal.matrix.negatives} human passes`} />
        <Stat label="Disagreements" value={cal.disagreements.length} />
      </div>
      <p className={cx("mt-2 text-xs", cal.insufficient ? "text-amber-800" : "text-slate-600")}>{cal.status_label}</p>
    </Card>
  );
}

const Notice = ({ text }: { text: string }) => <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{text}</div>;

function JudgeForm({
  agentId,
  def,
  initial,
  onCancel,
  onDone,
}: {
  agentId: string;
  def: DefinitionView;
  initial: { question: string; fail_definition: string; pass_definition: string; model: Model } | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useName();
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [fail, setFail] = useState(initial?.fail_definition ?? "");
  const [pass, setPass] = useState(initial?.pass_definition ?? "");
  const [model, setModel] = useState<Model>(initial?.model ?? "claude-sonnet-5-5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = !initial || question !== initial.question || fail !== initial.fail_definition || pass !== initial.pass_definition || model !== initial.model;
  const ready = name.trim() && question.trim().length >= 10 && fail.trim() && pass.trim() && changed;

  async function save(judge: unknown, message: string) {
    setBusy(true);
    setError(null);
    const { status, body } = await post(`/api/agents/${agentId}/judge-config`, { actor: name, base: def.definition_hash, judge });
    setBusy(false);
    if (status >= 400) return setError(errorOf(body, status));
    onDone(message);
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-sky-200 bg-sky-50/40 p-3 text-sm">
      <label className="block">
        <span className="text-xs font-medium text-slate-700">One yes/no question about a problem</span>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Does the answer state a fact the help articles don't support?" className={cx(inputCls, "mt-1 w-full")} />
        <span className="mt-0.5 block text-xs text-slate-500">One problem only. “Yes” means the problem is there.</span>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">It&apos;s a problem when…</span>
        <textarea value={fail} onChange={(e) => setFail(e.target.value)} rows={2} placeholder="e.g. At least one statement about prices or policies is missing from, or contradicts, the articles." className={cx(inputCls, "mt-1 w-full")} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">It&apos;s fine when…</span>
        <textarea value={pass} onChange={(e) => setPass(e.target.value)} rows={2} placeholder="e.g. Every factual statement is in the articles. Greetings and hand-off messages aren't facts." className={cx(inputCls, "mt-1 w-full")} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">Model</span>
        <select value={model} onChange={(e) => setModel(e.target.value as Model)} className={cx(inputCls, "mt-1 w-full")}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {initial && <p className="text-xs text-amber-800">Saving starts a new AI reviewer version: its verdicts and its agreement with your labels start again from zero. Your labels are kept.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <NameField name={name} setName={setName} />
        <Button disabled={busy || !ready} onClick={() => save({ question: question.trim(), fail_definition: fail.trim(), pass_definition: pass.trim(), model }, "Saved. Run the AI reviewer on a test to get verdicts from this version.")}>
          {initial ? "Save as a new version" : "Add AI reviewer"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {initial && (
          <Button variant="ghost" disabled={busy || !name.trim()} onClick={() => save(null, "AI reviewer removed. Its past verdicts are kept in the log but no longer shown.")}>
            Remove AI reviewer
          </Button>
        )}
      </div>
      <ErrorList error={error} />
    </div>
  );
}
