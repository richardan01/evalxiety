"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { postJSON } from "@/lib/client/api";
import type { ExecutionMode, FailureMode, Severity } from "@/lib/domain/schemas";
import type { ModeFrequency } from "@/lib/taxonomy/ops";
import { Badge, Button, MockBadge, SeverityBadge, cx } from "@/components/ui";
import { ChangeForm, Field, Select, TextArea, TextInput } from "./_shared/forms";
import { FrequencyBar, SeenCount } from "./FrequencyTable";
import type { EvaluatorOption, TaxonomyOp } from "./types";

const SEVERITIES: Severity[] = ["critical", "major", "minor"];

/** Badge for types that are no longer assignable. Active types show their count instead. */
export function StatusBadge({ mode, modes }: { mode: FailureMode; modes: FailureMode[] }) {
  if (mode.status === "merged") {
    const target = modes.find((m) => m.failure_mode_id === mode.merged_into);
    return (
      <Badge tone="slate" title="Kept for history; its observations count under the target">
        merged → {target?.name ?? mode.merged_into}
      </Badge>
    );
  }
  if (mode.status === "retired") {
    return (
      <Badge tone="neutral" title="No longer assignable; kept for history">
        retired
      </Badge>
    );
  }
  return null;
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </span>
  );
}

type Action = null | "edit" | "merge" | "retire" | "attach";

/** One failure type: name, frequency bar, human-observed count. Actions sit behind "Edit". */
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
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const active = mode.status !== "merged" && mode.status !== "retired";
  const anyCount = freq?.any_count ?? 0;
  const firstCount = freq?.first_failure_count ?? 0;
  const seen = anyCount > 0;
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
    <li className="py-2">
      <div className="grid grid-cols-[minmax(0,15rem)_minmax(5rem,1fr)_minmax(0,17rem)_3rem] items-center gap-x-4">
        <span
          className={cx("truncate text-sm font-medium", seen && active ? "text-slate-900" : "text-slate-400")}
          title={mode.definition}
        >
          {mode.name}
        </span>
        <FrequencyBar count={anyCount} reviewed={reviewed} muted={!active} />
        {mode.status === "merged" ? (
          <StatusBadge mode={mode} modes={modes} />
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <SeenCount count={anyCount} reviewed={reviewed} traceIds={freq?.trace_ids ?? []} traceModes={traceModes} />
            {mode.status === "retired" && <StatusBadge mode={mode} modes={modes} />}
          </span>
        )}
        {active ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
              setAction(null);
            }}
            className="justify-self-end text-xs font-medium text-sky-700 hover:underline"
          >
            {open ? "Close" : "Edit"}
          </button>
        ) : (
          <span />
        )}
      </div>

      {open && active && (
        <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-3">
          <p className="text-sm text-slate-700">{mode.definition}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
            <Meta label="Severity">
              <SeverityBadge severity={mode.severity} />
            </Meta>
            <Meta label="Origin">
              {mode.origin === "seed_hypothesis" ? (
                <Badge tone="purple" title="Written from the project brief before any trace was read">
                  seed hypothesis
                </Badge>
              ) : (
                <span>reviewer-added</span>
              )}
            </Meta>
            <Meta label="First failure">
              <span className="tabular-nums">
                {firstCount} of {reviewed}
              </span>
            </Meta>
            <Meta label="Check">
              {mode.linked_evaluator_id ? (
                <>
                  <code className="font-mono">{mode.linked_evaluator_id}</code>
                  {evaluator?.experimental && (
                    <Badge tone="amber" title="LLM judge — not yet validated against enough human labels">
                      EXPERIMENTAL
                    </Badge>
                  )}
                  {!evaluator && <Badge tone="red">unknown</Badge>}
                </>
              ) : (
                <span className="text-slate-400">none</span>
              )}
            </Meta>
            <Meta label="Examples">
              {mode.representative_trace_ids.length === 0 ? (
                <span className="text-slate-400">none</span>
              ) : (
                mode.representative_trace_ids.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1">
                    {traceModes[id] ? <MockBadge mode={traceModes[id]} /> : <Badge tone="red">missing</Badge>}
                    <Link href={`/review/${id}`} className="text-sky-700 hover:underline">
                      {traceCases[id] ?? id}
                    </Link>
                  </span>
                ))
              )}
            </Meta>
          </div>

          {action === null && (
            <div className="flex flex-wrap gap-1.5">
              <Button variant="secondary" onClick={() => setAction("edit")}>
                Edit details
              </Button>
              <Button variant="secondary" onClick={() => setAction("merge")}>
                Merge…
              </Button>
              <Button variant="secondary" onClick={() => setAction("attach")}>
                Attach example
              </Button>
              <Button variant="ghost" onClick={() => setAction("retire")}>
                Retire
              </Button>
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
            <ChangeForm
              title={`Retire “${mode.name}”`}
              help="Kept in history; existing human tags still count. No new notes can use it."
              submitLabel="Retire"
              submitVariant="danger"
              onSubmit={submit({ type: "retire", failure_mode_id: mode.failure_mode_id })}
              onCancel={() => setAction(null)}
            />
          )}
        </div>
      )}
    </li>
  );
}

type SubmitFactory = (op: TaxonomyOp) => (ctx: { author: string; note: string }) => Promise<string | null>;

function EditForm({ mode, evaluators, onSubmit, onCancel }: { mode: FailureMode; evaluators: EvaluatorOption[]; onSubmit: SubmitFactory; onCancel: () => void }) {
  const [name, setName] = useState(mode.name);
  const [definition, setDefinition] = useState(mode.definition);
  const [severity, setSeverity] = useState<Severity>(mode.severity);
  const [evaluator, setEvaluator] = useState<string>(mode.linked_evaluator_id ?? "");
  return (
    <ChangeForm
      title={`Edit “${mode.name}”`}
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
      <Field label="Automated check">
        <Select
          value={evaluator}
          onChange={setEvaluator}
          options={[{ value: "", label: "none" }, ...evaluators.map((e) => ({ value: e.evaluator_id, label: e.label }))]}
        />
      </Field>
    </ChangeForm>
  );
}

function MergeForm({ mode, modes, onSubmit, onCancel }: { mode: FailureMode; modes: FailureMode[]; onSubmit: SubmitFactory; onCancel: () => void }) {
  const targets = modes.filter((m) => m.failure_mode_id !== mode.failure_mode_id && m.status !== "merged" && m.status !== "retired");
  const [target, setTarget] = useState<string>(targets[0]?.failure_mode_id ?? "");
  return (
    <ChangeForm
      title={`Merge “${mode.name}” into…`}
      help="Same root cause? Its tags and examples roll up into the target. Annotations are not rewritten."
      submitLabel="Merge"
      onCancel={onCancel}
      onSubmit={
        target
          ? onSubmit({ type: "merge", source_id: mode.failure_mode_id, target_id: target })
          : async () => "There is no active type to merge into"
      }
    >
      <Field label="Merge into">
        <Select
          value={target}
          onChange={setTarget}
          options={targets.length ? targets.map((m) => ({ value: m.failure_mode_id, label: m.name })) : [{ value: "", label: "no active type available" }]}
        />
      </Field>
    </ChangeForm>
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
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
        {observed.length === 0 ? "No reviewed trace is tagged with this type yet." : "Every tagged trace is already attached."}
        <Button variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }
  return (
    <ChangeForm
      title={`Attach an example to “${mode.name}”`}
      help="Only traces a human tagged with this type. Prefer a LIVE one."
      submitLabel="Attach"
      onCancel={onCancel}
      onSubmit={onSubmit({ type: "attach_trace", failure_mode_id: mode.failure_mode_id, trace_id: traceId })}
    >
      <Field label="Trace">
        <Select
          value={traceId}
          onChange={setTraceId}
          options={options.map((id) => ({
            value: id,
            label: `${traceCases[id] ?? "?"} · ${(traceModes[id] ?? "missing").toUpperCase()}${firstFailureTraceIds.includes(id) ? " · first failure" : ""} · ${id}`,
          }))}
        />
      </Field>
    </ChangeForm>
  );
}
