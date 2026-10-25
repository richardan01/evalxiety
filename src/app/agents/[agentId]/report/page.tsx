import { ReleaseReport } from "./ReleaseReport";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AgentReportPage(props: PageProps<"/agents/[agentId]/report">) {
  const { agentId } = await props.params;
  const sp = await props.searchParams;
  return <ReleaseReport key={agentId} agentId={agentId} candidate={first(sp.candidate)} baseline={first(sp.baseline)} />;
}
