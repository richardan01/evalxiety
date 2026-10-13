"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge, Button, Callout, Card, MockBadge, cx, fmtUsd } from "@/components/ui";
import { HeldoutLockBadge } from "./FrozenSetsSection";
import { apiRequest } from "./request";
import { useReviewer } from "./reviewer";
import { PaidBatchDialog, ReviewerField } from "./shared";
import type { BatchEstimate, ExperimentRun, ExperimentsData } from "./types";

interface Payload {
  config_id: string;
  frozen_set_id: string;
  actor: string;
  run_judge: boolean;
  force_mock: boolean;
  confirm_paid_batch?: boolean;
}

type Outcome =
  | { kind: "started"; run: ExperimentRun }
  | { kind: "locked"; message: string }
  | { kind: "error"; message: string };

export function RunLauncher({ data, onStarted }: { data: ExperimentsData; onStarted: (run: ExperimentRun) => void }) {
  const reviewer = useReviewer();
  const [configId, setConfigId] = useState(data.agent_configs[0]?.config_id ?? "");
  const [setId, setSetId] = useState(data.frozen_sets.find((s) => s.frozen_set_id === "FROZEN-DEV-v1")?.frozen_set_id ?? data.frozen_sets[0]?.frozen_set_id ?? "");
  const [runJudge, setRunJudge] = useState(true);
  const [forceMock, setForceMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<{ payload: Payload; estimate: BatchEstimate; message: string } | null>(null);

  const set = data.frozen_sets.find((s) => s.frozen_set_id === setId);
  const config = data.agent_configs.find((c) => c.config_id === configId);
  const nCases = set?.case_ids.length ?? 0;
  const effectiveMode: "live" | "mock" = data.mode.mode === "live" && !forceMock ? "live" : "mock";
  const agentCost = nCases * data.estimate_per_case.agent;
  const judgeCost = runJudge ? nCases * data.estimate_per_case.judge : 0;
  const heldoutBlocked = Boolean(set?.includesHeldout && !data.heldout.revealed);

  async function submit(payload: Payload) {
    setBusy(true);
    setOutcome(null);
    const res = await apiRequest<{ run: ExperimentRun }>("POST", "/api/experiments", payload);
    setBusy(false);
    if (res.ok) {
      setPending(null);
      setOutcome({ kind: "started", run: res.data.run });
      onStarted(res.data.run);
      return;
    }
    if (res.status === 409 && res.estimate) {
      // Never auto-confirm: the user must click confirm in the dialog.
      setPending({ payload, estimate: res.estimate, message: res.error });
      return;
    }
    setPending(null);
    setOutcome(res.status === 423 ? { kind: "locked", message: res.error } : { kind: "error", message: res.error });
  }

  return (
    <Card
      title="Start an experiment run"
      subtitle="Runs one agent configuration over every case of one frozen set. Progress appears in the runs list below."
    >
      <div className="space-y-4">
        <Callout tone="blue" title="Recommended order">
          1) Run <b>Baseline</b> and <b>Corrected</b> on <code className="font-mono">FROZEN-DEV-v1</code> and compare them case by case. 2) Only
          for the final release check, run both on <code className="font-mono">FROZEN-FULL-v1</code> — it includes the held-out cases and
          requires the audited held-out reveal first.
        </Callout>

        <Step n={1} title="Who is starting this run?">
          <ReviewerField purpose="recorded in the audit log with the run" />
        </Step>

        <Step n={2} title="Agent configuration">
          <div className="grid gap-2 sm:grid-cols-2">
            {data.agent_configs.map((c) => (
              <label
                key={c.config_id}
                className={cx(
                  "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm",
                  configId === c.config_id ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <input type="radio" name="config" className="mt-1" checked={configId === c.config_id} onChange={() => setConfigId(c.config_id)} />
                <span>
                  <span className="font-medium text-slate-900">{c.label}</span>{" "}
                  <code className="font-mono text-xs text-slate-500">{c.config_id}</code>
                  <span className="block text-xs text-slate-500">
                    {c.prompt_version} · {c.retrieval_strategy.replace(/_/g, " ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Step>

        <Step n={3} title="Frozen test set">
          <div className="space-y-2">
            <select
              className="w-full max-w-xl rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={setId}
              onChange={(e) => setSetId(e.target.value)}
            >
              {data.frozen_sets.map((s) => (
                <option key={s.frozen_set_id} value={s.frozen_set_id}>
                  {s.frozen_set_id} — {s.case_ids.length} cases{s.includesHeldout ? " (includes HELD-OUT)" : ""}
                </option>
              ))}
            </select>
            {set && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>{set.description}</span>
                <HeldoutLockBadge set={set} heldout={data.heldout} />
              </div>
            )}
            {heldoutBlocked && (
              <p className="text-xs text-violet-800">
                This set includes held-out cases and held-out access is locked — the server will refuse to start it until the audited reveal
                in{" "}
                <Link href="/evaluators#calibration" className="font-medium underline">
                  Evaluators → judge calibration
                </Link>
                .
              </p>
            )}
          </div>
        </Step>

        <Step n={4} title="Options">
          <div className="space-y-1.5 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={runJudge} onChange={(e) => setRunJudge(e.target.checked)} />
              <span>
                Also run the experimental judge on each trace <Badge tone="purple">EXPERIMENTAL</Badge>
                <span className="block text-xs text-slate-500">
                  unsupported_pricing_justification — reported separately, never part of pass-all. Can also be run later with “Judge missing”.
                </span>
              </span>
            </label>
            {data.mode.mode === "live" && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={forceMock} onChange={(e) => setForceMock(e.target.checked)} />
                <span>
                  Force mock mode for this run (no spend)
                  <span className="block text-xs text-slate-500">Mock results are labelled MOCK and are not evidence about the real model.</span>
                </span>
              </label>
            )}
          </div>
        </Step>

        <Step n={5} title="Estimated cost, then start">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <MockBadge mode={effectiveMode} />
            {effectiveMode === "mock" ? (
              <span className="font-medium text-amber-800">
                MOCK — no spend{data.mode.mode === "mock" ? ` (${data.mode.reason})` : " (forced)"}
              </span>
            ) : (
              <span>
                Roughly <b className="tabular-nums">{fmtUsd(agentCost + judgeCost)}</b>{" "}
                <span className="text-xs text-slate-500">
                  = {nCases} cases × {fmtUsd(data.estimate_per_case.agent, 3)} per agent call
                  {runJudge ? ` + ${nCases} × ${fmtUsd(data.estimate_per_case.judge, 3)} per judge call` : ""}. Rough estimate, not a
                  guarantee — actual cost can be higher (cached identical prompts cost $0). The spend cap is what&apos;s enforced:
                  each call reserves its worst-case cost first, so a batch can stop early near the cap. You will be asked to confirm.
                </span>
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button
              disabled={busy || !reviewer || !config || !set}
              onClick={() =>
                submit({ config_id: configId, frozen_set_id: setId, actor: reviewer, run_judge: runJudge, force_mock: forceMock })
              }
              title={!reviewer ? "Enter your name in step 1 first" : undefined}
            >
              {busy ? "Starting…" : `Run ${config?.label ?? ""} on ${setId}`}
            </Button>
            {!reviewer && <span className="text-xs text-rose-700">Enter your name in step 1 to enable.</span>}
          </div>
        </Step>

        {outcome?.kind === "started" && (
          <Callout tone="blue" title="Run started">
            <code className="font-mono">{outcome.run.run_id}</code> is running in the background ({outcome.run.case_ids.length} cases,{" "}
            {outcome.run.execution_mode.toUpperCase()}). The runs list refreshes every 3 seconds while it runs.
          </Callout>
        )}
        {outcome?.kind === "locked" && (
          <Callout tone="red" title="Held-out cases are locked">
            <p>{outcome.message}</p>
            <p className="mt-1">
              The audited held-out reveal happens in{" "}
              <Link href="/evaluators#calibration" className="font-medium underline">
                Evaluators → judge calibration
              </Link>
              . Reveal only for the final check: after it, any prompt change is potentially contaminated by held-out knowledge.
            </p>
          </Callout>
        )}
        {outcome?.kind === "error" && (
          <Callout tone="red" title="Could not start the run">
            {outcome.message}
          </Callout>
        )}
      </div>

      {pending && (
        <PaidBatchDialog
          title={`Confirm live run: ${config?.label ?? configId} on ${setId}`}
          estimate={pending.estimate}
          message={pending.message}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => submit({ ...pending.payload, confirm_paid_batch: true })}
        />
      )}
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
      <div className="text-sm font-medium text-slate-800">
        <span className="mr-1.5 text-slate-400">{n}.</span>
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}
