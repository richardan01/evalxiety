"use client";

import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { PageHeader } from "@/components/ui";
import { EvaluatorDefinitions } from "./EvaluatorDefinitions";
import { JudgeCalibration, type Mode, type Split } from "./JudgeCalibration";
import { ResultsMatrix } from "./ResultsMatrix";
import type { EvaluatorsResponse } from "./types";

export function EvaluatorsHome({ initialRunId, initialSplit, initialMode }: {
  initialRunId: string | null;
  initialSplit: Split;
  initialMode: Mode;
}) {
  const [data, setData] = useState<EvaluatorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getJSON<EvaluatorsResponse>("/api/evaluators")
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // The check cards load after first paint and push #calibration down; re-apply a deep link once they are in.
  useEffect(() => {
    if (!data) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [data]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Checks"
        question="What do we check automatically — and can we trust the AI judge?"
        info={
          <>
            4 code checks re-run on every stored trace. 1 AI judge asks whether the agent&apos;s explanation makes claims the
            evidence doesn&apos;t back — it stays experimental until it agrees with human labels.
          </>
        }
      />

      {error ? (
        <p className="text-sm text-rose-700">Could not load checks: {error}</p>
      ) : !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <EvaluatorDefinitions deterministic={data.deterministic} judge={data.judge} rows={data.results} />
      )}

      <JudgeCalibration initialSplit={initialSplit} initialMode={initialMode} />

      {data && <ResultsMatrix data={data} initialRunId={initialRunId} />}
    </div>
  );
}
