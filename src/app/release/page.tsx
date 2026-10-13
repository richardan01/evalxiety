import { ReleaseGate } from "./ReleaseGate";

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : "");

/** Release Gate tab. ?candidate=<run_id>&baseline=<run_id> pre-selects runs (default: latest completed FROZEN-FULL-v1 runs). */
export default async function ReleasePage(props: PageProps<"/release">) {
  const sp = await props.searchParams;
  const candidate = one(sp.candidate);
  const baseline = one(sp.baseline);
  // Keyed so navigating to a different ?candidate/?baseline (e.g. the header tab) starts from that selection.
  return <ReleaseGate key={`${candidate}|${baseline}`} initialCandidate={candidate} initialBaseline={baseline} />;
}
