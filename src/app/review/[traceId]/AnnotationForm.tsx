"use client";

import type { Annotation, CriterionLabel, FailureMode, Severity } from "@/lib/domain/schemas";
import { Badge, Button, Card, cx, fmtDateTime } from "@/components/ui";
import { ChoiceButton, FieldError, Kbd, ReviewerInput, StepHeading } from "../_queue/bits";
import { isActiveMode, modeName, modeTag, type FieldErrors, type FormState } from "../_queue/annotationForm";

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; message: string }
  | { status: "info"; message: string }
  | { status: "error"; message: string };

export type TaxonomyState =
  | { status: "loading" }
  | { status: "ok"; version: number; modes: FailureMode[] }
  | { status: "unavailable"; reason: string };

const SEVERITIES: Array<{ value: Severity; label: string; hint: string; tone: "red" | "amber" | "slate" }> = [
  { value: "critical", label: "Critical", hint: "policy breach or money lost if acted on", tone: "red" },
  { value: "major", label: "Major", hint: "wrong or misleading, recoverable", tone: "amber" },
  { value: "minor", label: "Minor", hint: "low impact or cosmetic", tone: "slate" },
];

const CRITERION: Array<{ value: CriterionLabel; label: string; hint: string; tone: "red" | "green" | "slate" }> = [
  { value: "present", label: "Yes", hint: "unsupported claim present", tone: "red" },
  { value: "absent", label: "No", hint: "every material claim supported", tone: "green" },
  { value: "not_assessed", label: "Not assessed", hint: "excluded from calibration", tone: "slate" },
];

export function AnnotationForm(props: {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  errors: FieldErrors;
  reviewer: { value: string; setValue: (v: string) => void; commit: () => string; stored: string };
  taxonomy: TaxonomyState;
  own: Annotation | null;
  dirty: boolean;
  saveState: SaveState;
  onSave: (andNext: boolean) => void;
  onDefer: () => void;
}) {
  const { form, onChange, errors, reviewer, taxonomy, own, dirty, saveState, onSave, onDefer } = props;
  const saving = saveState.status === "saving";
  const isFail = form.outcome === "fail";

  const allModes = taxonomy.status === "ok" ? taxonomy.modes : [];
  const activeModes = allModes.filter(isActiveMode);
  const knownIds = new Set(activeModes.map((m) => m.failure_mode_id));
  // Keep ids from an earlier save visible even if the mode was merged/retired or the taxonomy failed to load.
  const extraFirst = form.firstFailureModeId && !knownIds.has(form.firstFailureModeId) ? form.firstFailureModeId : null;
  const extraAdditional = form.additionalModeIds.filter((id) => !knownIds.has(id));
  const selectedMode = activeModes.find((m) => m.failure_mode_id === form.firstFailureModeId) ?? null;

  return (
    <Card
      title="Label this trace (open coding)"
      subtitle="Your label is stored as a human annotation under your name. Nothing here is prefilled by automated checks."
    >
      <div className="space-y-4">
        {/* Reviewer */}
        <div>
          <label htmlFor="reviewer-name" className="mb-1 block text-xs font-medium text-slate-600">
            Reviewer name <span className="font-normal text-slate-500">(required · remembered in this browser)</span>
          </label>
          <ReviewerInput
            id="reviewer-name"
            value={reviewer.value}
            onChange={reviewer.setValue}
            onCommit={reviewer.commit}
            invalid={Boolean(errors.reviewer)}
          />
          <FieldError message={errors.reviewer} />
          {own && (
            <p className="mt-1 text-xs text-slate-500">
              You labelled this trace on {fmtDateTime(own.updated_at)}. Saving again updates your label.
            </p>
          )}
        </div>

        {/* 1. Notes */}
        <section className="border-t border-slate-100 pt-3">
          <StepHeading
            n={1}
            title="What did you observe?"
            required
            hint="Open coding: describe what the agent did that a pricing reviewer would notice — observations, not explanations of why. Start with the first thing that went wrong; later errors often cascade from it."
          />
          <textarea
            value={form.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            rows={4}
            placeholder="Describe what you saw in the trace (observations, not explanations)…"
            className={cx(
              "w-full rounded-md border px-2 py-1.5 text-sm leading-relaxed",
              errors.notes ? "border-rose-400 ring-1 ring-rose-300" : "border-slate-300",
            )}
          />
          <FieldError message={errors.notes} />
        </section>

        {/* 2. Outcome */}
        <section className="border-t border-slate-100 pt-3">
          <StepHeading
            n={2}
            title="Task outcome"
            required
            hint="Would you, as the pricing reviewer, accept this response as-is? One binary label for the whole trace."
          />
          <div className="flex gap-2">
            <ChoiceButton selected={form.outcome === "pass"} onClick={() => onChange({ outcome: "pass" })} tone="green">
              Pass <Kbd>1</Kbd>
            </ChoiceButton>
            <ChoiceButton selected={form.outcome === "fail"} onClick={() => onChange({ outcome: "fail" })} tone="red">
              Fail <Kbd>2</Kbd>
            </ChoiceButton>
          </div>
          <FieldError message={errors.outcome} />
        </section>

        {/* 3–5. Failure details */}
        {!isFail ? (
          <section className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
            <b className="text-slate-600">Steps 3–5</b> (first failure, other failure modes, severity) appear when the outcome is
            Fail.
          </section>
        ) : (
          <>
            <section className="border-t border-slate-100 pt-3">
              <StepHeading
                n={3}
                title="First observed failure"
                required
                hint="Only the first (upstream-most) thing that went wrong. Describe it in your own words; the category is optional."
              />
              <textarea
                value={form.firstFailure}
                onChange={(e) => onChange({ firstFailure: e.target.value })}
                rows={2}
                placeholder="The first thing that went wrong, as you observed it…"
                className={cx(
                  "w-full rounded-md border px-2 py-1.5 text-sm",
                  errors.firstFailure ? "border-rose-400 ring-1 ring-rose-300" : "border-slate-300",
                )}
              />
              <FieldError message={errors.firstFailure} />
              <label className="mt-2 block text-xs font-medium text-slate-600" htmlFor="first-mode">
                Category <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <select
                id="first-mode"
                value={form.firstFailureModeId}
                onChange={(e) =>
                  onChange({
                    firstFailureModeId: e.target.value,
                    additionalModeIds: form.additionalModeIds.filter((id) => id !== e.target.value),
                  })
                }
                disabled={taxonomy.status === "loading"}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Uncategorised — assign during axial coding</option>
                {activeModes.map((m) => (
                  <option key={m.failure_mode_id} value={m.failure_mode_id}>
                    {m.name} ({modeTag(m)})
                  </option>
                ))}
                {extraFirst && (
                  <option value={extraFirst}>
                    {modeName(allModes, extraFirst)} (inactive in the current taxonomy — kept as recorded)
                  </option>
                )}
              </select>
              <TaxonomyNote taxonomy={taxonomy} />
              {selectedMode && <p className="mt-1 text-xs text-slate-600">{selectedMode.definition}</p>}
            </section>

            <section className="border-t border-slate-100 pt-3">
              <StepHeading
                n={4}
                title="Other independent failure modes"
                hint="Optional. Tick only failures that are NOT a consequence of the first one."
              />
              {activeModes.length === 0 && extraAdditional.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {taxonomy.status === "loading"
                    ? "Loading categories…"
                    : "No categories available — note extra failures in your observations and categorise them later in axial coding."}
                </p>
              ) : (
                <ul className="space-y-1">
                  {activeModes
                    .filter((m) => m.failure_mode_id !== form.firstFailureModeId)
                    .map((m) => (
                      <ModeCheckbox
                        key={m.failure_mode_id}
                        id={m.failure_mode_id}
                        label={m.name}
                        tag={modeTag(m)}
                        definition={m.definition}
                        checked={form.additionalModeIds.includes(m.failure_mode_id)}
                        onToggle={(on) =>
                          onChange({
                            additionalModeIds: on
                              ? [...form.additionalModeIds, m.failure_mode_id]
                              : form.additionalModeIds.filter((x) => x !== m.failure_mode_id),
                          })
                        }
                      />
                    ))}
                  {extraAdditional.map((id) => (
                    <ModeCheckbox
                      key={id}
                      id={id}
                      label={modeName(allModes, id)}
                      tag="inactive in the current taxonomy — untick to remove"
                      checked
                      onToggle={() => onChange({ additionalModeIds: form.additionalModeIds.filter((x) => x !== id) })}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="border-t border-slate-100 pt-3">
              <StepHeading n={5} title="Severity of the first failure" required />
              <div className="flex gap-1.5">
                {SEVERITIES.map((s) => (
                  <ChoiceButton
                    key={s.value}
                    selected={form.severity === s.value}
                    onClick={() => onChange({ severity: s.value })}
                    tone={s.tone}
                    hint={s.hint}
                  >
                    {s.label}
                  </ChoiceButton>
                ))}
              </div>
              <FieldError message={errors.severity} />
            </section>
          </>
        )}

        {/* 6. Judge reference label */}
        <section className="border-t border-slate-100 pt-3">
          <StepHeading
            n={6}
            title="Unsupported pricing justification present?"
            required
            hint={
              <>
                Does the agent&apos;s explanation contain a <b>material</b> pricing claim (rate, margin, reason, approval) that the
                evidence pack does not support — including the merchant&apos;s unverified statements presented as fact? Your answer
                is the <b>reference label used to calibrate the experimental LLM judge</b>. Answer it on its own, independent of
                Pass/Fail.
              </>
            }
          />
          <div className="flex gap-1.5">
            {CRITERION.map((c) => (
              <ChoiceButton
                key={c.value}
                selected={form.unsupported === c.value}
                onClick={() => onChange({ unsupported: c.value })}
                tone={c.tone}
                hint={c.hint}
              >
                {c.label}
              </ChoiceButton>
            ))}
          </div>
          <FieldError message={errors.unsupported} />
        </section>

        {/* 7. Save */}
        <section className="border-t border-slate-100 pt-3">
          <StepHeading n={7} title="Save" />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => onSave(true)} disabled={saving} title="Save, then open the next unreviewed trace (⌘/Ctrl+Enter)">
              {saving ? "Saving…" : "Save & next unreviewed"} <Kbd>⌘↵</Kbd>
            </Button>
            <Button variant="secondary" onClick={() => onSave(false)} disabled={saving}>
              Save
            </Button>
            <Button variant="ghost" onClick={onDefer} disabled={saving} title="Skip without recording anything (D)">
              Defer <Kbd>D</Kbd>
            </Button>
          </div>
          <div className="mt-2 min-h-5 text-xs" aria-live="polite">
            {saveState.status === "saving" && <span className="text-slate-500">Saving your label…</span>}
            {saveState.status === "saved" && !dirty && (
              <span className="font-medium text-emerald-700">{saveState.message}</span>
            )}
            {saveState.status === "info" && <span className="text-slate-700">{saveState.message}</span>}
            {saveState.status === "error" && <span className="font-medium text-rose-700">{saveState.message}</span>}
            {dirty && saveState.status !== "saving" && saveState.status !== "error" && (
              <Badge tone="amber">Unsaved changes</Badge>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Shortcuts (when not typing): <Kbd>1</Kbd> Pass · <Kbd>2</Kbd> Fail · <Kbd>D</Kbd> defer · <Kbd>←</Kbd>/<Kbd>→</Kbd>{" "}
            previous/next trace · <Kbd>⌘/Ctrl</Kbd>+<Kbd>Enter</Kbd> save &amp; next (works while typing). Defer records nothing:
            the trace stays UNREVIEWED and is skipped for the rest of this browser session.
          </p>
        </section>
      </div>
    </Card>
  );
}

function TaxonomyNote({ taxonomy }: { taxonomy: TaxonomyState }) {
  if (taxonomy.status === "loading") return <p className="mt-1 text-xs text-slate-500">Loading failure taxonomy…</p>;
  if (taxonomy.status === "unavailable") {
    return (
      <p className="mt-1 text-xs text-amber-800">
        Failure taxonomy unavailable ({taxonomy.reason}). Leave it uncategorised — categories are assigned later during axial
        coding.
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-slate-500">
      Taxonomy v{taxonomy.version}. Seed categories are <b>hypotheses</b> written before any review — not evidence that the
      failure occurs. If nothing fits, leave it uncategorised.
    </p>
  );
}

function ModeCheckbox(props: {
  id: string;
  label: string;
  tag: string;
  definition?: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50" title={props.definition}>
        <input
          type="checkbox"
          className="mt-0.5"
          checked={props.checked}
          onChange={(e) => props.onToggle(e.target.checked)}
        />
        <span>
          {props.label} <span className="text-[11px] text-slate-500">({props.tag})</span>
        </span>
      </label>
    </li>
  );
}
