# AgentTrust architecture

AgentTrust evaluates a Claude-powered merchant-pricing agent and decides whether it is ready for a
**demo** release. Methodology: Hamel Husain & Shreya Shankar's product-specific evals (see
`docs/methodology-notes.md`).

## Layers

```
src/lib/domain      Zod contract (schemas.ts), synthetic policies, 20 synthetic scenarios + split, ground-truth economics
src/lib/agent       pricing agent: configs (baseline / corrected), evidence pack, prompts, runner, mock agent
src/lib/llm         Claude API client: live/mock mode, response cache, spend ledger + cap
src/lib/evaluators  4 deterministic binary evaluators (validated by unit tests)
src/lib/judge       1 experimental LLM judge: unsupported_pricing_justification
src/lib/metrics     calibration (confusion matrix, TPR/TNR, Wilson CI), run summary + paired comparison
src/lib/experiments frozen sets (content-hashed), experiment runner (held-out lock, paid-batch confirmation)
src/lib/release     release gate (pure)
src/lib/taxonomy    seed hypotheses + axial-coding ops + observed frequencies (human labels only)
src/lib/rubric      versioned rubric: review checklist + editable judge criterion (judge prompt is built from it)
src/lib/storage     local JSON store (data/), typed repos, audit log
src/lib/services    read models combining storage + pure logic — API routes call these
src/app/api/**      route handlers (thin: validate with Zod, call services/repos, return JSON)
src/app/**          five tabs (Overview, Trace Review, Evaluators, Experiments, Release Gate)
src/components      shared UI primitives (ui.tsx), TraceView, AppHeader
```

## Non-negotiable rules (enforced in code)

| Rule | Where |
|---|---|
| Mock output is always labelled (`execution_mode: "mock"`, `[MOCK OUTPUT]`, MOCK badge) and never counts as release evidence | runner.ts, gate.ts (`mock_results`), `MockBadge` |
| Live calls only when `MOCK_MODE=false` **and** a key is set; spend cap enforced before every call | llm/client.ts |
| Live multi-case batches need explicit `confirm_paid_batch` with a cost estimate | experiments/runner.ts |
| Held-out cases cannot run, and held-out calibration cannot be viewed, before an audited reveal | runner.ts, services `calibrationView` |
| Annotations are `label_source: "human"` with a named reviewer; judge results are `label_source: "llm_judge"` and never gold | schemas.ts, repos.ts |
| Gold examples come only from human annotations on frozen synthetic cases and carry provenance | services `promoteToGold` |
| Failure-mode frequencies come only from human annotations; seed categories are hypotheses | taxonomy/ops.ts |
| TPR/TNR with zero denominators are `null` → render "undefined", never 0% / 100% | metrics/calibration.ts, `Ratio` |
| Judge `REQUIRES_REVIEW`/`ERROR` are excluded from the confusion matrix, never treated as PASS | calibration.ts |
| Pass-all uses only validated deterministic checks; no weighted score; judge reported separately | metrics/experiments.ts |
| Comparisons require identical frozen-set hashes | experiments.ts, services `compareRunIds` |
| Approval is separate from evaluation and is invalidated when the evidence snapshot changes | release/gate.ts |

## Rubric (where "good" is defined)

Three layers, one place to look (Trace Review → Rubric):

1. **Review checklist** — 5 short questions answered on every trace (✓ / ✗ / ?). Each ✗ tags a failure mode; the first ✗ in
   pipeline order is the first failure. The judge-linked question is the human reference label for judge calibration.
2. **Judge criterion** — editable definitions/examples. The judge prompt is built from it and the judge version hashes the
   prompt, so an edit automatically starts a new judge version (old results and calibration stop counting).
3. **Policy rules** — objective thresholds in `src/lib/domain/policies.ts`, checked by code; part of the frozen-set hash.

Review target for this demo: 5–10 human-reviewed traces (`src/lib/domain/review.ts`).

## Release statuses

`NO_SHIP` > `INSUFFICIENT_EVIDENCE` > `ELIGIBLE_FOR_DEMO_APPROVAL` → `APPROVED_FOR_DEMO` (only with a named human
approval on the current evidence snapshot). Never "production certified".

## API surface

| Method & path | Purpose | Service |
|---|---|---|
| GET `/api/mode` | live/mock mode, model, spend ledger | llm/client |
| GET `/api/scenarios` | scenarios (+split), policies, agent configs | domain |
| POST `/api/run` | execute ONE case | agent/runner |
| GET `/api/traces`, `/api/traces/[id]` | traces | repos |
| GET `/api/review/queue` | traces + annotation status + split | services.reviewQueue |
| GET `/api/traces/[id]/evaluations` | deterministic + judge results for a trace | services.traceEvaluations |
| GET/POST `/api/annotations` | list / upsert a human annotation | repos.upsertAnnotation |
| GET/POST `/api/taxonomy` | taxonomy view / apply an op (creates a new version) | services.taxonomyView, taxonomy/ops |
| GET/POST `/api/gold` | gold list / promote an annotation | services.promoteToGold |
| POST `/api/judge` | judge ONE trace | judge.runJudge |
| GET `/api/evaluators` | evaluator definitions + results across traces | evaluators |
| GET `/api/calibration?split=dev&mode=live` | judge calibration | services.calibrationView |
| GET/POST `/api/heldout` | held-out state / audited reveal | repos |
| GET/POST `/api/experiments` | list runs / start a run (paid-batch confirmation) | experiments/runner |
| GET `/api/experiments/[id]` | run detail + summary | services.runDetail |
| GET `/api/experiments/compare?baseline=&candidate=` | paired comparison | services.compareRunIds |
| POST `/api/experiments/[id]/judge` | judge traces missing a current-version result | runner.judgeMissing |
| GET `/api/release` | release gate | services.releaseView |
| POST `/api/release/approve` | record a human approval/rejection | gate.canApprove |
| GET `/api/overview` | overview stats | services.overviewView |
| GET/POST `/api/rubric` | current rubric, history, judge prompt + version / save a new rubric version | repos.appendRubricVersion |
| GET `/api/audit` | audit log | repos.listAudit |

## UI conventions

- Client components fetch from `/api/*` (`src/lib/client/api.ts`); pages are thin server components.
- Next.js 16: `params` is a Promise — use `PageProps<"/route/[x]">` / `RouteContext<"/api/route/[x]">` and `await`.
  Cache Components is disabled in `next.config.ts`; every GET handler calls `await connection()`.
- Use `src/components/ui.tsx` primitives. Always show `MockBadge` next to any result derived from a trace/judge, and
  render ratios with `Ratio` (undefined ≠ 0%).
- Reviewer identity comes from `getReviewer()`/`setReviewer()` (localStorage); mutations require a non-empty name.
