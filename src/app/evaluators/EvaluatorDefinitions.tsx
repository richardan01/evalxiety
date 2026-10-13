import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { modeMix, orderChecks, plainName, tallyEvaluator, tallyJudge } from "./matrix";
import { CheckTag, InfoTipLeft, ModeMix, SectionTitle } from "./parts";
import type { EvaluatorDefinition, EvaluatorResultRow, JudgeDefinition } from "./types";

/** Section A — the five checks as compact cards, each with its live pass count across stored traces. */
export function EvaluatorDefinitions({ deterministic, judge, rows }: {
  deterministic: EvaluatorDefinition[];
  judge: JudgeDefinition;
  rows: EvaluatorResultRow[];
}) {
  const mix = modeMix(rows);
  const checks = orderChecks(deterministic);
  const jt = tallyJudge(rows);
  return (
    <section id="definitions" className="scroll-mt-4 space-y-3">
      <SectionTitle
        title={`${checks.length + 1} checks`}
        infoLabel="About these checks"
        info={
          <>
            {checks.length} code checks re-run on every stored trace, plus 1 AI judge for the one question code can&apos;t
            answer. Each is a single yes/no question — no scores, no weights.
          </>
        }
        right={<ModeMix shown={rows.length} live={mix.live} mock={mix.mock} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {checks.map((d) => {
          const t = tallyEvaluator(rows, d.evaluator_id);
          return (
            <CheckCard
              key={d.evaluator_id}
              name={plainName(d.evaluator_id)}
              tag={<CheckTag kind={d.validation_status === "validated_unit_tests" ? "code-tested" : "code-experimental"} />}
              pass={t.pass}
              total={t.total}
              extras={[
                [t.fail, "fail", "text-rose-700"],
                [t.not_applicable, "n/a", "text-slate-500"],
                [t.error, "error", "text-violet-700"],
                [t.missing, "no result", "text-amber-700"],
              ]}
              info={<CodeCheckInfo d={d} />}
            />
          );
        })}
        <CheckCard
          judge
          name={plainName(judge.id)}
          tag={<CheckTag kind="judge" />}
          pass={jt.pass}
          total={jt.total}
          extras={[
            [jt.fail, "flagged", "text-rose-700"],
            [jt.requires_review, "unsure", "text-amber-700"],
            [jt.error, "error", "text-violet-700"],
            [jt.not_judged, "not judged", "text-slate-500"],
          ]}
          info={<JudgeInfo judge={judge} />}
        />
      </div>
    </section>
  );
}

function CheckCard({ name, tag, pass, total, extras, info, judge }: {
  name: string;
  tag: ReactNode;
  pass: number;
  total: number;
  extras: Array<[number, string, string]>;
  info: ReactNode;
  judge?: boolean;
}) {
  const shown = extras.filter(([n]) => n > 0);
  return (
    <div
      className={cx(
        "flex flex-col gap-2 rounded-lg border bg-white px-3 py-3 shadow-sm",
        judge ? "border-2 border-dashed border-violet-300 bg-violet-50/40" : "border-slate-200",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug text-slate-900">{name}</h3>
        <InfoTipLeft label={`How "${name}" works`}>{info}</InfoTipLeft>
      </div>
      <div>{tag}</div>
      <div className="mt-auto pt-1">
        {total === 0 ? (
          <div className="text-sm text-slate-500">No traces yet</div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums text-slate-900">
              {pass}
              <span className="text-base font-medium text-slate-400">/{total}</span>
            </span>
            <span className="text-sm text-slate-600">pass</span>
          </div>
        )}
        <div className="min-h-4 text-xs">
          {total > 0 &&
            (shown.length === 0 ? (
              <span className="text-slate-400">{judge ? "nothing flagged" : "no failures"}</span>
            ) : (
              shown.map(([n, label, cls], i) => (
                <span key={label}>
                  {i > 0 && <span className="text-slate-300"> · </span>}
                  <span className={cx("font-medium tabular-nums", cls)}>
                    {n} {label}
                  </span>
                </span>
              ))
            ))}
        </div>
      </div>
    </div>
  );
}

function CodeCheckInfo({ d }: { d: EvaluatorDefinition }) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] text-slate-500">
        {d.evaluator_id} · v{d.version}
      </p>
      <p className="font-medium text-slate-900">{d.question}</p>
      <p>
        <b className="text-emerald-700">PASS</b> {d.pass_rule}
      </p>
      <p>
        <b className="text-rose-700">FAIL</b> {d.fail_rule}
      </p>
      <p className="text-slate-500">
        N/A = nothing to compare · ERROR = no structured output. Severity {d.severity} ·{" "}
        {d.blocking ? "blocking (part of pass-all)" : "reported only"}.
        {d.validation_status === "validated_unit_tests" && (
          <>
            {" "}
            Unit-tested in <code className="font-mono">src/lib/evaluators/deterministic.test.ts</code>.
          </>
        )}
      </p>
    </div>
  );
}

function JudgeInfo({ judge }: { judge: JudgeDefinition }) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] text-slate-500">
        {judge.id} · {judge.prompt_version}
      </p>
      <p className="font-medium text-slate-900">{judge.question}</p>
      <p>
        <b className="text-rose-700">FAIL</b> a material claim isn&apos;t backed by the evidence ·{" "}
        <b className="text-emerald-700">PASS</b> every claim is backed · unsure → <b>REQUIRES REVIEW</b> (never PASS) · bad
        output → <b>ERROR</b>.
      </p>
      <p className="text-slate-500">
        Experimental: never used as gold truth and never a release gate on its own — a human checks every finding. It
        doesn&apos;t score helpfulness or pricing strategy.
      </p>
      <p className="font-mono text-[11px] text-slate-500">
        LIVE {judge.live_version}
        <br />
        MOCK {judge.mock_version}
      </p>
      <details className="rounded border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-medium text-slate-600">Judge prompt</summary>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-slate-200 px-2 py-1.5 text-[11px] leading-snug text-slate-800">
          {judge.system_prompt}
        </pre>
      </details>
    </div>
  );
}
