import { AgentWorkspace } from "./AgentWorkspace";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AgentPage(props: PageProps<"/agents/[agentId]">) {
  const { agentId } = await props.params;
  const sp = await props.searchParams;
  return <AgentWorkspace key={agentId} agentId={agentId} candidate={first(sp.candidate)} baseline={first(sp.baseline)} />;
}
