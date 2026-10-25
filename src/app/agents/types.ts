/** Client-side view types for "your agents", derived from the server read models. */
import type { agentDefinition, agentOverview, agentsList, agentTraceDetail, agentRunDetail } from "@/lib/agents/services";

export type AgentsListView = Awaited<ReturnType<typeof agentsList>> & { agents_dir: string };
export type AgentOverview = Awaited<ReturnType<typeof agentOverview>>;
export type AgentTraceView = NonNullable<Awaited<ReturnType<typeof agentTraceDetail>>>;
export type AgentRunView = NonNullable<Awaited<ReturnType<typeof agentRunDetail>>>;
export type RunRow = AgentOverview["runs"][number];
export type DefinitionView = Awaited<ReturnType<typeof agentDefinition>>;
