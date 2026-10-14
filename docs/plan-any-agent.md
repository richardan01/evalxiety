# Plan: evaluate any agent, not just the pricing agent

Status: draft, 2026-10-14. Nothing here is built yet.

## Problem

Evalxiety can only evaluate the built-in pricing agent. Five layers are hardwired to pricing:

| Layer | Where | Pricing coupling |
|---|---|---|
| Agent runner | `src/lib/agent/runner.ts` | `runPricingAgent` is the only thing that creates a trace; `experiments/runner.ts` imports it directly |
| Trace shape | `src/lib/domain/schemas.ts` (`Trace`) | `input: MerchantScenario`, `parsed_structured_output: PricingRecommendation`, `policy_context`, `selected_policy_id` |
| Code checks | `src/lib/evaluators/deterministic.ts` | all 4 read margin, policy-date and approval fields; `metrics/experiments.ts#evaluateCase` calls them via `evaluateTrace` |
| AI judge | `src/lib/judge/judge.ts` | prompt and payload are about pricing claims |
| Cases | `src/lib/domain/scenarios.ts`, `policies.ts`, `experiments/frozen.ts` | frozen-set hash covers `SCENARIOS` + `POLICIES` |

Already generic, because they operate on `CaseEvaluation`, annotations or labels rather than the trace body:
release gate (`release/gate.ts`), run comparison (`metrics/experiments.ts#compareRuns`), calibration
(`metrics/calibration.ts`), taxonomy, rubric checklist, spend controls.

**The seam is `Trace` + `evaluateTrace`.** Everything downstream of `CaseEvaluation` can stay as it is.

## Three framings

**A. Trace import ("bring your traces").** The user's agent runs anywhere. They upload a JSONL file of
traces. Evalxiety runs review, coding, checks, judge and gate on them.
- For: no network calls into the user's system, no spend, works for any stack, smallest build.
- Against: no "re-run baseline vs corrected on frozen cases" inside Evalxiety; the user must run both
  versions themselves and import each as a run.

**B. HTTP adapter ("Evalxiety drives your agent").** The user registers an endpoint. Evalxiety POSTs each
frozen case and stores the response as a trace.
- For: the full experiment loop (frozen cases, paired comparison, held-out lock) works unchanged.
- Against: outbound calls to user URLs (SSRF surface, needs a host allowlist), unknown cost per call,
  timeouts and retries, and the user must stand up an endpoint.

**C. SDK / CLI wrapper ("instrument in place").** A small `evalxiety` package wraps the user's agent
call, records the trace, and pushes it to Evalxiety. A `evalxiety gate` CLI command exits non-zero on
NO SHIP for CI.
- For: lowest friction for developers, natural CI story.
- Against: a package to publish and version per language; still needs A's ingest endpoint underneath.

**Recommendation: build A first, then C's CLI gate on top of it, then B.** A is the ingest path every
other option needs, and it adds no new spend or egress risk. B is the most work and the most risk, so it
comes last.

## Generic trace contract (v1)

```jsonc
{
  "case_id": "Q17",                 // must exist in the imported case set
  "agent_version": "support-bot@v3",
  "input": { ... },                 // any JSON; shown verbatim in review
  "output": { ... } | "text",       // any JSON or text
  "evidence": [{ "id": "doc-4", "text": "..." }],   // optional; the judge checks claims against this
  "tool_calls": [{ "name": "...", "input": {}, "output": {} }],  // optional
  "model_id": "claude-sonnet-5-5",  // optional
  "latency_ms": 840, "cost_usd": 0.004,             // optional
  "timestamp": "2026-10-14T09:00:00Z"
}
```

Imported traces get `execution_mode: "imported"`. That is a new mode, neither live nor mock, so the
"mock is never evidence" rule still holds and the dashboard can label imported results honestly.

## Build steps (framing A)

1. **Agent profile.** New `src/lib/profiles/`: a profile bundles a case set, a check set, a judge
   criterion and a rubric checklist. Move today's pricing pieces into `profiles/pricing/` unchanged.
   Default profile = pricing, so existing data and screenshots keep working.
2. **Generic trace.** Make `Trace` a discriminated union on `profile`: `pricing` keeps today's
   schema exactly; `generic` uses the contract above. Existing `data/traces.json` parses as `pricing`
   with no migration.
3. **Check registry.** `evaluateTrace` looks up checks by profile. Generic checks shipped in v1:
   `output_parses` (against an optional JSON Schema), `cites_supplied_evidence` (every cited id exists
   in `evidence`), `no_tool_errors`. Users add their own as a TS function `(trace) => CheckResult`.
4. **Judge criterion per profile.** `buildJudgeSystemPrompt(criterion)` already takes the criterion;
   remove the pricing wording from the frame and pass the evidence generically. The judge version hash
   already covers the prompt, so calibration resets automatically per profile.
5. **Case set + frozen hash per profile.** `POST /api/cases` imports cases (id, input, split). The
   frozen hash covers the profile's cases plus its policy/config files, same pinned-hash rule.
6. **Import endpoint.** `POST /api/traces/import` (JSONL, Zod-validated per line, rejects unknown
   `case_id`, records an audit entry, groups the batch as an experiment run with a role of
   baseline or candidate). Held-out cases stay locked: importing a held-out trace before the audited
   reveal is refused with 423, same as today.
7. **UI.** Profile picker in the sidebar. `TraceView` renders `input`/`output`/`evidence` as
   collapsible JSON for generic traces. Fix panel guidance comes from the check definition instead of
   the hardcoded `GUIDE` map in `FixPanel.tsx`.
8. **MCP.** Add `profile` as an optional argument to the existing read-only tools. Ingest stays out of
   MCP, so the server remains GET-only.

## Tests

- Existing 36 test files pass unchanged (pricing profile is the default).
- Import: valid JSONL, a bad line rejected with its line number, unknown `case_id`, held-out before
  reveal → 423, duplicate import is idempotent.
- Gate on a generic profile: a forced FAIL produces NO SHIP (test the alarm by forcing it).
- Calibration resets when the judge criterion changes.

## Open decisions for Rich

1. Should a demo second profile ship with it (e.g. a 10-case customer-support agent) so the README can
   show "two different agents, one method"? Writing those cases and labels is human work.
2. Should user-written checks live in the repo (TS files, reviewed in PRs) or be configured in the UI?
   Repo is safer and simpler; UI is friendlier.
3. Keep "AgentTrust" in internal names, or rename to Evalxiety during the profile refactor?

## Size

Framing A, steps 1–8: roughly a day of focused work, mostly in steps 1–3. No API spend except an
optional judge calibration run on the demo profile, which would need approval like any paid batch.
