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

## Your agents (any agent, not just pricing)

`src/lib/agents/` runs the same method on any agent, next to the pricing demo and without touching its files. User
guide: [use-your-agent.md](use-your-agent.md).

```
agents/<id>/agent.json     name, code checks, optional judge question, optional HTTP connection (files the owner edits)
agents/<id>/cases.jsonl    test cases (dev / heldout split, optional expected value)
agents/custom-checks.ts    custom TypeScript checks, registered per agent id
agents/_template/          blank agent to copy (one universal check; run-my-agent.mjs writes an import file)
src/lib/agents/schemas.ts  Zod contract: config, cases, trace, import line, run, annotation, judge result
src/lib/agents/config.ts   load + validate agent folders (problems by file and line, never a crash)
src/lib/agents/checks.ts   built-in check types + custom-check runner (ERROR is never a pass)
src/lib/agents/ingest.ts   JSONL import parsing (shared by the import route and `npm run validate`)
src/lib/agents/http.ts     HTTP adapter: ${env:NAME} secrets, no redirects, size + time caps
src/lib/agents/runs.ts     import / HTTP runs, frozen case versions, batch confirmation, secret redaction
src/lib/agents/repo.ts     storage under data/agents/<id>/ (runs, traces, labels, judge results, approvals, reveals, audit)
src/lib/agents/judge.ts    experimental judge from agent.json (mock heuristic only for example data)
src/lib/agents/gate.ts     release gate with the agent's own checks and thresholds
src/lib/agents/services.ts read models for /api/agents/** (results recomputed from traces on every read)
src/lib/agents/api.ts      maps agent errors to HTTP responses (422/423 with line numbers, 409 confirmations)
src/lib/agents/registry.ts re-exports agents/custom-checks.ts
data/agents/<id>/          runs, traces, human labels, judge results, approvals, frozen versions, held-out state, audit log
```

Shared with the pricing demo: `summarizeRun` / `compareRuns` (now take the check list as a parameter),
calibration metrics, the storage primitives and the UI components.

| Rule | Where |
|---|---|
| Starter-kit traces are `data_origin: "example"`; like mock output they can't decide NO SHIP or make a candidate eligible | agents/gate.ts (`example_data`) |
| Real traces are judged only by the live judge; the mock heuristic is refused on them | agents/judge.ts |
| Runs pin a frozen case version (content hash); editing cases blocks runs until an audited new freeze | agents/runs.ts `currentFrozen` |
| One lock rule (`computeLockState`): a held-out case is locked until its content (input hash) is revealed; a dev case is locked too if its id or content was held out and never revealed, so moving, renaming or editing a held-out case can't unlock it. Locked cases can't be imported or run. A held-out case whose content was already traced before its reveal blocks the gate until it gets fresh input; deleting one is a warning | agents/ingest.ts, agents/runs.ts, agents/services.ts `heldoutIntegrity`, agents/gate.ts, `/api/agents/[agentId]/heldout` |
| An import is all-or-nothing, with every problem reported by line number | agents/ingest.ts, agents/runs.ts `importRun` |
| HTTP batches and live judge batches need explicit confirmation (with a cost estimate when known) | agents/runs.ts, agents/services.ts |
| The HTTP URL and headers come only from agent.json on disk; an agent can only read env vars named `EVALXIETY_AGENT_<AGENT_ID>_<SUFFIX>` (suffix letters and digits only, so no agent can read another's), secret values one line, ≥ 8 chars, no surrounding spaces; escaped echoes redacted too, never sent over plain http off-host; header values must be one line; secret values are redacted from everything stored; any run that sends a secret needs confirmation; redirects are refused | agents/http.ts, agents/runs.ts |
| An errored trace or an empty answer is ERROR on every check, never a pass (unless `allow_empty_output`); a present-but-empty field is ERROR; "must not" and length checks read the whole output when their field is missing; `cites_evidence` fails on a missing field; regex checks report ERROR on text over 100k chars and on a pattern over 250 ms (which then isn't re-run) | agents/checks.ts, agents/http.ts, agents/runs.ts |
| Check results are cached per (trace, check behaviour, case expectation) with LRU eviction, since traces never change after they are saved | agents/checks.ts `runChecks` |
| Default runs: the baseline is the version you ship (last approved label, else the first label); the candidate is the newest run of the most recently introduced other label; a lone label has no candidate; labels compared ignoring case and surrounding spaces; `scratch-…` labels and failed runs skipped | agents/services.ts `pickDefaults` |
| agent.json and cases.jsonl are strict: a misspelled key, a limitless `max_length`, or an unregistered custom check is a load error | agents/schemas.ts, agents/config.ts |
| Judge responses for your agents are cached under data/agents/<id>/llm_cache (git-ignored) and the shared ledger gets no trace ids; MCP returns agent output under `untrusted_agent_data` | agents/judge.ts, llm/client.ts `cacheDir`, mcp/server.mjs |
| Every candidate case needs a human review; the judge never exempts one, however many labels it has | agents/gate.ts |
| The API answers only to local Host names (DNS rebinding; `EVALXIETY_ALLOWED_HOSTS` adds more) and refuses cross-site writes, including `Origin: null` | src/proxy.ts |
| A baseline counts only if it completed with every compared case traced and error-free | agents/gate.ts |

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
| GET `/api/agents` | your agents + config problems | agents/services.agentsList |
| GET `/api/agents/[agentId]?candidate=&baseline=` | overview, runs, checks, gate (`baseline=none` for no baseline) | agents/services.agentOverview |
| POST `/api/agents/[agentId]/import` | import a JSONL run (`dry_run: true` = Check file) | agents/runs.importRun |
| POST `/api/agents/[agentId]/run` | HTTP run, finished in the background (`confirm_batch`) | agents/runs.prepareHttpRun / executeHttpRun |
| GET `/api/agents/[agentId]/runs/[runId]` | run detail | agents/services.agentRunDetail |
| GET `/api/agents/[agentId]/traces/[traceId]` | trace, checks, judge, labels, review queue | agents/services.agentTraceDetail |
| POST `/api/agents/[agentId]/annotations` | human label | agents/repo.upsertAgentAnnotation |
| POST `/api/agents/[agentId]/judge` | judge a run (`confirm` for a live batch) | agents/services.judgeRunMissing |
| POST `/api/agents/[agentId]/freeze` | freeze the current cases as a new version | agents/runs.freezeNewVersion |
| POST `/api/agents/[agentId]/heldout` | audited reveal of exactly the listed locked cases | agents/repo.revealAgentHeldout |
| POST `/api/agents/[agentId]/approve` | named approval of this evidence | agents/services.recordAgentApproval |
| GET `/api/agents/[agentId]/audit` | per-agent audit log | agents/repo.listAgentAudit |

## UI conventions

- Client components fetch from `/api/*` (`src/lib/client/api.ts`); pages are thin server components.
- Next.js 16: `params` is a Promise — use `PageProps<"/route/[x]">` / `RouteContext<"/api/route/[x]">` and `await`.
  Cache Components is disabled in `next.config.ts`; every GET handler calls `await connection()`.
- Use `src/components/ui.tsx` primitives. Always show `MockBadge` next to any result derived from a trace/judge, and
  render ratios with `Ratio` (undefined ≠ 0%).
- Reviewer identity comes from `getReviewer()`/`setReviewer()` (localStorage); mutations require a non-empty name.
