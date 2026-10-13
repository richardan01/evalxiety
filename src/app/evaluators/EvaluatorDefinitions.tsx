import { Badge, Callout, Card, KeyValue, SeverityBadge } from "@/components/ui";
import { ExperimentalBadge, SectionHeading } from "./parts";
import type { EvaluatorDefinition, JudgeDefinition } from "./types";

const JUDGE_FIELDS: Array<[string, string]> = [
  ["failure_detected", "true / false — the binary verdict: is at least one material claim unsupported by the supplied evidence?"],
  ["evidence_ids", "Evidence IDs the judge compared the claims against."],
  ["relevant_claims", "Quoted claims the judge found unsupported (or hardest to verify)."],
  ["explanation", "Short critique a new pricing analyst could follow, citing evidence IDs."],
  ["uncertainty_reason", "Set only when the judge genuinely cannot decide; otherwise null."],
];

export function EvaluatorDefinitions({ deterministic, judge }: { deterministic: EvaluatorDefinition[]; judge: JudgeDefinition }) {
  return (
    <section id="definitions" className="space-y-3 scroll-mt-4">
      <SectionHeading step={1} title="What we check — evaluator definitions" phase="Phase 5 · evaluator development">
        Each evaluator answers one narrow yes/no question about one failure mode found in human trace review. There is no
        score and no weighting. Four are deterministic code checks of objective policy rules; one is an experimental LLM
        judge for a semantic question code cannot answer.
      </SectionHeading>

      <div className="grid gap-3 lg:grid-cols-2">
        {deterministic.map((d) => (
          <Card
            key={d.evaluator_id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <code className="font-mono">{d.evaluator_id}</code>
                <span className="text-xs font-normal text-slate-500">v{d.version}</span>
              </span>
            }
            subtitle="Deterministic code check"
            actions={
              <>
                <SeverityBadge severity={d.severity} />
                {d.blocking && <Badge tone="slate">BLOCKING</Badge>}
              </>
            }
          >
            <KeyValue
              rows={[
                ["Question", <span key="q" className="font-medium">{d.question}</span>],
                ["PASS when", d.pass_rule],
                ["FAIL when", d.fail_rule],
                [
                  "Other outcomes",
                  <span key="o" className="text-slate-600">
                    Besides PASS / FAIL, a check may return NOT APPLICABLE when it has nothing to compare (e.g. no policy
                    available), or ERROR when the trace has no structured output.
                  </span>,
                ],
                ["Severity", <SeverityBadge key="s" severity={d.severity} />],
                [
                  "Blocking",
                  d.blocking ? (
                    <span key="b">
                      Yes — part of pass-all (every applicable blocking check must PASS)
                      {d.severity === "critical" ? "; a FAIL on the release candidate is a NO-SHIP reason." : "."}
                    </span>
                  ) : (
                    "No — reported only"
                  ),
                ],
                [
                  "Validated",
                  d.validation_status === "validated_unit_tests" ? (
                    <span key="v">
                      <Badge tone="green">Validated: unit tests</Badge>{" "}
                      <span className="text-slate-600">
                        (pass/fail/boundary cases in <code className="font-mono text-xs">src/lib/evaluators/deterministic.test.ts</code>)
                      </span>
                    </span>
                  ) : (
                    <ExperimentalBadge key="v" />
                  ),
                ],
                [
                  "Failure mode",
                  <span key="f">
                    <code className="font-mono text-xs">{d.failure_mode_id}</code>{" "}
                    <Badge tone="neutral" title="Seed taxonomy categories are hypotheses until human reviews observe them">
                      hypothesis until observed
                    </Badge>
                  </span>,
                ],
              ]}
            />
          </Card>
        ))}
      </div>

      <Card
        className="border-violet-300"
        title={
          <span className="flex flex-wrap items-center gap-2">
            LLM judge: <code className="font-mono">{judge.id}</code> <ExperimentalBadge />
          </span>
        }
        subtitle="One judge, one binary question. Its output is a finding for a human to check — never a verdict on its own."
      >
        <div className="space-y-3">
          <KeyValue
            rows={[
              ["Question", <span key="q" className="font-medium">{judge.question}</span>],
              [
                "Output (binary)",
                <ul key="f" className="space-y-1">
                  {JUDGE_FIELDS.map(([field, text]) => (
                    <li key={field}>
                      <code className="font-mono text-xs font-semibold">{field}</code> — <span className="text-slate-600">{text}</span>
                    </li>
                  ))}
                </ul>,
              ],
              [
                "Verdict mapping",
                <ul key="m" className="space-y-1">
                  <li>failure_detected = true → <Badge tone="red">FAIL</Badge></li>
                  <li>failure_detected = false → <Badge tone="green">PASS</Badge></li>
                  <li>
                    uncertainty_reason set (inconclusive) → <Badge tone="amber">REQUIRES REVIEW</Badge>{" "}
                    <b>never PASS</b>
                  </li>
                  <li>missing or invalid output → <Badge tone="purple">ERROR</Badge></li>
                </ul>,
              ],
              [
                "Judge version",
                <div key="v" className="space-y-0.5 text-xs">
                  <div>
                    <Badge tone="blue">LIVE</Badge> <code className="font-mono">{judge.live_version}</code>
                  </div>
                  <div>
                    <Badge tone="amber">MOCK</Badge> <code className="font-mono">{judge.mock_version}</code>
                  </div>
                  <div className="text-slate-500">
                    prompt version + model + hash of the prompt text. Any change produces a new version; results and
                    calibration from older versions no longer count.
                  </div>
                </div>,
              ],
              ["Status", <span key="s"><ExperimentalBadge /> <span className="text-slate-600">— no reliability threshold is set in this build.</span></span>],
            ]}
          />

          <Callout tone="slate" title="What this judge does not do">
            <ul className="list-disc space-y-0.5 pl-5">
              <li>It is <b>never used as gold truth</b>: judge outputs are stored as <code className="font-mono text-xs">llm_judge</code> results; gold labels come only from named human reviewers.</li>
              <li>It <b>does not score helpfulness, reasoning quality or pricing strategy</b> — only whether a material claim is unsupported by the supplied evidence.</li>
              <li>Arithmetic and policy-version selection are out of its scope (the deterministic checks above cover them).</li>
              <li>It uses no few-shot examples: the only labelled examples sit in the dev/held-out splits and would leak into calibration.</li>
              <li>It is not a release gate on its own: a FAIL, REQUIRES REVIEW or ERROR on a release candidate needs a human review.</li>
            </ul>
          </Callout>

          <details className="rounded border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium text-slate-600">
              Show the judge system prompt ({judge.prompt_version})
            </summary>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-800">
              {judge.system_prompt}
            </pre>
          </details>
        </div>
      </Card>
    </section>
  );
}
