# AgentTrust hackathon audit — 13 October 2026

## Verdict and evidence boundary

**NO SHIP for the complete claimed hackathon workflow today.** The existing application is substantial and worth preserving. It can support a narrower demo showing why evaluation blocks a release, but a timed, browser-verified three-minute demo remains unverified.

This is an audit, not a rebuild. No implementation files, human labels, gold data, prompts, approvals, or paid calls were changed by the auditor. Service and HTTP verification used a disposable copy of the data with Claude calls disabled. This report is the only intentional project addition.

The workspace changed during the audit through another session. Tests describe the source checked after resume. Saved-output analysis describes the final copied snapshot, not a continuously refreshed dashboard. The snapshot contains 76 traces (75 live, one mock; 45 cached replays), three named human annotations, no promoted gold, and two running full-set experiments. The held-out reveal record is dated 13 October at 16:56 Singapore time. These full-set calls were not initiated by this audit.

## Verification

| Check | Result |
|---|---|
| Existing tests | 246 passed across 34 files; no failing tests |
| Lint | Passed without warnings in the resumed check |
| Type check | Passed |
| Default production build | Failed in Turbopack CSS compilation: local port binding denied (`Operation not permitted`). Retrying outside the default sandbox produced the same error. Treat as an environment/compiler limitation, not a proven source defect. |
| Alternative production build | `npm run build -- --webpack` passed |
| Built application routes | Overview, Start Here, Review, Evaluators, Experiments, Release: HTTP 200 |
| Built read-only APIs | Overview, calibration, release, paired experiment comparison: HTTP 200; JSON outputs inspected |
| Browser visual/interaction check | In-app browser attachment timed out; native browser inspection stalled and was interrupted. Screenshots, responsive layout, keyboard flows and timed demo are unverified. HTTP 200 does not prove client interactions work. |

## Verified implementation progress

| Area | Status | Evidence and practical boundary |
|---|---|---|
| Architecture and Claude integration | Implemented, with limitations | Next.js UI/API routes, Zod contracts, service layer, local JSON repositories, SDK structured output, live/mock modes, response cache, spend reservations, requested/served model capture. Local locks coordinate one process only. |
| Agent execution and trace capture | Implemented | Saved raw and parsed responses, prompts, evidence IDs, policy context, timing, tokens, costs and errors. This pricing agent is a single structured call; it makes no tool calls. It is not yet a general multi-step agent evaluation platform. |
| Human error analysis and taxonomy | Partially implemented in use | Named reviews, first-failure notes, severity, quick rubric and advanced review, versioned taxonomy operations and human-only observed counts exist. Three labels are saved; broad error discovery and category saturation have not been demonstrated. Seed categories remain hypotheses unless observed. |
| Gold, provenance and splits | Partially implemented | Promotion requires a named human annotation on a synthetic split case; reviewer, timestamp, label version and source are retained. Twelve dev/eight held-out cases are defined. No gold has been promoted. The current judge uses no few-shots, so a missing training split is not itself current example leakage. |
| Deterministic checks and Claude judge | Implemented | Four binary policy/economics checks plus one narrow experimental unsupported-justification judge. Judge explanations and uncertainties are retained. Judge PASS is not a verdict on every policy check. |
| TPR/TNR calibration | Implemented calculation; missing validation evidence | Confusion matrix, failure-positive TPR/TNR, Wilson intervals, undefined denominators, abstention/error exclusion and current judge-version selection exist. Zero paired gold labels means both TPR and TNR are undefined. |
| Evaluation Integrity Checker | Partially implemented; complete feature missing | Policy/case hashes are pinned; held-out execution is locked centrally; stale runs are rejected for comparison; mock evidence is excluded; labels and judgments are separated. There is no consolidated checker/report covering label freshness, criterion compatibility, duplicate replay evidence and served-model consistency. |
| Baseline/corrected regression testing | Implemented; corrected agent still fails | Current valid dev pair improves six cases but introduces C13 critical approval regression. Old runs with obsolete hashes remain visible and are correctly marked noncomparable. |
| Release and human approval | Implemented; evidence incomplete | Server recomputes eligibility; full-set evidence, human review, critical checks, snapshot-bound approval and stale decisions are handled. Default snapshot status is INSUFFICIENT_EVIDENCE because completed full runs and review coverage are missing. No approval exists. |
| UI and three-minute demo | Partially verified | Sidebar, dashboard, compact trace card, rubric, calibration, comparisons, release reasons, guide and Start Here exist. Pages compile and serve; visual quality and interaction completion were not verified. The nine-step learning path needs a rehearsed three-minute presentation path. |

## Actual experiment outputs

The completed comparable development runs are:

- Baseline `run_54dba1b941be`: 6/12 pass every deterministic check.
- Corrected `run_4d98830a6f6a`: 11/12 pass every deterministic check.
- Fixed cases: C01, C02, C03, C04, C05, C09.
- Regressed case: C13. The corrected agent recommends a compliant counter-offer and routes regional pricing manager/deal desk approval, but omits `cfo_delegate` required for the strategic exception. The deterministic approval check correctly fails it as critical.

The full-set runs were still running in the copied snapshot. Corrected already has mandatory-approval failures on C07 and C13. Do not interpret the incomplete run's pass fraction as a final performance result. A judge PASS on those cases is not automatically a judge error: this judge evaluates unsupported justification, not whether every mandatory approver is present.

Cached replays are useful for demonstration and regression checks, but they are not independent fresh model trials. Seventy-five live-tagged traces, including cached responses, do not establish seventy-five independent fresh executions.

## Gaps ordered by priority

### P0

No confirmed catastrophic P0 implementation defect was found. The default build failure is an unresolved runtime-environment limitation. Do not promote it to an application P0 without reproducing it in the intended demo environment.

### P1 — complete before claiming end-to-end readiness

1. **Corrected agent has confirmed critical regressions.** Fix strategic-exception approval handling from the observed C13/C07 failures, preserving the current runs as evidence. Add a targeted regression check, then verify the changed agent on approved, bounded calls. Do not erase or relabel the failure to obtain a green gate.
2. **Human evidence and judge calibration are not populated.** Richard owns labels. Review diverse existing dev traces, assess the judge's exact criterion, resolve disagreements, and promote reviewed examples to gold. Demonstrate a small confusion matrix honestly; collecting a reliable held-out validation corpus is larger than a one-day task. Keep the judge experimental.
3. **Gold freshness is not enforced in calibration.** `calibrationView` selects gold by split/mode and current judge results, but does not compare the gold review timestamp with the latest annotation. The UI can offer re-promotion after a label edit while calibration still consumes the old gold label. Gold also omits the labeling rubric/criterion version, so changing what the judge means does not force human relabeling. Add stale/incompatible-label exclusion with explicit reasons, retaining history.
4. **Held-out independence now needs a decision.** The held-out set has been revealed and is being evaluated. Changing prompts using those findings makes it development evidence. After correcting the agent, use a new untouched held-out set for an independent final assessment; preserve the old set and reveal record.
5. **Integrity is not inspectable as one report.** Add a compact preflight/read-only integrity summary: frozen hashes, split status, trace/run linkage, label source/freshness/criterion, replay counts, actual served models, evaluator/judge versions, incomplete runs and unresolved reviews. Return pass/block/warning with linked evidence, and make release consume relevant blocking failures.
6. **Three-minute UI demo remains unverified.** Rehearse on the target machine with saved results and a small honest label set. Verify save-and-next, promotion, calibration refresh, comparison and blocked approval. The auditor could not confirm those browser interactions.

### P2 — valuable, bounded improvements

- Pin the complete agent configuration (including effort and prompt/retrieval content hashes) in each run. Current case/policy hashes do not alone guarantee the same agent implementation under a reused config ID.
- Separate fresh executions from cached replays in review sampling and sample-size claims; do not inflate calibration n with repeated identical outputs.
- Track actual served judge models in calibration compatibility. `judgeVersion` hashes the requested model, while fallback responses record a possibly different served model. Do not silently pool unlike judge models as one validated judge.
- Settle spend using the actual served model's pricing and reconcile fallback usage. Reservations were improved, but settlement still calls the fixed requested-model cost function. None of the inspected earlier outputs demonstrated a fallback, so this is a code-path risk rather than an observed billing overrun.
- Preserve free-form error discovery. The quick checklist is useful for known compliance checks, but checklist order should not substitute for observing which failure happened first or discovering new failure categories.
- Make the working README a concise setup/demo guide; the detailed project README remains under `docs/README.draft.md`.

## Reuse from richardan01/AI-Product-Lab

Compared the public repository at commit `41518c2c712010bde8468c102f7f82b50d556c4a` by reading its actual code and protocols. Nothing was imported or executed from that repository.

| Component | Reuse recommendation |
|---|---|
| `scripts/preflight_agent_eval.py` | Reuse the fail-before-grading pattern and explicit blocked reasons. Adapt to pricing traces: its requirement for tool calls would reject this valid single-call agent. |
| `scripts/trace_adapter.py` | Useful for a future Claude Code/Codex trace-import feature, not necessary for the pricing demo. It maps trajectory records and reports unknown skips; keep those coverage diagnostics. |
| `scripts/validate_agent_report.py` | Reuse report contract validation and recomputed verdict/count consistency in the Integrity Checker. Replace its seven harness axes and severity vocabulary with AgentTrust's own contract. |
| `evals/regeval/score.py` | Reuse inspectable per-item diagnostics, coverage reporting, seeded confidence intervals and durable experiment records. Keep AgentTrust's TPR/TNR-first calibration. RegEval uses compliant as the positive class; AgentTrust uses failure, so names cannot be copied without remapping. Do not copy kappa keep thresholds as release criteria. |
| `evals/agent-harness/protocol.md` and RegEval failure taxonomy | Reuse explicit insufficient evidence, untrusted-trace boundaries, preserved corrections and contamination handling. This is workflow reuse, not a replacement of the existing app. |

Public sources: [AI-Product-Lab](https://github.com/richardan01/AI-Product-Lab/tree/41518c2c712010bde8468c102f7f82b50d556c4a), [preflight](https://github.com/richardan01/AI-Product-Lab/blob/41518c2c712010bde8468c102f7f82b50d556c4a/scripts/preflight_agent_eval.py), [report validator](https://github.com/richardan01/AI-Product-Lab/blob/41518c2c712010bde8468c102f7f82b50d556c4a/scripts/validate_agent_report.py), [scorer](https://github.com/richardan01/AI-Product-Lab/blob/41518c2c712010bde8468c102f7f82b50d556c4a/evals/regeval/score.py).

## One-day hackathon scope

An eight-hour plan, estimated rather than guaranteed:

1. **1 hour — establish the demo path.** Confirm the target runtime and choose saved baseline/corrected traces; retain the failing C13 example as the reason the gate should block.
2. **2 hours — human review and gold.** Richard reviews 5–10 diverse dev outputs, including supported/unsupported justification examples if genuinely present. Promote labels, inspect disagreements. Do not manufacture human labels or claim this validates the judge.
3. **2 hours — integrity fixes.** Implement label freshness/criterion compatibility checks and a compact integrity report. Test stale label, changed criterion, incomplete run and replay cases.
4. **1 hour — targeted agent correction.** Fix the observed strategic-exception approval omission. Any paid verification requires an approved bounded scope. Because the held-out set was revealed, do not call a post-fix result on that same set independent validation.
5. **1 hour — demo preparation.** Add explicit limitations and saved-result navigation; verify interactions and local startup.
6. **1 hour — timed rehearsal and buffer.** Show one trace, a human label, gold/calibration, a paired comparison with the regression, and a blocked release. Aim for: 0:00–0:25 problem; 0:25–1:05 trace/review; 1:05–1:35 judge calibration; 1:35–2:20 comparison; 2:20–3:00 integrity and release decision.

Leave broad trace import, multi-agent support, production deployment, a statistically reliable judge-validation corpus and full autonomous research loops outside this one-day scope.

## Methodology alignment and final decision

The application already matches important Hamel/Shreya principles: product-specific failure checks, human reference labels, binary criteria, separate discovery/taxonomy, judge validation by TPR/TNR, held-out discipline and inspectable comparisons. The main remaining weakness is populated, compatible evidence rather than missing screens. [Hamel Husain and Shreya Shankar's Evals FAQ](https://hamel.dev/blog/posts/evals-faq/), [LLM judge guide](https://hamel.dev/blog/posts/llm-judge/).

Anthropic distinguishes narrow grader results from complete task outcomes; this pricing workbench demonstrates policy/economics evaluation, not comprehensive AI PM or production-agent quality. [Anthropic agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

**Final readiness: NO SHIP for the full claimed workflow and for approval of the corrected pricing agent.** The corrected agent has a confirmed critical failure; gold/calibration evidence and timed UI verification are incomplete. A narrower hackathon presentation of the functioning evaluation workbench can become shippable within one day, including an honest NO SHIP result for the pricing agent.
