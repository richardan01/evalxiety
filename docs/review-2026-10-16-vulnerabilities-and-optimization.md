# Evalxiety: vulnerabilities and optimisation review (2026-10-16)

Read-only review of the worktree at commit `15c26e0`. Nothing was modified. Every finding below was confirmed
by reading the cited lines or running the cited command; anything that could not be confirmed is in the
"Unverified" section at the end.

## Baseline

| Check | Result |
|---|---|
| `npm test` | 36 files, 257 tests pass (vitest 5.0.4) |
| `npm run lint` | clean |
| `npm run typecheck` on a fresh clone | **8 errors** (`RouteContext`, `PageProps`, `LayoutProps` not found) |
| `npm run typecheck` after `npx next typegen` | clean |
| `npm audit` | 5 high, all one dev-only chain (`eslint-config-next → fast-glob → micromatch → braces`) |
| `npm audit --omit=dev` | 0 |

Threat model: a single-operator local tool on 127.0.0.1:3123. What matters is (a) third-party pages in the
same browser, (b) an LLM driving the MCP server, (c) LLM output flowing back into prompts and UI, and
(d) the git repo, since `data/` is tracked.

## Security

No critical or high findings. One medium, six low.

### S1. Medium: CSRF guard defeated by DNS rebinding; Host header never checked

`src/proxy.ts:10-18`. The guard compares the `Origin` host to the `Host` header. Under DNS rebinding both
are attacker-controlled and equal, and the browser sends `Sec-Fetch-Site: same-origin`, so every clause
passes. GET requests skip the guard entirely (line 10). Next's own dev-origin blocking only covers `/_next`
and `/__nextjs` (`node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js:64-74`), so `/api/*`
relies entirely on this file.

Impact while the dev server is up: a remote page can trigger the irreversible held-out reveal, start live
batches up to the spend cap, record a release approval, rewrite rubric or taxonomy, and read every trace,
annotation and the audit log. The API key is not reachable.

Also: `new URL(origin)` throws on a malformed or `null` Origin (verified in Node 24), turning the guard
into a 500. There is no `proxy.test.ts`.

Fix: allowlist `Host` for all methods before anything else (`127.0.0.1:<port>`, `localhost:<port>`,
`[::1]:<port>`), wrap the `Origin` parse in a try, and add a unit test. Optionally require a custom header
from the client's `postJSON` so any cross-origin caller is forced into a preflight.

### S2. Low: no anti-framing or security headers

`next.config.ts` has no `headers()` and `proxy.ts` sets none. Approve (`ApprovalPanel.tsx:118-123`), gold
removal and rubric save are one or two clicks and clickjackable. Add `X-Frame-Options: DENY`,
`Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`.

### S3. Low: `/api/run` allows unattributed live spend

`src/app/api/run/route.ts:18,49`: `actor` is optional and defaults to `"anonymous"`. Every other spending
route requires a named actor. `data/audit_log.jsonl` already contains 2 anonymous events, both
`execution_mode: "live"`. Make `actor` required and have the Review run panel send the stored reviewer.

### S4. Low: 500 responses echo raw internal errors

`src/lib/api/http.ts:20-21` returns `err.message` verbatim: filesystem paths, JSON parse errors, SDK text.
Return a generic message with a short id and log the detail server-side.

### S5. Low: unbounded request bodies and free-text fields

No `content-length` cap anywhere. No `.max()` on `open_coding_notes`, `description`, `reviewer`
(`annotations/route.ts:21-25`), taxonomy `name`/`definition` (`taxonomy/route.ts:36-38`), rubric
`author`/`change_note` (`rubric/route.ts:50-51`), or any `MerchantScenario` text field
(`schemas.ts:101-130`). Only the guide route bounds input. Multi-megabyte notes land in
`annotations.json` and are re-parsed on every request. Add `.max()` limits and reject bodies over
256 KiB in the proxy.

### S6. Low: the held-out reveal is only irreversible inside the app

State lives in git-tracked `data/heldout_state.json` (`repos.ts:240-257`); a checkout, merge or a different
`AGENTTRUST_DATA_DIR` resets it with no audit entry. The content-hash copy detector
(`heldout-lock.ts:15-21`) is defeated by changing any one field of a copied scenario. `GET /api/scenarios`
(`scenarios/route.ts:11`) serves held-out scenario content before the reveal. Reconcile
`getHeldoutState()` against the audit log, exclude held-out cases from `/api/scenarios` until revealed, and
soften the README and UI wording to "audited and not reversible from the UI".

### S7. Low: ledger under-records server-side fallback responses

`src/lib/llm/client.ts:258-259` prices usage at the requested model, but `fallbacks: "default"` is enabled
(line 242) and a fallback answer is billed at `FALLBACK_PRICE` (line 71), about 20 to 25 % higher. The
reservation is correct; only the settled figure drifts low. Price by `response.model`.

### Security: confirmed good

- Path traversal: ids whitelisted with `^[A-Za-z0-9_-]+$` (`repos.ts:37,201`); all write paths use
  server-generated ids or a sha256 key; the MCP server re-validates `trace_id` (`mcp/server.mjs:322`).
- API key only read by the SDK constructor; never logged, returned or written to `data/`. Grep of `data/`,
  `docs/`, `public/`, README for key patterns and emails found nothing. No `.env.local` is tracked.
- Mode and cap come only from `process.env`; cap parsing fails closed; `force_mock` can only downgrade.
- Spend cap: reserve worst case under a per-file lock, settle after, with a 10-way concurrency test.
- Held-out lock sits at the single execution choke point; reveal is idempotent under lock and audited once.
- Release approval recomputed server-side and bound to an evidence snapshot hash.
- No `dangerouslySetInnerHTML`, `innerHTML` or `eval` in `src/`; Markdown renders React text nodes.
- MCP server is genuinely read-only: single GET helper with a path regex allowlist, no write tools.
- Every stored object passes through a Zod `z.object`, so no prototype-pollution vector.
- The SDK (0.133.0) does accept `role: "system"` inside `messages` (`messages.d.ts:4520`), so the guide
  route's message construction is valid.

## Performance and correctness

### P1. High: no caching or indexing; `/api/overview` does about 500 file opens per request

`src/lib/services/index.ts:569-623` (`overviewView`) and its callees re-read every trace file, re-parse
`judge_results.json` (420 KB) six times, list runs five times and read the rubric seven times. With the
current data that is roughly 506 fs opens and 444 `Trace.parse` calls (about 10 MB of JSON) per request.
`GuideAgent.tsx:80-96` is mounted in the root layout and calls `/api/overview` on every client navigation,
even with the panel closed, so landing on `/` computes it twice. `/api/experiments` does about 111 opens
and is polled every 3 s while a run is active (`ExperimentsHome.tsx:65-69`). `/api/review/queue` does
about 101 opens and is fetched on every trace open and after every save.

Fix, in payoff order: (1) request-scoped memo via React `cache()` around `listTraces`, `listJudgeResults`,
`listExperimentRuns`, `latestRubric`, `listAnnotations`; (2) an in-process `Map<trace_id, Trace>` index
updated in `saveTrace`, since this process is the only writer; (3) only fetch overview in `GuideAgent` when
open; (4) pass `runs` and `rubric` into `recoverOrphanedRuns` and `caseEvaluationsForRun` instead of
re-listing.

### P2. High: `pool()` keeps spending after a run is marked failed

`src/lib/experiments/runner.ts:89-98,167-192`. `Promise.all` rejects on the first worker failure and the run
is patched to `failed`, but the other two workers keep draining the queue, making live agent and judge
calls and appending `trace_ids` to a failed run. Not covered by tests. Add a shared stop flag checked at
the top of the worker loop, or use `allSettled` and decide status from the aggregate. Add a test that
throws on item 2 and asserts later items never run.

### P3. Medium: a torn line in `audit_log.jsonl` kills `/api/audit`

`store.ts:51-68`. `appendFile` is not crash-atomic and `readLines` throws on the first bad line, so the
Release page's audit panel dies until the file is hand-edited. Skip or count unparsable lines instead of
throwing; optionally serialise `appendLine` through `withLock`.

### P4. Medium: dashboard "Still passing" bar counts incomplete cases as passing

`OverviewDashboard.tsx:197` derives the bar by subtraction because `trendView` returns four of
`compareRuns`'s five categories (`services/index.ts:512-515`, `metrics/experiments.ts:157`). Execution
errors show as "still passing". Return `still_passing` and `incomplete` and render a fifth bar.

### P5. Medium: spend reservation uses Opus prices for every model

`client.ts:108-113,225`. `worstCaseCostUsd` ignores `req.model`, so Haiku or Sonnet judge calls reserve
about $0.80 each. Three concurrent workers hold about $2.50; a 20-case live run can start hitting
`SpendCapError` around $7.50 recorded spend on a $10 cap, and because of P2 that failure is not clean.
Pass the model through and only add the fallback term when the model supports fallback.

### P6. Medium: repeated hashing in hot loops

- `runner.ts:221-226` recomputes a sha256 of the full judge prompt inside an O(traces × results) filter.
  Compute the two versions once and index results by `trace_id`.
- `frozen.ts:25-30,52-66` re-hashes all scenarios and policies on every `verifyFrozenSet` call, which runs
  per run per request. Inputs are compile-time constants; memoise at module load.

### P7. Low: correctness nits

- `gate.ts:183-195`: a stale-policy failure is reported twice (as critical and as stale), so the verdict says
  "2 blocking failures" for one defect.
- `gate.ts:242-251,302`: the pass-all checklist row renders from `rate` even when the run is incomplete,
  so it can show red or green with no matching reason. Render "pending" when incomplete.
- `metrics/experiments.ts:204-205`: `NOT_APPLICABLE → FAIL` is classed as unchanged, never a regression.
- `economics.ts:58-69,120`: zero-volume custom scenarios produce `NaN` discount, which makes
  `requiredApprovals` silently require nothing. Require positive volume or return `null`.
- `pairing.ts:11-18`: unknown set id gets the "older content, re-run" message.
- `repos.ts:43`: unbounded `Promise.all` over all trace files will hit the macOS 256 fd default near 250
  traces.
- `repos.ts:46,210`: sorts by timestamp only; same-millisecond traces fall back to readdir order.
- `GuideAgent.tsx:64`: `JSON.parse(sessionStorage)` with no shape guard; a corrupt entry breaks render.
- `ui.tsx:203-211`: `Ratio` guards `null` but not `NaN`/`Infinity`.

## Maintainability

- `npm run typecheck` fails on a fresh clone or CI because the Next globals live only in generated
  `.next/types`. Change the script to `next typegen && tsc --noEmit -p .`.
- Three identical reviewer-identity hooks (`release/useApprover.ts`, `experiments/reviewer.ts`,
  `review/_queue/useReviewer.ts`). Keep one under `src/lib/client/`.
- Two client fetch wrappers (`lib/client/api.ts`, `experiments/request.ts`) plus raw `fetch` in
  `GuideAgent`, `Sidebar`, `HeldoutReveal`. Make `apiRequest` the single primitive.
- `mapRunError` is copy-pasted in `api/experiments/route.ts:72-77` and `api/experiments/[id]/judge/route.ts:12-17`.
- `JudgeOutputOrdered` (`judge.ts:67-73`) duplicates `JudgeOutput` (`schemas.ts:344-350`) by hand.
- Config role is sniffed from id strings in `release/sections.tsx:78`, `AnnotationQueue.tsx:23-27` and
  `mcp/server.mjs` instead of using `AgentConfig.role`/`label`.
- Dead code: `Stat` (`ui.tsx:92`), `roganGladen` (`calibration.ts:90`, test-only), and about 30 exports used
  only in their own file. `knip` or `ts-prune` would keep this honest.
- Static schemas never applied: `PricingPolicy`, `FrozenSet`, `PolicySection`. A one-line
  `z.array(PricingPolicy).parse(POLICIES)` in a test closes it.
- tsconfig: consider `noUncheckedIndexedAccess` and `noUnusedLocals`.
- `.claude/scheduled_tasks.lock` is tracked; it looks like a local artefact.

## Test gaps, by risk

1. `src/lib/storage/store.ts` has no direct tests (`withLock`, `updateJson`, `readLines`).
2. `src/lib/experiments/runner.ts`: `pool` error semantics, `judgeMissing`, `recoverOrphanedRuns`.
3. `src/lib/llm/client.ts`: `callStructured` cache-hit path, "never cache refusals", settle-on-error.
4. `src/lib/services/index.ts`: `reviewQueue` supersede rule, `trendView`, `runHistory`.
5. `src/proxy.ts`: no test at all.

## Unverified

- Whether Turbopack dev re-evaluates `runner.ts` on save, which would reset `activeRuns` and let
  `recoverOrphanedRuns` flip a live run to `failed` mid-flight. Persisting a heartbeat in the run file would
  remove the dependency on process memory either way.
- Whether the production build keeps a single instance of `store.ts` across route bundles (the lock map
  assumes it). Easy to check by logging a `Symbol()` from two routes.
- `appendFile` atomicity for audit lines larger than about 4 KB.
- A `next dev` for a different worktree is currently listening on 127.0.0.1:3123, so an MCP client started
  now would talk to that worktree's data.

## Suggested order

1. `src/proxy.ts` Host allowlist, Origin try/catch, and a `proxy.test.ts` (S1).
2. `pool()` stop flag and model-aware reservation (P2, P5): both affect live spend.
3. Request-scoped memo plus `GuideAgent` fetch-when-open (P1).
4. Security headers, required `actor` on `/api/run`, `.max()` limits, body-size cap (S2, S3, S5).
5. `readLines` tolerance, trend `incomplete` category, gate nits (P3, P4, P7).
6. Typecheck script, dedupe hooks and fetch wrappers, fallback pricing (maintainability, S7).
