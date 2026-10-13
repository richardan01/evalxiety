import { EvaluatorsHome } from "./EvaluatorsHome";

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Checks tab: the 5 checks, judge calibration (#calibration), per-trace results. ?run_id= ?split= ?mode= are optional. */
export default async function EvaluatorsPage({ searchParams }: PageProps<"/evaluators">) {
  const sp = await searchParams;
  const split = one(sp.split);
  const mode = one(sp.mode);
  return (
    <EvaluatorsHome
      initialRunId={one(sp.run_id)}
      initialSplit={split === "heldout" ? "heldout" : "dev"}
      initialMode={mode === "mock" ? "mock" : "live"}
      initialCheck={one(sp.check)}
    />
  );
}
