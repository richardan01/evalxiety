"use client";

import { useEffect, useState } from "react";
import { getJSON, postJSON } from "@/lib/client/api";
import { useReviewerDraft } from "../_queue/useReviewer";
import type { ChecklistItem, JudgeCriterion, RubricVersion } from "@/lib/rubric/rubric";
import { Badge, Button, Callout, Card, JsonDetails, cx, fmtDateTime } from "@/components/ui";

interface RubricResponse {
  rubric: RubricVersion;
  versions: Array<{ version: number; created_at: string; author: string; change_note: string }>;
  judge: { system_prompt: string; live_version: string; mock_version: string };
  failure_modes: Array<{ failure_mode_id: string; name: string }>;
  evaluators: Array<{ evaluator_id: string; kind: "code" | "judge" }>;
  policy_thresholds: Array<{
    policy_id: string;
    effective_from: string;
    effective_to: string | null;
    min_margin_pct: Record<string, number>;
    discount_approval_threshold_pct: number;
    high_volume_threshold_usd: number;
    promotions: string[];
  }>;
}

const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

export function RubricEditor() {
  const [data, setData] = useState<RubricResponse | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [criterion, setCriterion] = useState<JudgeCriterion | null>(null);
  const reviewer = useReviewerDraft();
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const d = await getJSON<RubricResponse>("/api/rubric");
    setData(d);
    setChecklist(d.rubric.review_checklist);
    setCriterion(d.rubric.judge_criterion);
  }
  useEffect(() => {
    let alive = true;
    getJSON<RubricResponse>("/api/rubric")
      .then((d) => {
        if (!alive) return;
        setData(d);
        setChecklist(d.rubric.review_checklist);
        setCriterion(d.rubric.judge_criterion);
      })
      .catch((e) => alive && setStatus({ kind: "error", text: String(e) }));
    return () => {
      alive = false;
    };
  }, []);

  if (!data || !criterion) return <p className="text-sm text-slate-500">Loading rubric…</p>;

  const dirtyChecklist = JSON.stringify(checklist) !== JSON.stringify(data.rubric.review_checklist);
  const dirtyJudge = JSON.stringify(criterion) !== JSON.stringify(data.rubric.judge_criterion);
  const judgeItems = checklist.filter((c) => c.checked_by === "judge").length;

  function patchItem(i: number, patch: Partial<ChecklistItem>) {
    setChecklist((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  async function save() {
    const author = reviewer.commit().trim();
    if (!author) return setStatus({ kind: "error", text: "Enter your name — rubric changes are audited." });
    if (note.trim().length < 3) return setStatus({ kind: "error", text: "Add a short change note." });
    setSaving(true);
    setStatus(null);
    try {
      const res = await postJSON<{ rubric: RubricVersion; judge_version_changed: boolean }>("/api/rubric", {
        author,
        change_note: note,
        base_version: data!.rubric.version,
        review_checklist: checklist,
        judge_criterion: criterion,
      });
      setNote("");
      await load();
      setStatus({
        kind: "ok",
        text: `Saved rubric v${res.rubric.version}.${res.judge_version_changed ? " The judge criterion changed, so this is a new judge version: re-run the judge, and earlier calibration no longer counts." : ""}`,
      });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Callout tone="slate" title={`Rubric v${data.rubric.version} — what "good" means for this agent`}>
        Three layers: <b>1 · review checklist</b> (what you answer on every trace), <b>2 · AI judge criterion</b> (the one
        subjective check), <b>3 · policy rules</b> (objective thresholds checked by code). Write the rubric from failures you
        have actually seen in traces, not imagined ones.
      </Callout>

      <Card title="1 · Review checklist" subtitle="Shown on every trace. Each ✗ tags its failure mode; the judge-linked question is the judge's reference label.">
        <div className="space-y-2">
          {checklist.map((c, i) => (
            <div key={i} className="grid gap-2 rounded border border-slate-200 p-2 md:grid-cols-[1.4fr_1.6fr_1fr_0.8fr_1fr_auto]">
              <input className={input} value={c.question} onChange={(e) => patchItem(i, { question: e.target.value })} placeholder="Question" />
              <input className={input} value={c.help} onChange={(e) => patchItem(i, { help: e.target.value })} placeholder="Hint (tooltip)" />
              <select className={input} value={c.failure_mode_id ?? ""} onChange={(e) => patchItem(i, { failure_mode_id: e.target.value || null })}>
                <option value="">no tag</option>
                {data.failure_modes.map((m) => (
                  <option key={m.failure_mode_id} value={m.failure_mode_id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                className={input}
                value={c.checked_by}
                onChange={(e) => patchItem(i, { checked_by: e.target.value as ChecklistItem["checked_by"], evaluator_id: null })}
              >
                <option value="code">code</option>
                <option value="judge">AI judge</option>
                <option value="human_only">human only</option>
              </select>
              <select
                className={input}
                value={c.evaluator_id ?? ""}
                disabled={c.checked_by === "human_only"}
                onChange={(e) => patchItem(i, { evaluator_id: e.target.value || null })}
              >
                <option value="">—</option>
                {data.evaluators
                  .filter((ev) => (c.checked_by === "judge" ? ev.kind === "judge" : ev.kind === "code"))
                  .map((ev) => (
                    <option key={ev.evaluator_id} value={ev.evaluator_id}>
                      {ev.evaluator_id}
                    </option>
                  ))}
              </select>
              <Button variant="ghost" onClick={() => setChecklist((l) => l.filter((_, j) => j !== i))} disabled={checklist.length <= 1}>
                ✕
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={checklist.length >= 8}
              onClick={() =>
                setChecklist((l) => [
                  ...l,
                  { id: `item_${l.length + 1}_${Date.now() % 10000}`, question: "", help: "", failure_mode_id: null, checked_by: "human_only", evaluator_id: null },
                ])
              }
            >
              + Add question
            </Button>
            {judgeItems !== 1 && <Badge tone="amber">Exactly one question should be checked by the AI judge ({judgeItems} now)</Badge>}
          </div>
        </div>
      </Card>

      <Card
        title="2 · AI judge criterion (experimental)"
        subtitle={`Question: does the explanation contain a material claim unsupported by the evidence? Current version ${data.judge.live_version}`}
      >
        <div className="space-y-2 text-sm">
          {(
            [
              ["supported_definition", "Supported means…"],
              ["unsupported_definition", "Unsupported means…"],
              ["material_definition", "Material means…"],
              ["out_of_scope", "Out of scope (don't judge)…"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-xs font-medium text-slate-500">{label}</span>
              <textarea className={cx(input, "mt-0.5")} rows={2} value={criterion[k]} onChange={(e) => setCriterion({ ...criterion, [k]: e.target.value })} />
            </label>
          ))}
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Examples of unsupported claims (one per line)</span>
            <textarea
              className={cx(input, "mt-0.5 font-mono text-xs")}
              rows={4}
              value={criterion.unsupported_examples.join("\n")}
              onChange={(e) => setCriterion({ ...criterion, unsupported_examples: e.target.value.split("\n").filter((x) => x.trim()) })}
            />
          </label>
          {dirtyJudge && (
            <Callout tone="amber">Saving this creates a <b>new judge version</b>. Judge results and calibration from the old version stop counting until you re-run the judge.</Callout>
          )}
          <JsonDetails summary="Full judge prompt (current saved version)" value={data.judge.system_prompt} />
        </div>
      </Card>

      <Card title="3 · Policy rules (checked by code, read-only)" subtitle="Objective thresholds live in the policy data, not the rubric. Change them in src/lib/domain/policies.ts (that also changes the frozen-set hash).">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Policy</th>
              <th>In force</th>
              <th>Min margin (micro/small/mid/ent)</th>
              <th>Discount approval &gt;</th>
              <th>Deal desk &gt;</th>
              <th>Promotions</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.policy_thresholds.map((p) => (
              <tr key={p.policy_id} className="border-t border-slate-100">
                <td className="py-1 font-mono">{p.policy_id}</td>
                <td>
                  {p.effective_from} → {p.effective_to ?? "now"}
                </td>
                <td>
                  {p.min_margin_pct.micro}/{p.min_margin_pct.small}/{p.min_margin_pct.mid}/{p.min_margin_pct.enterprise}%
                </td>
                <td>{p.discount_approval_threshold_pct}%</td>
                <td>${(p.high_volume_threshold_usd / 1e6).toFixed(0)}M/mo</td>
                <td>{p.promotions.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow">
        <input className={cx(input, "w-40")} value={reviewer.value} onChange={(e) => reviewer.setValue(e.target.value)} placeholder="Your name" />
        <input className={cx(input, "min-w-64 flex-1")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note (why?)" />
        <Button onClick={save} disabled={saving || (!dirtyChecklist && !dirtyJudge)}>
          {saving ? "Saving…" : `Save as v${data.rubric.version + 1}`}
        </Button>
        {(dirtyChecklist || dirtyJudge) && (
          <Button variant="ghost" onClick={() => { setChecklist(data.rubric.review_checklist); setCriterion(data.rubric.judge_criterion); }}>
            Discard
          </Button>
        )}
        {status && <span className={cx("text-sm", status.kind === "ok" ? "text-emerald-700" : "text-rose-700")}>{status.text}</span>}
      </div>

      <Card title="Version history">
        <ul className="space-y-1 text-sm">
          {data.versions.map((v) => (
            <li key={v.version}>
              <b>v{v.version}</b> · {v.author} · {fmtDateTime(v.created_at)} — <span className="text-slate-600">{v.change_note}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
