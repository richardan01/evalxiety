/**
 * Which pages belong to the built-in pricing demo, and which agent a page is about. Shared by the guide widget
 * (client) and the guide's live state (server), so both talk about the same thing.
 */
const DEMO_PREFIXES = ["/demo", "/review", "/evaluators", "/experiments", "/release"];

export const isDemoPath = (path: string) => DEMO_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

/** The agent id in /agents/<id>[/…], if the page is one agent's page. */
export function agentIdOf(path: string): string | null {
  const m = path.match(/^\/agents\/([a-z0-9][a-z0-9-]{0,63})(?:[/?#]|$)/);
  return m ? m[1] : null;
}
