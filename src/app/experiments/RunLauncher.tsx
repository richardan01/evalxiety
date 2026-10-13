"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, InfoTip, MockBadge, cx, fmtUsd } from "@/components/ui";
import { apiRequest } from "./request";
import { useReviewer } from "./reviewer";
import { HELDOUT_REVEAL_HREF, PaidBatchDialog, ReviewerInline } from "./shared";
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

const SELECT = "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm";

/** One-row launcher: version, test set, judge option, Run. Live runs go through the 409 spend confirmation. */
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
  const heldoutLocked = Boolean(set?.includesHeldout && !data.heldout.revealed);

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
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-900">Run</span>
        <select aria-label="Version" className={SELECT} value={configId} onChange={(e) => setConfigId(e.target.value)}>
          {data.agent_configs.map((c) => (
            <option key={c.config_id} value={c.config_id}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="text-slate-400">on</span>
        <select aria-label="Test set" className={SELECT} value={setId} onChange={(e) => setSetId(e.target.value)}>
          {data.frozen_sets.map((s) => (
            <option key={s.frozen_set_id} value={s.frozen_set_id}>
              {s.frozen_set_id} · {s.case_ids.length} cases{s.includesHeldout ? " · held-out" : ""}
            </option>
          ))}
        </select>
        <label className="ml-1 inline-flex items-center gap-1.5 text-slate-700" title="Experimental judge, reported separately — never part of pass-all">
          <input type="checkbox" checked={runJudge} onChange={(e) => setRunJudge(e.target.checked)} />
          AI judge
        </label>
        {data.mode.mode === "live" && (
          <label className="inline-flex items-center gap-1.5 text-slate-700" title="Mock results are labelled MOCK and are not evidence about the real model">
            <input type="checkbox" checked={forceMock} onChange={(e) => setForceMock(e.target.checked)} />
            Mock (no spend)
          </label>
        )}
        <span aria-hidden className="mx-1 h-5 w-px bg-slate-200" />
        <ReviewerInline />

        <span className="ml-auto inline-flex items-center gap-2">
          {heldoutLocked && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-violet-200 ring-inset" title="Held-out cases cannot run until an audited reveal">
              Locked
            </span>
          )}
          <MockBadge mode={effectiveMode} />
          {effectiveMode === "mock" ? (
            <span className="text-xs text-amber-800" title={data.mode.mode === "mock" ? data.mode.reason : "Forced mock for this run"}>
              no spend
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-slate-600">
              ≈ <b className="tabular-nums text-slate-900">{fmtUsd(agentCost + judgeCost)}</b>
              <InfoTip label="How is this estimated?">
                {nCases} cases × {fmtUsd(data.estimate_per_case.agent, 3)} per agent call
                {runJudge ? ` + ${nCases} × ${fmtUsd(data.estimate_per_case.judge, 3)} per judge call` : ""}. Rough, not a guarantee (cached prompts
                cost $0). The spend cap is enforced per call, so a batch can stop early near the cap. You confirm before anything is spent.
              </InfoTip>
            </span>
          )}
          <Button
            disabled={busy || !reviewer || !config || !set}
            onClick={() => submit({ config_id: configId, frozen_set_id: setId, actor: reviewer, run_judge: runJudge, force_mock: forceMock })}
            title={!reviewer ? "Enter your name first — it is recorded in the audit log" : undefined}
          >
            {busy ? "Starting…" : `Run ${config?.label ?? ""}`}
          </Button>
        </span>
      </div>

      {heldoutLocked && !outcome && (
        <Line tone="violet">
          {setId} includes held-out cases, locked until the audited reveal in{" "}
          <Link href={HELDOUT_REVEAL_HREF} className="font-medium underline">
            Evaluators → judge calibration
          </Link>
          .
        </Line>
      )}
      {outcome?.kind === "started" && (
        <Line tone="blue">
          Started <code className="font-mono">{outcome.run.run_id}</code> ({outcome.run.case_ids.length} cases, {outcome.run.execution_mode.toUpperCase()}) —
          progress shows above the results.
        </Line>
      )}
      {outcome?.kind === "locked" && (
        <Line tone="red">
          Held-out cases are locked: {outcome.message} Reveal them (final check only) in{" "}
          <Link href={HELDOUT_REVEAL_HREF} className="font-medium underline">
            Evaluators → judge calibration
          </Link>
          .
        </Line>
      )}
      {outcome?.kind === "error" && <Line tone="red">Could not start the run: {outcome.message}</Line>}

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
    </div>
  );
}

function Line({ tone, children }: { tone: "red" | "blue" | "violet"; children: ReactNode }) {
  return (
    <p className={cx("mt-2 text-xs", tone === "red" ? "text-rose-700" : tone === "violet" ? "text-violet-800" : "text-sky-800")}>{children}</p>
  );
}
