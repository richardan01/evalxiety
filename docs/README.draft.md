# AgentTrust

**Don't just build AI agents. Prove they're ready to ship.**

AgentTrust is an evaluation and release-readiness workbench for a Claude-powered **merchant pricing agent**. It follows
Hamel Husain & Shreya Shankar's product-specific eval methodology: start from real traces, let humans do error analysis,
turn observed failures into narrow binary evaluators, validate the one LLM judge against human labels, compare agent
changes on frozen cases, and make a release decision with auditable evidence.

> Scope: a one-day hackathon prototype on **synthetic** business data. Results describe a 20-case prototype test set.
> They cannot establish production reliability, and nothing here is a production certification.

## Quick start

```bash
npm install
cp .env.example .env.local        # MOCK_MODE=true by default — no API spend
npm run dev                       # http://localhost:3000
npm test                          # unit + integration tests (Vitest)
```

### Live mode (real Claude API calls)

Edit `.env.local`:

```
MOCK_MODE=false
ANTHROPIC_API_KEY=...             # your Claude API key (never commit it)
LIVE_SPEND_CAP_USD=10             # hard cap on estimated spend, enforced before every call
```

Restart the server after editing. Model: `claude-opus-5-5` (effort `medium`, structured JSON output, server-side refusal
fallback enabled — the model that actually answered is recorded per trace).

**Credit controls**

- Mock mode is the default; every mock artifact is labelled `MOCK` and is never release evidence.
- Live responses are cached on disk (`data/llm_cache/`) keyed by the full request: re-running a frozen case is free and
  the trace is labelled `CACHED RESPONSE`.
- Any live batch of more than one case requires explicit confirmation of an estimated cost.
- A spend ledger (`data/spend_ledger.json`) blocks calls beyond `LIVE_SPEND_CAP_USD`.
- Claude API credits do **not** cover Claude Code usage — they are billed separately.

Rough cost (Opus 5.5, $4/M input, $20/M output): ≈ $0.07 per agent call and ≈ $0.045 per judge call, so baseline +
corrected on all 20 cases with the judge is ≈ $4–5 before cache hits.

## The workflow (five tabs)

| Tab | What happens | Methodology step |
|---|---|---|
| **Overview** | executions, human-review coverage, pass-all, critical failures, release status, demo checklist | — |
| **Trace Review** | run a case; one-screen review card: 5-question rubric checklist (✓ ✗ ?), Pass/Fail, one line on what went wrong first; automated results hidden until you've saved, then shown as "you vs automated checks"; editable versioned **Rubric**; failure taxonomy; gold set (dev / held-out) | error analysis, open → axial coding, gold data |
| **Evaluators** | 4 deterministic binary checks + 1 experimental LLM judge; judge calibration (confusion matrix, TPR/TNR with Wilson intervals, disagreements); audited held-out reveal | evaluator development, judge validation |
| **Experiments** | baseline vs corrected on content-hashed frozen sets; paired case-level comparison: fixes, regressions, remaining failures, cost & latency | regression testing |
| **Release Gate** | NO SHIP / INSUFFICIENT EVIDENCE / ELIGIBLE FOR DEMO APPROVAL / APPROVED FOR DEMO, with blocking reasons, evidence checklist, limitations and a separate human approval bound to an evidence snapshot | release decision |

## The scenario

The agent receives a merchant's pricing request plus an evidence pack (merchant facts and policy sections, each with an
evidence ID) and returns a structured recommendation: price, selected policy, cost basis, unit economics, minimum
margin, discount vs list, required human approvals, decision, explanation, and claims with cited evidence IDs.

- **Policies** (`src/lib/domain/policies.ts`): three synthetic, effective-dated versions (2025.1, 2026.1, 2026.2) that
  differ in list rates, margin floors, discount-approval thresholds, high-volume thresholds, default cost bases and
  promotions.
- **Scenarios** (`src/lib/domain/scenarios.ts`): 20 cases varied on merchant size, processing volume, margin proximity to
  the floor, policy period (including the four boundary dates), exception/promotion status and source completeness.
  Every variation label is re-derived from the raw numbers in a unit test. Split: 12 dev / 8 held-out.
- **Configurations**: *Baseline* retrieves from a stale policy index (no 2026.2) with no effective-date rule. *Corrected*
  retrieves the policy effective on the decision date and requires the agent to verify the window. Everything else is
  identical.

## Evaluators

| Evaluator | Kind | Severity | Checks |
|---|---|---|---|
| `margin_calculation_error` | deterministic | major | stated revenue / cost / gross profit / margin match recomputation from source data at the agent's price (tolerance max($1, 0.1%) and 0.10 pp) |
| `stale_policy_used` | deterministic | critical | selected policy is the one effective on the decision date (from inclusive, to exclusive) |
| `missing_mandatory_approval` | deterministic | critical | every approval the effective policy mandates for the recommended price is routed |
| `margin_guardrail_violation` | deterministic | critical | true margin ≥ effective floor (after valid promotions), unless a strategic exception is routed to the CFO delegate |
| `unsupported_pricing_justification` | LLM judge (**experimental**) | major | does the explanation contain a material claim unsupported by the supplied evidence? Inconclusive → REQUIRES REVIEW |

Deterministic checks are validated by unit tests covering pass, fail and boundary cases. The judge is validated only
against human labels; its labels are never gold, and in this build it never decides a release on its own — every case
it flags needs a human review.

## Demo script (≈ 5 minutes)

1. **Execute a pricing case** — Trace Review → run `C04` with *Baseline*.
2. **Inspect the trace** — merchant request, recommendation, claims with cited evidence, evidence pack, raw prompts.
3. **Record a human failure annotation** — tick the checklist (✗ on "Right policy for the decision date?"), Fail, one line
   ("used policy 2026.1 although 2026.2 is effective"), severity. Automated results appear only after saving.
4. **Classify the observed failure** — Failure taxonomy → assign the note to *Wrong policy version* (it becomes OBSERVED).
5. **Run a targeted evaluator** — the saved trace shows `stale_policy_used: FAIL` with expected vs selected policy.
6. **Judge–human agreement** — Evaluators → calibration: confusion matrix, TPR/TNR (or "undefined"), disagreements,
   "Experimental — insufficient validation data."
7. **Correct the agent configuration** — Experiments → compare the Baseline and Corrected prompts/retrieval.
8. **Rerun the frozen test cases** — run both configs on `FROZEN-DEV-v1`, then the paired comparison (fixed cases,
   regressions, remaining failures, cost/latency).
9. **Release recommendation and limitations** — reveal held-out (audited), run `FROZEN-FULL-v1` for both configs, open the
   Release Gate.

## Testing

`npm test` runs Vitest suites for: effective policy selection, scenario variation integrity, the four deterministic
evaluators (pass/fail/boundaries), pass-all, confusion matrix, TPR/TNR (including undefined), Wilson intervals,
Rogan–Gladen, judge verdict mapping, taxonomy operations and observed frequencies, release eligibility and human
approval state, plus a mock-mode end-to-end integration test.

## Data

Everything is local JSON under `data/` (git-ignored): traces, annotations, taxonomy versions, gold set, judge results,
experiment runs, approvals, held-out state, audit log, LLM cache and spend ledger. Delete `data/` to reset.

More detail: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/methodology-notes.md`](methodology-notes.md).
