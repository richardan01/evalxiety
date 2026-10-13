"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { getJSON, postJSON } from "@/lib/client/api";
import type { Annotation, JudgeResult, PricingPolicy, Trace } from "@/lib/domain/schemas";
import type { RubricVersion } from "@/lib/rubric/rubric";
import { Badge, Button, EmptyState, MockBadge, SplitBadge } from "@/components/ui";
import { addDeferred, neighbours, nextUnreviewedAfter, readDeferred, removeDeferred } from "../_queue/order";
import { Kbd } from "../_queue/bits";
import type { AnnotationsResponse, EvaluationsResponse, QueueResponse, TaxonomyResponse } from "../_queue/types";
import { useReviewerDraft } from "../_queue/useReviewer";
import { type SaveState, type TaxonomyState } from "./AnnotationForm";
import { AutomatedChecks, HiddenChecks, type JudgeRunState } from "./AutomatedChecks";
import { OtherAnnotations } from "./OtherAnnotations";
import { ReviewCard } from "./ReviewCard";
import { QuickReviewForm } from "./QuickReviewForm";
import { YouVsChecks } from "./YouVsChecks";
import { EMPTY_QUICK, quickFromAnnotation, quickToPayload, validateQuick, type QuickErrors, type QuickForm } from "./quickForm";

export type Notice = { kind: "saved" | "deferred"; caseId: string } | null;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const keyFor = (reviewer: string, a: Annotation | null) => `${reviewer}|${a?.annotation_id ?? "new"}|${a?.updated_at ?? ""}`;
const UNSAVED_PROMPT = "You have unsaved changes on this trace. Leave without saving?";

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

/** One-trace-per-screen review workspace: read the trace (left), label it (right), then compare with automated checks. */
export function TraceDetail({ traceId, notice }: { traceId: string; notice: Notice }) {
  const router = useRouter();
  const reviewer = useReviewerDraft();

  const [trace, setTrace] = useState<Trace | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [annotationsError, setAnnotationsError] = useState<string | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyState>({ status: "loading" });
  const [rubric, setRubric] = useState<RubricVersion | null>(null);
  const [policies, setPolicies] = useState<PricingPolicy[] | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // ---- data loading --------------------------------------------------------
  const loadQueue = useCallback(
    () =>
      getJSON<QueueResponse>("/api/review/queue")
        .then((d) => {
          setQueue(d);
          setQueueError(null);
          return d;
        })
        .catch((e: unknown) => {
          setQueueError(errMsg(e));
          return null;
        }),
    [],
  );

  const loadAnnotations = useCallback(
    () =>
      getJSON<AnnotationsResponse>(`/api/annotations?trace_id=${encodeURIComponent(traceId)}`)
        .then((d) => {
          setAnnotations(d.annotations);
          setAnnotationsError(null);
        })
        .catch((e: unknown) => setAnnotationsError(errMsg(e))),
    [traceId],
  );

  useEffect(() => {
    let alive = true;
    getJSON<{ trace: Trace }>(`/api/traces/${encodeURIComponent(traceId)}`)
      .then((d) => alive && setTrace(d.trace))
      .catch((e: unknown) => alive && setTraceError(errMsg(e)));
    getJSON<TaxonomyResponse>("/api/taxonomy")
      .then((d) => {
        if (!alive) return;
        if (typeof d?.version === "number" && Array.isArray(d?.failure_modes)) {
          setTaxonomy({ status: "ok", version: d.version, modes: d.failure_modes });
        } else {
          setTaxonomy({ status: "unavailable", reason: "unexpected response" });
        }
      })
      .catch((e: unknown) => alive && setTaxonomy({ status: "unavailable", reason: errMsg(e) }));
    getJSON<{ rubric: RubricVersion }>("/api/rubric")
      .then((d) => alive && setRubric(d.rubric))
      .catch((e: unknown) => alive && setTraceError(`Rubric unavailable: ${errMsg(e)}`));
    getJSON<{ policies: PricingPolicy[] }>("/api/scenarios")
      .then((d) => alive && setPolicies(d.policies))
      .catch(() => undefined);
    void loadQueue();
    void loadAnnotations();
    return () => {
      alive = false;
    };
  }, [traceId, loadQueue, loadAnnotations]);

  // ---- form state (prefilled only from this reviewer's own saved human label) ----
  const own = annotations?.find((a) => a.reviewer === reviewer.stored && reviewer.stored !== "") ?? null;
  const others = (annotations ?? []).filter((a) => a !== own);
  const sourceKey = annotations === null || rubric === null ? null : keyFor(reviewer.stored, own);

  const [form, setForm] = useState<QuickForm>(EMPTY_QUICK);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  if (sourceKey !== null && sourceKey !== loadedKey && !dirty) {
    // Adjust state while rendering when the source annotation changes (reviewer switch, fresh load).
    setLoadedKey(sourceKey);
    setForm(own && rubric ? quickFromAnnotation(own, rubric) : EMPTY_QUICK);
  }

  const errors: QuickErrors = showErrors && rubric ? validateQuick(form, reviewer.value, rubric) : {};

  function update(patch: Partial<QuickForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    if (saveState.status !== "idle" && saveState.status !== "saving") setSaveState({ status: "idle" });
  }

  // ---- automated results: hidden until this reviewer has saved (or explicitly reveals) ----
  const [revealAnyway, setRevealAnyway] = useState(false);
  const revealed = own !== null || revealAnyway;
  const [evals, setEvals] = useState<EvaluationsResponse | null>(null);
  const [evalsError, setEvalsError] = useState<string | null>(null);
  const [judge, setJudge] = useState<JudgeRunState>({ busy: false, error: null, message: null });

  const loadEvals = useCallback(
    () =>
      getJSON<EvaluationsResponse>(`/api/traces/${encodeURIComponent(traceId)}/evaluations`)
        .then((d) => {
          setEvals(d);
          setEvalsError(null);
        })
        .catch((e: unknown) => setEvalsError(errMsg(e))),
    [traceId],
  );

  useEffect(() => {
    if (revealed) void loadEvals();
  }, [revealed, loadEvals]);

  async function runJudge() {
    const actor = reviewer.commit();
    if (!actor) {
      setJudge({ busy: false, error: "Enter your reviewer name first — judge runs are audited.", message: null });
      return;
    }
    setJudge({ busy: true, error: null, message: null });
    try {
      const { judge_result } = await postJSON<{ judge_result: JudgeResult }>("/api/judge", { trace_id: traceId, actor });
      setJudge({
        busy: false,
        error: null,
        message: `Judge finished: ${judge_result.verdict.replace(/_/g, " ")} (${judge_result.execution_mode.toUpperCase()}).`,
      });
      await loadEvals();
    } catch (e) {
      setJudge({ busy: false, error: errMsg(e), message: null });
    }
  }

  // ---- navigation ------------------------------------------------------------
  const nav = queue ? neighbours(queue.items, traceId) : null;

  function go(id: string, query = "") {
    if (dirty && !window.confirm(UNSAVED_PROMPT)) return;
    router.push(`/review/${id}${query}`);
  }

  function defer() {
    if (!trace) return;
    if (!queue) {
      setSaveState({ status: "info", message: "The queue has not loaded yet, so there is no next trace to defer to." });
      return;
    }
    const next = nextUnreviewedAfter(queue.items, traceId, new Set([...readDeferred(), traceId]));
    if (!next) {
      setSaveState({ status: "info", message: "Nothing to defer to: no other unreviewed traces remain. Label this one or go back to the queue." });
      return;
    }
    if (dirty && !window.confirm(UNSAVED_PROMPT)) return;
    addDeferred(traceId); // session-only; nothing is recorded on the server
    router.push(`/review/${next.trace.trace_id}?deferred=${encodeURIComponent(trace.case_id)}`);
  }

  async function save(andNext: boolean) {
    if (!trace || !rubric || saveState.status === "saving") return;
    const loadedFor = loadedKey?.split("|")[0] ?? "";
    const name = reviewer.commit().trim();
    if (own && name !== loadedFor) {
      // The form shows another reviewer's saved answers; never re-save them under a new name.
      setDirty(false);
      setLoadedKey(null);
      setSaveState({ status: "info", message: `Switched reviewer to ${name || "(none)"} — answers reset. Check and save again.` });
      return;
    }
    const v = validateQuick(form, name, rubric);
    if (Object.keys(v).length > 0) {
      setShowErrors(true);
      setSaveState({ status: "error", message: "Not saved — complete the highlighted fields." });
      return;
    }
    setSaveState({ status: "saving" });
    try {
      const taxonomyVersion = taxonomy.status === "ok" ? taxonomy.version : (own?.taxonomy_version ?? null);
      const { annotation } = await postJSON<{ annotation: Annotation; created: boolean }>(
        "/api/annotations",
        quickToPayload(form, rubric, { trace_id: trace.trace_id, case_id: trace.case_id, reviewer: name, taxonomy_version: taxonomyVersion }),
      );
      // Show the server's copy immediately, then refresh everything in the background.
      setAnnotations((prev) => [...(prev ?? []).filter((a) => a.annotation_id !== annotation.annotation_id), annotation]);
      setForm(quickFromAnnotation(annotation, rubric));
      setLoadedKey(keyFor(annotation.reviewer, annotation));
      setDirty(false);
      setShowErrors(false);
      removeDeferred(traceId);
      const time = new Date(annotation.updated_at).toLocaleTimeString("en-US", { timeStyle: "short" });
      const summary = `${annotation.task_outcome.toUpperCase()}${annotation.severity ? `, ${annotation.severity}` : ""}`;
      setSaveState({ status: "saved", message: `Saved at ${time} — human label (${summary}) recorded for ${annotation.reviewer}.` });
      const [, q] = await Promise.all([loadAnnotations(), loadQueue()]);
      if (andNext) {
        const next = q ? nextUnreviewedAfter(q.items, traceId, readDeferred()) : null;
        if (next) {
          router.push(`/review/${next.trace.trace_id}?saved=${encodeURIComponent(trace.case_id)}`);
        } else {
          setSaveState({
            status: "saved",
            message: `Saved at ${time}. No unreviewed traces left${readDeferred().size ? " (except ones you deferred)" : ""} — the queue is done.`,
          });
        }
      }
    } catch (e) {
      setSaveState({ status: "error", message: `Not saved: ${errMsg(e)}` });
    }
  }

  // ---- keyboard shortcuts ------------------------------------------------------
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      if (!trace || annotations === null) return;
      e.preventDefault();
      void save(true);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingTarget(e.target)) return;
    if (!trace || annotations === null) return; // don't mark the form dirty before the saved label has loaded
    switch (e.key) {
      case "1":
        update({ verdict: "pass" });
        break;
      case "2":
        update({ verdict: "fail" });
        break;
      case "d":
      case "D":
        defer();
        break;
      case "ArrowLeft":
        if (!nav?.prev) return;
        go(nav.prev.trace.trace_id);
        break;
      case "ArrowRight":
        if (!nav?.next) return;
        go(nav.next.trace.trace_id);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---- render ----------------------------------------------------------------
  if (traceError) {
    return (
      <div className="space-y-3">
        <BackLink dirty={false} />
        <EmptyState title="Trace not available">
          {traceError}. Go back to the annotation queue and pick a trace, or run a pricing case to create one.
        </EmptyState>
      </div>
    );
  }

  const item = queue?.items.find((i) => i.trace.trace_id === traceId) ?? null;
  const split = item?.split ?? null; // only meaningful once `item` has loaded

  return (
    <div className="space-y-3">
      {/* Top bar: back, progress, prev/next */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink dirty={dirty} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {nav && nav.index >= 0 && queue ? (
            <span>
              Trace <b className="tabular-nums text-slate-900">{nav.index + 1}</b> of{" "}
              <b className="tabular-nums text-slate-900">{nav.total}</b> in review order ·{" "}
              <b className="tabular-nums">{queue.reviewed_count}</b> of {queue.total} human-reviewed
            </span>
          ) : queueError ? (
            <span className="text-rose-700">Queue unavailable: {queueError}</span>
          ) : (
            <span>Loading queue…</span>
          )}
          <Button variant="secondary" disabled={!nav?.prev} onClick={() => nav?.prev && go(nav.prev.trace.trace_id)}>
            <Kbd>←</Kbd> Previous
          </Button>
          <Button variant="secondary" disabled={!nav?.next} onClick={() => nav?.next && go(nav.next.trace.trace_id)}>
            Next <Kbd>→</Kbd>
          </Button>
        </div>
      </div>

      {notice && (
        <div
          className={
            notice.kind === "saved"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900"
              : "rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
          }
        >
          {notice.kind === "saved"
            ? `Saved your label for ${notice.caseId}. This is the next unreviewed trace.`
            : `Deferred ${notice.caseId} — nothing was recorded; it stays UNREVIEWED in the queue.`}
        </div>
      )}

      {!trace ? (
        <p className="text-sm text-slate-500">Loading trace…</p>
      ) : (
        <>
          {/* Title strip */}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">
              {trace.case_id} · {trace.input.title}
            </h1>
            <MockBadge mode={trace.execution_mode} />
            {item && <SplitBadge split={split} />}
            {item && split === null && <Badge title="Outside the frozen split: labels help discovery but cannot become gold">custom case</Badge>}
            <Badge tone="neutral">{trace.agent_version.replace("pricing-agent@", "")}</Badge>
            {annotations && annotations.length === 0 && <Badge>UNREVIEWED</Badge>}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0">
              <ReviewCard trace={trace} policies={policies} />
            </div>

            <aside className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
              {annotationsError && <p className="text-sm text-rose-700">Could not load existing labels: {annotationsError}</p>}
              {annotations === null || rubric === null ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : (
                <QuickReviewForm
                  rubric={rubric}
                  modes={taxonomy.status === "ok" ? taxonomy.modes : []}
                  form={form}
                  onChange={update}
                  errors={errors}
                  reviewer={reviewer}
                  alreadySaved={own !== null}
                  dirty={dirty}
                  saveState={saveState}
                  onSave={() => void save(true)}
                  onSkip={defer}
                />
              )}

              {revealed && rubric ? (
                <>
                  <YouVsChecks
                    rubric={rubric}
                    checklist={own ? (own.checklist ?? {}) : form.checklist}
                    evals={evals}
                    error={evalsError}
                    judgeBusy={judge.busy}
                    judgeMessage={judge.error ?? judge.message}
                    onRunJudge={() => void runJudge()}
                    onShowDetails={() => setShowDetails((v) => !v)}
                  />
                  {showDetails && (
                    <AutomatedChecks
                      trace={trace}
                      evals={evals}
                      error={evalsError}
                      revealedEarly={own === null}
                      ownLabel={own?.unsupported_justification_label ?? null}
                      judge={judge}
                      canRunJudge={reviewer.value.trim() !== ""}
                      onRunJudge={() => void runJudge()}
                      onRetry={() => void loadEvals()}
                    />
                  )}
                </>
              ) : (
                <HiddenChecks onRevealAnyway={() => setRevealAnyway(true)} />
              )}

              {annotations && others.length > 0 && (
                <OtherAnnotations
                  annotations={others}
                  modes={taxonomy.status === "ok" ? taxonomy.modes : null}
                  ownSaved={own !== null}
                />
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function BackLink({ dirty }: { dirty: boolean }) {
  return (
    <Link
      href="/review"
      className="text-sm text-sky-700 hover:underline"
      onClick={(e) => {
        if (dirty && !window.confirm(UNSAVED_PROMPT)) e.preventDefault();
      }}
    >
      ← Annotation queue
    </Link>
  );
}
