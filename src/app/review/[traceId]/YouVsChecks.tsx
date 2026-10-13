"use client";

/**
 * After the reviewer saves: their checklist answers side by side with what the
 * code checks and the (experimental) AI judge said. Disagreements are the
 * interesting rows — either the agent fooled a check, or the check/rubric is wrong.
 */
import type { ChecklistAnswer, RubricVersion } from "@/lib/rubric/rubric";
import type { EvaluationsResponse } from "../_queue/types";
import { Badge, Button, MockBadge } from "@/components/ui";

const YOU: Record<ChecklistAnswer, { label: string; tone: "green" | "red" | "neutral" }> = {
  ok: { label: "✓ ok", tone: "green" },
  problem: { label: "✗ problem", tone: "red" },
  skip: { label: "? skipped", tone: "neutral" },
};

type Auto = { label: string; tone: "green" | "red" | "amber" | "neutral"; as: ChecklistAnswer | null; detail?: string };

export function YouVsChecks(props: {
  rubric: RubricVersion;
  checklist: Record<string, ChecklistAnswer>;
  evals: EvaluationsResponse | null;
  error: string | null;
  judgeBusy: boolean;
  judgeMessage: string | null;
  onRunJudge: () => void;
  onShowDetails: () => void;
}) {
  const { rubric, checklist, evals, error, judgeBusy, judgeMessage, onRunJudge, onShowDetails } = props;
  const judge = evals?.judge_results.find((j) => j.judge_version === evals.current_judge_version) ?? null;

  function auto(evaluatorId: string | null, kind: string): Auto {
    if (!evaluatorId || kind === "human_only") return { label: "human only", tone: "neutral", as: null };
    if (!evals) return { label: "…", tone: "neutral", as: null };
    if (kind === "judge") {
      if (evals.judge_locked) return { label: "locked (held-out)", tone: "neutral", as: null };
      if (!judge) return { label: "not run", tone: "neutral", as: null };
      const as: ChecklistAnswer | null = judge.verdict === "PASS" ? "ok" : judge.verdict === "FAIL" ? "problem" : null;
      return {
        label: `AI judge: ${judge.verdict.replace(/_/g, " ")}`,
        tone: judge.verdict === "PASS" ? "green" : judge.verdict === "FAIL" ? "red" : "amber",
        as,
        detail: judge.output?.relevant_claims.join(" · "),
      };
    }
    const r = evals.deterministic.find((d) => d.evaluator_id === evaluatorId);
    if (!r) return { label: "—", tone: "neutral", as: null };
    return {
      label: `code: ${r.outcome.replace(/_/g, " ")}`,
      tone: r.outcome === "PASS" ? "green" : r.outcome === "FAIL" ? "red" : "amber",
      as: r.outcome === "PASS" ? "ok" : r.outcome === "FAIL" ? "problem" : null,
      detail: r.outcome === "FAIL" ? r.summary : undefined,
    };
  }

  const rows = rubric.review_checklist.map((item) => {
    const you = checklist[item.id] ?? null;
    const a = auto(item.evaluator_id, item.checked_by);
    const agree = you && you !== "skip" && a.as ? you === a.as : null;
    return { item, you, a, agree };
  });
  const disagreements = rows.filter((r) => r.agree === false).length;
  const judgeRow = rubric.review_checklist.find((c) => c.checked_by === "judge");

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-900">You vs automated checks</h2>
        {evals && (disagreements > 0 ? <Badge tone="amber">{disagreements} disagree</Badge> : <Badge tone="green">agree</Badge>)}
      </header>
      <div className="px-4 py-2">
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <table className="w-full text-sm">
          <tbody>
            {rows.map(({ item, you, a, agree }) => (
              <tr key={item.id} className="border-b border-slate-100 align-top last:border-0">
                <td className="py-1.5 pr-2 text-slate-700">{item.question}</td>
                <td className="py-1.5 pr-2">{you ? <Badge tone={YOU[you].tone}>{YOU[you].label}</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                <td className="py-1.5">
                  <Badge tone={a.tone}>{a.label}</Badge>
                  {agree === false && <span className="ml-1 text-xs font-semibold text-amber-700">≠</span>}
                  {a.detail && <div className="mt-0.5 text-xs text-slate-500">{a.detail}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {judgeRow && !judge && !evals?.judge_locked && evals?.judge_call.can_run !== false && (
            <Button variant="secondary" onClick={onRunJudge} disabled={judgeBusy}>
              {judgeBusy ? "Running judge…" : "Run AI judge"}
            </Button>
          )}
          {evals?.judge_call.can_run === false && <span className="text-xs text-slate-500">{evals.judge_call.unavailable_reason}</span>}
          {evals && !evals.judge_locked && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <MockBadge mode={evals.judge_call.mode} /> {evals.judge_call.mode === "live" ? `≈$${evals.judge_call.estimated_usd.toFixed(2)} per judge call` : "no spend"}
            </span>
          )}
          <button type="button" onClick={onShowDetails} className="text-xs text-sky-700 hover:underline">
            Full check details
          </button>
        </div>
        {judgeMessage && <p className="mt-1 text-xs text-slate-600">{judgeMessage}</p>}
        <p className="mt-2 text-[11px] text-slate-500">
          The AI judge is experimental: your answer is the reference, never the other way round.
        </p>
      </div>
    </section>
  );
}
