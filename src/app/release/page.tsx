import { ReleaseGate } from "./ReleaseGate";

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : "");

/** Release Gate tab. ?candidate=<run_id>&baseline=<run_id> pre-selects runs (default: latest completed FROZEN-FULL-v1 runs). */
export default async function ReleasePage(props: PageProps<"/release">) {
  const sp = await props.searchParams;
  // The URL is the single source of truth for the selection: ReleaseGate changes it with router.replace.
  return <ReleaseGate candidate={one(sp.candidate)} baseline={one(sp.baseline)} />;
}
