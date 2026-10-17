import { TraceReview } from "./TraceReview";

export default async function AgentTracePage(props: PageProps<"/agents/[agentId]/traces/[traceId]">) {
  const { agentId, traceId } = await props.params;
  // Keyed by trace so every trace starts with a fresh form and hidden automated results.
  return <TraceReview key={traceId} agentId={agentId} traceId={traceId} />;
}
