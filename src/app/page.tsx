import { redirect } from "next/navigation";
import { connection } from "next/server";
import { loadAgents } from "@/lib/agents/config";
import { OverviewDashboard } from "./_overview/OverviewDashboard";

/**
 * Home. Once you've connected an agent of your own, home is that agent's world (Your agents); the built-in pricing
 * demo stays one click away at /demo. Before that, home is the demo dashboard, so a first visit shows the method
 * working end to end.
 */
export default async function HomePage() {
  await connection(); // decided per request: agent folders can appear while the app runs
  const { agents } = await loadAgents().catch(() => ({ agents: [] as Awaited<ReturnType<typeof loadAgents>>["agents"] }));
  if (agents.some((a) => !a.config.example)) redirect("/agents");
  return <OverviewDashboard />;
}
