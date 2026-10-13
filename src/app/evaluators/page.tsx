import { EvaluatorsHome } from "./EvaluatorsHome";

/** Evaluators tab: definitions (Phase 5), results across traces, judge calibration (Phase 6). */
export default async function EvaluatorsPage({ searchParams }: PageProps<"/evaluators">) {
  const sp = await searchParams;
  const runId = typeof sp.run_id === "string" && sp.run_id.trim() ? sp.run_id.trim() : null;
  return <EvaluatorsHome initialRunId={runId} />;
}
