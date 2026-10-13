"use client";

import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { Callout } from "@/components/ui";
import { EvaluatorDefinitions } from "./EvaluatorDefinitions";
import { JudgeCalibration } from "./JudgeCalibration";
import { ResultsMatrix } from "./ResultsMatrix";
import type { EvaluatorsResponse } from "./types";

const SECTIONS = [
  { href: "#definitions", label: "What we check" },
  { href: "#results", label: "Results on stored traces" },
  { href: "#calibration", label: "Judge calibration" },
];

export function EvaluatorsHome({ initialRunId }: { initialRunId: string | null }) {
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

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-slate-900">Evaluators</h1>
        <p className="max-w-4xl text-sm text-slate-600">
          Evaluators turn failure modes found in human trace review into repeatable binary checks. This page shows what each
          check asks, how it scored every stored trace, and — for the one LLM judge — how well it agrees with human reviewers.
        </p>
        <nav aria-label="Sections" className="flex flex-wrap gap-2 text-sm">
          {SECTIONS.map((s, i) => (
            <a key={s.href} href={s.href} className="rounded-md bg-white px-2.5 py-1 text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">
              <span className="mr-1 font-semibold text-slate-900">{i + 1}</span>
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      {error ? (
        <Callout tone="red" title="Could not load evaluators">
          {error}
        </Callout>
      ) : !data ? (
        <p className="text-sm text-slate-500">Loading evaluator definitions and results…</p>
      ) : (
        <>
          <EvaluatorDefinitions deterministic={data.deterministic} judge={data.judge} />
          <ResultsMatrix data={data} initialRunId={initialRunId} />
        </>
      )}

      <JudgeCalibration />
    </div>
  );
}
