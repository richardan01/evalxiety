"use client";

import Link from "next/link";
import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import type { ExecutionMode, FailureMode, Severity } from "@/lib/domain/schemas";
import type { ModeFrequency } from "@/lib/taxonomy/ops";
import { Badge, Button, KeyValue, MockBadge, SeverityBadge, cx } from "@/components/ui";
import { ChangeForm, Field, Select, TextArea, TextInput } from "./_shared/forms";
import { modeSplit } from "./derive";
import type { EvaluatorOption, TaxonomyOp } from "./types";

const SEVERITIES: Severity[] = ["critical", "major", "minor"];

export function StatusBadge({ mode, modes }: { mode: FailureMode; modes: FailureMode[] }) {
  switch (mode.status) {
    case "observed":
      return (
        <Badge tone="green" title="At least one human reviewer tagged this category on a reviewed trace">
          OBSERVED
        </Badge>
      );
    case "merged": {
      const target = modes.find((m) => m.failure_mode_id === mode.merged_into);
      return (
        <Badge tone="slate" title="Kept for history; its observations roll up into the target">
          MERGED → {target?.name ?? mode.merged_into}
        </Badge>
      );
    }
    case "retired":
      return (
        <Badge tone="neutral" title="No longer assignable; kept for history">
          RETIRED
        </Badge>
      );
    default:
      return (
        <Badge tone="amber" title="No human-reviewed trace is tagged with this category yet">
          PROVISIONAL hypothesis
        </Badge>
      );
  }
}

export function OriginBadge({ mode }: { mode: FailureMode }) {
  return mode.origin === "seed_hypothesis" ? (
    <Badge tone="purple" title="Written from the project brief before any trace was read">
      seed hypothesis
    </Badge>
  ) : (
    <Badge tone="blue" title="Added by a named reviewer during axial coding">
      reviewer-added
    </Badge>
  );
}

export function ModeMix({ traceIds, traceModes }: { traceIds: string[]; traceModes: Record<string, ExecutionMode> }) {
  const s = modeSplit(traceIds, traceModes);
  if (traceIds.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-slate-600">
      {s.live > 0 && (
        <span className="inline-flex items-center gap-1">
          <MockBadge mode="live" /> {s.live}
        </span>
      )}
      {s.mock > 0 && (
        <span className="inline-flex items-center gap-1">
          <MockBadge mode="mock" /> {s.mock}
        </span>
      )}
      {s.unknown > 0 && <Badge tone="red" title="Trace file not found">{s.unknown} missing</Badge>}
    </span>
  );
}

type Action = null | "edit" | "merge" | "retire" | "attach";

export function FailureModeCard({
  mode,
  modes,
  freq,
  firstFailureTraceIds,
  reviewed,
  traceModes,
  traceCases,
  evaluators,
  reload,
}: {
  mode: FailureMode;
  modes: FailureMode[];
  freq: ModeFrequency | undefined;
  firstFailureTraceIds: string[];
  reviewed: number;
  traceModes: Record<string, ExecutionMode>;
  traceCases: Record<string, string>;
  evaluators: EvaluatorOption[];
  reload: () => void;
}) {
  const [action, setAction] = useState<Action>(null);
  const active = mode.status !== "merged" && mode.status !== "retired";
  const anyCount = freq?.any_count ?? 0;
  const firstCount = freq?.first_failure_count ?? 0;
  const evaluator = evaluators.find((e) => e.evaluator_id === mode.linked_evaluator_id);

  const submit = (op: TaxonomyOp) => async ({ author, note }: { author: string; note: string }) => {
    try {
      await postJSON("/api/taxonomy", { author, change_note: note, op });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    setAction(null);
    reload();
    return null;
  };

  return (
    <article className={cx("flex flex-col rounded-lg border bg-white p-4 shadow-sm", active ? "border-slate-200" : "border-dashed border-slate-300 opacity-90")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{mode.name}</h3>
          <code className="font-mono text-[11px] text-slate-500">{mode.failure_mode_id}</code>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge mode={mode} modes={modes} />
          <SeverityBadge severity={mode.severity} />
          <OriginBadge mode={mode} />
        </div>
      </div>

      <p className="mt-2 text-sm text-slate-800">{mode.definition}</p>

      <div className="mt-3">
        <KeyValue
          rows={[
            [
              "Observed (human labels)",
              mode.status === "merged" ? (
                <span key="o" className="text-slate-500">Counted under the merge target</span>
              ) : anyCount === 0 ? (
                <span key="o" className="font-medium text-amber-800">
                  0 observed — hypothesis
                  <span className="block text-xs font-normal text-slate-500">
                    No reviewer has tagged this on any of the {reviewed} human-reviewed trace{reviewed === 1 ? "" : "s"}.
                  </span>
                </span>
              ) : (
                <span key="o">
                  First failure in <b>{firstCount}</b> trace{firstCount === 1 ? "" : "s"} · mentioned in <b>{anyCount}</b> trace
                  {anyCount === 1 ? "" : "s"}
                  <span className="block text-xs text-slate-500">of {reviewed} human-reviewed traces</span>
                  <span className="mt-0.5 block">
                    <ModeMix traceIds={freq?.trace_ids ?? []} traceModes={traceModes} />
                  </span>
                </span>
              ),
            ],
            [
              "Linked evaluator",
              mode.linked_evaluator_id ? (
                <span key="e" className="inline-flex flex-wrap items-center gap-1">
                  <code className="font-mono text-xs">{mode.linked_evaluator_id}</code>
                  {evaluator?.experimental ? (
                    <Badge tone="amber" title="LLM judge — not yet validated against enough human labels">LLM judge · EXPERIMENTAL</Badge>
                  ) : evaluator ? (
                    <Badge>deterministic</Badge>
                  ) : (
                    <Badge tone="red">unknown evaluator</Badge>
                  )}
                </span>
              ) : (
                <span key="e" className="text-slate-500">none — no automated check yet</span>
              ),
            ],
            [
              "Representative traces",
              mode.representative_trace_ids.length === 0 ? (
                <span key="r" className="text-slate-500">none attached</span>
              ) : (
                <span key="r" className="flex flex-wrap gap-x-3 gap-y-1">
                  {mode.representative_trace_ids.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1">
                      {traceModes[id] ? <MockBadge mode={traceModes[id]} /> : <Badge tone="red">missing</Badge>}
                      <Link href={`/review/${id}`} className="font-mono text-xs text-sky-700 hover:underline">
                        {id}
                      </Link>
                    </span>
                  ))}
                </span>
              ),
            ],
          ]}
        />
      </div>

      {active && action === null && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          <Button variant="secondary" onClick={() => setAction("edit")}>Edit</Button>
          <Button variant="secondary" onClick={() => setAction("merge")}>Merge into…</Button>
          <Button variant="secondary" onClick={() => setAction("attach")}>Attach representative trace</Button>
          <Button variant="ghost" onClick={() => setAction("retire")}>Retire</Button>
        </div>
      )}

      {action === "edit" && <EditForm mode={mode} evaluators={evaluators} onSubmit={submit} onCancel={() => setAction(null)} />}
      {action === "merge" && <MergeForm mode={mode} modes={modes} onSubmit={submit} onCancel={() => setAction(null)} />}
      {action === "attach" && (
        <AttachForm
          mode={mode}
          observed={freq?.trace_ids ?? []}
          firstFailureTraceIds={firstFailureTraceIds}
          traceModes={traceModes}
          traceCases={traceCases}
          onSubmit={submit}
          onCancel={() => setAction(null)}
        />
      )}
      {action === "retire" && (
        <div className="mt-3">
          <ChangeForm
            title={`Retire “${mode.name}”`}
            help="Retired categories stay in the version history and cannot be assigned to new notes. Existing human tags are kept and still counted."
            submitLabel="Retire category"
            submitVariant="danger"
            onSubmit={submit({ type: "retire", failure_mode_id: mode.failure_mode_id })}
            onCancel={() => setAction(null)}
          />
        </div>
      )}
    </article>
  );
}

type SubmitFactory = (op: TaxonomyOp) => (ctx: { author: string; note: string }) => Promise<string | null>;

function EditForm({ mode, evaluators, onSubmit, onCancel }: { mode: FailureMode; evaluators: EvaluatorOption[]; onSubmit: SubmitFactory; onCancel: () => void }) {
  const [name, setName] = useState(mode.name);
  const [definition, setDefinition] = useState(mode.definition);
  const [severity, setSeverity] = useState<Severity>(mode.severity);
  const [evaluator, setEvaluator] = useState<string>(mode.linked_evaluator_id ?? "");
  return (
    <div className="mt-3">
      <ChangeForm
        title={`Edit “${mode.name}”`}
        help="The id stays the same so existing human tags keep pointing at this category."
        submitLabel="Save as new version"
        onCancel={onCancel}
        onSubmit={onSubmit({
          type: "edit",
          failure_mode_id: mode.failure_mode_id,
          name,
          definition,
          severity,
          linked_evaluator_id: evaluator || null,
        })}
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Name">
            <TextInput value={name} onChange={setName} />
          </Field>
          <Field label="Severity">
            <Select value={severity} onChange={setSeverity} options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
          </Field>
        </div>
        <Field label="Definition (one observable sentence)">
          <TextArea value={definition} onChange={setDefinition} rows={2} />
        </Field>
        <Field label="Linked evaluator" hint="Which automated check is meant to detect this failure. The LLM judge is experimental.">
          <Select
            value={evaluator}
            onChange={setEvaluator}
            options={[{ value: "", label: "none" }, ...evaluators.map((e) => ({ value: e.evaluator_id, label: e.label }))]}
          />
        </Field>
      </ChangeForm>
    </div>
  );
}

function MergeForm({ mode, modes, onSubmit, onCancel }: { mode: FailureMode; modes: FailureMode[]; onSubmit: SubmitFactory; onCancel: () => void }) {
  const targets = modes.filter((m) => m.failure_mode_id !== mode.failure_mode_id && m.status !== "merged" && m.status !== "retired");
  const [target, setTarget] = useState<string>(targets[0]?.failure_mode_id ?? "");
  return (
    <div className="mt-3">
      <ChangeForm
        title={`Merge “${mode.name}” into another category`}
        help="Use when two categories describe the same root cause. This category is kept for history as MERGED; its human tags and representative traces roll up into the target. Annotations are not rewritten."
        submitLabel="Merge"
        onCancel={onCancel}
        onSubmit={
          target
            ? onSubmit({ type: "merge", source_id: mode.failure_mode_id, target_id: target })
            : async () => "There is no active category to merge into"
        }
      >
        <Field label="Merge into">
          <Select
            value={target}
            onChange={setTarget}
            options={targets.length ? targets.map((m) => ({ value: m.failure_mode_id, label: `${m.name} (${m.failure_mode_id})` })) : [{ value: "", label: "no active category available" }]}
          />
        </Field>
      </ChangeForm>
    </div>
  );
}

function AttachForm({
  mode,
  observed,
  firstFailureTraceIds,
  traceModes,
  traceCases,
  onSubmit,
  onCancel,
}: {
  mode: FailureMode;
  observed: string[];
  firstFailureTraceIds: string[];
  traceModes: Record<string, ExecutionMode>;
  traceCases: Record<string, string>;
  onSubmit: SubmitFactory;
  onCancel: () => void;
}) {
  const options = observed.filter((id) => !mode.representative_trace_ids.includes(id));
  const [traceId, setTraceId] = useState<string>(options[0] ?? "");
  if (options.length === 0) {
    return (
      <div className="mt-3 space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
        <p>
          {observed.length === 0
            ? "No human-reviewed trace is tagged with this category yet, so there is nothing to attach. Assign a reviewer note to it first (Step 1)."
            : "Every observed trace is already attached."}
        </p>
        <Button variant="ghost" onClick={onCancel}>Close</Button>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <ChangeForm
        title={`Attach a representative trace to “${mode.name}”`}
        help="Only traces a human reviewer tagged with this category are offered. Prefer a LIVE trace where the failure is clear."
        submitLabel="Attach trace"
        onCancel={onCancel}
        onSubmit={onSubmit({ type: "attach_trace", failure_mode_id: mode.failure_mode_id, trace_id: traceId })}
      >
        <Field label="Observed trace">
          <Select
            value={traceId}
            onChange={setTraceId}
            options={options.map((id) => ({
              value: id,
              label: `${id} · case ${traceCases[id] ?? "?"} · ${(traceModes[id] ?? "missing").toUpperCase()}${firstFailureTraceIds.includes(id) ? " · first failure" : " · additional failure"}`,
            }))}
          />
        </Field>
      </ChangeForm>
    </div>
  );
}
