import { AgentsHome } from "./AgentsHome";

/** ?connect=1 opens the "Connect your agent" wizard straight away (linked from the sidebar and the starter kit). */
export default async function AgentsPage(props: PageProps<"/agents">) {
  const sp = await props.searchParams;
  return <AgentsHome openWizard={sp.connect === "1"} />;
}
