"use client";

import Link from "next/link";
import type { FailureMode, Severity } from "@/lib/domain/schemas";
import type { ChecklistAnswer, RubricVersion } from "@/lib/rubric/rubric";
import { Badge, Button, cx } from "@/components/ui";
import { Kbd, ReviewerInput } from "../_queue/bits";
import { autoFirstFailureMode, problemModes, type QuickErrors, type QuickForm } from "./quickForm";
import type { SaveState } from "./AnnotationForm";

const ANSWERS: Array<{ value: ChecklistAnswer; label: string; on: string }> = [
  { value: "ok", label: "✓", on: "bg-emerald-600 text-white ring-emerald-600" },
  { value: "problem", label: "✗", on: "bg-rose-600 text-white ring-rose-600" },
  { value: "skip", label: "?", on: "bg-slate-600 text-white ring-slate-600" },
];

const SEVERITIES: Array<{ value: Severity; label: string }> = [
  { value: "critical", label: "Critical" },
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
];

function Seg({ selected, onClick, className, children, title }: { selected: boolean; onClick: () => void; className: string; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "h-7 min-w-8 rounded px-2 text-sm font-semibold ring-1 ring-inset transition-colors",
        selected ? className : "bg-white text-slate-500 ring-slate-300 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

export function QuickReviewForm(props: {
  rubric: RubricVersion;
  modes: FailureMode[];
  form: QuickForm;
  onChange: (patch: Partial<QuickForm>) => void;
  errors: QuickErrors;
  reviewer: { value: string; setValue: (v: string) => void; commit: () => string };
  alreadySaved: boolean;
  dirty: boolean;
  saveState: SaveState;
  onSave: () => void;
  onSkip: () => void;
}) {
  const { rubric, modes, form, onChange, errors, reviewer, alreadySaved, dirty, saveState, onSave, onSkip } = props;
  const saving = saveState.status === "saving";
  const problems = problemModes(form, rubric);
  const auto = autoFirstFailureMode(form, rubric);
  const name = (id: string | null) => (id ? (modes.find((m) => m.failure_mode_id === id)?.name ?? id) : "—");

  function answer(id: string, value: ChecklistAnswer) {
    const checklist = { ...form.checklist, [id]: value };
    // A problem on the reviewer's own checklist suggests Fail; the reviewer can still choose Pass.
    const anyProblem = Object.values(checklist).includes("problem");
    onChange({ checklist, ...(form.verdict === null && anyProblem ? { verdict: "fail" as const } : {}) });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-900">Your review</h2>
        <Link href="/review/rubric" className="text-xs text-sky-700 hover:underline" title="Edit the checklist and the judge criterion">
          Rubric v{rubric.version}
        </Link>
      </header>

      <div className="space-y-4 px-4 py-3">
        <div>
          <ReviewerInput id="reviewer-name" value={reviewer.value} onChange={reviewer.setValue} onCommit={reviewer.commit} invalid={Boolean(errors.reviewer)} />
          {errors.reviewer && <p className="mt-1 text-xs text-rose-700">{errors.reviewer}</p>}
        </div>

        {/* Checklist */}
        <ol className="space-y-1.5">
          {rubric.review_checklist.map((item, i) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span className="text-sm text-slate-800" title={item.help}>
                <span className="mr-1 text-slate-400">{i + 1}.</span>
                {item.question}
                {item.checked_by === "judge" && (
                  <Badge tone="purple" title="Your answer is the reference label used to check the AI judge">
                    judge ref
                  </Badge>
                )}
              </span>
              <span className="flex shrink-0 gap-1">
                {ANSWERS.map((a) => (
                  <Seg key={a.value} selected={form.checklist[item.id] === a.value} onClick={() => answer(item.id, a.value)} className={a.on} title={a.value}>
                    {a.label}
                  </Seg>
                ))}
              </span>
            </li>
          ))}
        </ol>
        {errors.evidence && <p className="-mt-2 text-xs text-rose-700">{errors.evidence}</p>}

        {/* Verdict */}
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <span className="w-20 text-sm font-medium text-slate-700">Verdict</span>
          <Seg selected={form.verdict === "pass"} onClick={() => onChange({ verdict: "pass" })} className="bg-emerald-600 text-white ring-emerald-600">
            Pass <Kbd>1</Kbd>
          </Seg>
          <Seg selected={form.verdict === "fail"} onClick={() => onChange({ verdict: "fail" })} className="bg-rose-600 text-white ring-rose-600">
            Fail <Kbd>2</Kbd>
          </Seg>
          {errors.verdict && <span className="text-xs text-rose-700">{errors.verdict}</span>}
        </div>

        {form.verdict === "fail" && (
          <div className="space-y-2 rounded-md bg-rose-50/60 p-2.5">
            <input
              value={form.whatWentWrong}
              onChange={(e) => onChange({ whatWentWrong: e.target.value })}
              placeholder="What went wrong first? (one line, in your words)"
              className={cx("w-full rounded border bg-white px-2 py-1.5 text-sm", errors.whatWentWrong ? "border-rose-400" : "border-slate-300")}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {SEVERITIES.map((s) => (
                <Seg key={s.value} selected={form.severity === s.value} onClick={() => onChange({ severity: s.value })} className="bg-slate-800 text-white ring-slate-800">
                  {s.label}
                </Seg>
              ))}
              {errors.severity && <span className="text-xs text-rose-700">{errors.severity}</span>}
            </div>
            {problems.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                First failure:
                <select
                  value={form.firstFailureOverride ?? ""}
                  onChange={(e) => onChange({ firstFailureOverride: e.target.value || null })}
                  className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
                >
                  <option value="">{name(auto)} (first ✗ in the list)</option>
                  {[...new Set(problems)].filter((m) => m !== auto).map((m) => (
                    <option key={m} value={m}>
                      {name(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {errors.whatWentWrong && <p className="text-xs text-rose-700">{errors.whatWentWrong}</p>}
          </div>
        )}

        <textarea
          value={form.note}
          onChange={(e) => onChange({ note: e.target.value })}
          rows={2}
          placeholder="Anything else you noticed? (optional)"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />

        <div className="flex items-center gap-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : alreadySaved ? "Update & next" : "Save & next"} <Kbd>⌘↵</Kbd>
          </Button>
          <Button variant="ghost" onClick={onSkip} disabled={saving}>
            Skip <Kbd>D</Kbd>
          </Button>
          <span className="text-xs" aria-live="polite">
            {saveState.status === "error" && <span className="text-rose-700">{saveState.message}</span>}
            {saveState.status === "saved" && !dirty && <span className="text-emerald-700">Saved</span>}
            {saveState.status === "info" && <span className="text-slate-600">{saveState.message}</span>}
            {dirty && saveState.status !== "saving" && saveState.status !== "error" && <Badge tone="amber">unsaved</Badge>}
          </span>
        </div>
      </div>
    </section>
  );
}
