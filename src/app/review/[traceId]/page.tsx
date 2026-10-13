import { TraceDetail, type Notice } from "./TraceDetail";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TracePage(props: PageProps<"/review/[traceId]">) {
  const { traceId } = await props.params;
  const sp = await props.searchParams;
  const saved = first(sp.saved);
  const deferred = first(sp.deferred);
  const notice: Notice = saved
    ? { kind: "saved", caseId: saved }
    : deferred
      ? { kind: "deferred", caseId: deferred }
      : null;
  // Keyed by trace so every trace starts with a fresh form and hidden automated results.
  return <TraceDetail key={traceId} traceId={traceId} notice={notice} />;
}
