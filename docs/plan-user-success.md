# Plan: help other people get their evals to a trustworthy result

Status: draft, 2026-10-17. Nothing here is built yet. Builds on [plan-any-agent.md](plan-any-agent.md),
which covers the engine (trace import, profiles, check registry). This plan covers the **user journey**
around that engine, and what the public repo needs before strangers can use it.

## Where things stand (checked 2026-10-17)

- `github.com/richardan01/evalxiety` is **already public** (`gh repo view`: `visibility: PUBLIC`, 1 star).
  PRs #1 and #2 are merged; this worktree is level with `origin/main`.
- **No LICENSE file.** Without one, nobody may legally reuse the code, so "share my framework" doesn't
  work yet. This is the first fix.
- No repo description, no topics, no CONTRIBUTING, no issue templates.
- README says plainly: "Only the built-in pricing agent is supported today." Start here and the guide
  agent (`src/lib/guide/knowledge.ts:63`) say the same. That is honest, but it means a visitor can
  *watch* the method and can't yet *use* it on their own agent.
- Committed `data/` is clean: no keys, no emails, no KPay references. The only names are reviewer
  labels "Richard" / "rich".

## What "success" means for a user

A user has succeeded when they reach **a release-gate decision on their own agent that they would
defend to a sceptical colleague**. That is a stronger bar than "green dashboard". Concretely:

| Milestone | Evidence it happened |
|---|---|
| M1 Tried it | Demo running locally in under 5 minutes, mock mode, no key |
| M2 Imported | ≥ 1 run of *their* traces imported and visible in Review |
| M3 Looked | ≥ 10 of their traces human-reviewed (the gate's existing minimum) |
| M4 Named failures | ≥ 3 failure types in the taxonomy, with counts |
| M5 Checked | ≥ 1 code check of their own, forced to FAIL once to prove it can |
| M6 Compared | Two runs (baseline + candidate) on the same frozen cases, paired comparison read |
| M7 Decided | A gate verdict, *including* "Not enough evidence" — an honest NO is a success |

M7 counting "Not enough evidence" as success is deliberate. The product's whole point is that it
refuses to fake a SHIP; onboarding must not quietly push users toward green.

## Three framings

**A. Starter kit ("copy this folder").** A `templates/starter/` folder with an example JSONL of traces,
a cases file, one example check and a rubric. The README walks through replacing each file.
- For: smallest build, works offline, easy to read in a PR.
- Against: users still have to understand the trace contract from docs; no hand-holding in the app.

**B. In-app setup wizard ("Set up your agent").** A new `/setup` page: name the agent → upload traces
(or paste one and let it infer the shape) → pick generic checks → write the one judge question → go to
Review. Start here's "Onboard your own agent" checklist becomes live progress against M1–M7.
- For: the friendliest path; reuses the existing Start here status logic and guide agent.
- Against: most UI work; a wizard can paper over decisions the user should think about.

**C. Claude-guided setup ("eval coach").** Extend the read-only MCP server and the in-app guide agent
so a user can say "help me set up evals for my support bot" in Claude Code. Claude drafts the cases
file, the checks and the judge question *as files in their repo*, then points them to import.
- For: matches how the target audience already works; Claude writes the boilerplate.
- Against: needs write tools, which breaks the "MCP is GET-only" rule; drafted cases must still be
  human-owned, or the evals measure Claude's guesses instead of the user's product.

**Recommendation: A, then B, then a narrow slice of C.**
A is the minimum that makes "use it on your agent" true, and it is also what B and C produce. B turns A
into a guided flow. For C, keep MCP read-only; let the guide *explain* and *draft text in chat* but
have the user save files themselves. That keeps the "human owns the labels and cases" rule intact.

## Phases

### Phase 0 — make the public repo shareable (half a day, no product code)

1. **Add a LICENSE.** MIT is the usual choice for a portfolio framework; Apache-2.0 if you want an
   explicit patent grant. *Decision for Rich.*
2. Repo description + topics (`llm-evals`, `llm-as-judge`, `ai-agents`, `claude`, `mcp`, `release-gate`).
3. `CONTRIBUTING.md`: how to run tests, the "no fabricated labels, mock by default" rules, and how to
   propose a new check.
4. `.github/ISSUE_TEMPLATE/`: "bug", "I tried it on my agent and got stuck" (the second one is the
   most useful feedback loop you will get).
5. CI: GitHub Action running `npm ci && npm test && npm run lint` on PRs. A green badge is cheap trust.
6. README: add a "Use it on your own agent" section that is honest about what's built at each phase.
   Retire the "AgentTrust" name note once the rename lands.

### Phase 1 — bring your own traces (≈ 1 day; plan-any-agent steps 1–6)

Build framing A of [plan-any-agent.md](plan-any-agent.md): profiles, generic trace, check registry,
per-profile judge criterion, case import, `POST /api/traces/import`. Plus, for this plan:

- `templates/starter/` — `cases.jsonl`, `traces.baseline.jsonl`, `traces.candidate.jsonl`,
  `checks.ts` (one example check), `rubric.md`, and a `README.md` that says which file to replace first.
- `npm run validate -- path/to/traces.jsonl` — offline checker that prints the bad line number and why
  (unknown `case_id`, missing `output`, held-out case before reveal). Users fix shape errors before
  they ever open the app.
- Error messages in the import endpoint written for a first-time user, not for us.

### Phase 2 — guided setup (≈ 1 day; framing B)

- `/setup` wizard, five steps, each saving real state (no "skip to done").
- Start here checklist → live M1–M7 progress for the selected profile.
- Guide agent knowledge (`src/lib/guide/knowledge.ts`) updated so "how do I evaluate my agent?" gets
  the real steps, not "coming next".
- Empty states everywhere say the *next action*, e.g. Review with 0 traces → "Import your first run".

### Phase 3 — CI gate (≈ half a day)

- `npx evalxiety gate --profile support-bot` exits non-zero on No ship. Documented GitHub Action
  snippet. This is the hook that keeps a team using it after the first week.

## Testing that users actually succeed

The tests in plan-any-agent cover correctness. These cover the journey:

1. **Fresh-clone test in CI.** Clone → `npm ci` → copy `.env.example` → `npm test` → start → hit
   `/start`. Catches "works on my machine".
2. **Starter-kit end-to-end test.** Import the starter traces, review 10 (fixture labels clearly marked
   as test fixtures, never shipped as data), run checks, reach a gate verdict. Assert the verdict.
3. **Force the alarm.** A starter check is flipped to fail on purpose; assert the gate says No ship.
4. **Three outside dry-runs.** Hand the repo to 3 people with their own agents, watch silently, log
   where each one stalls. Count how many reach M2, M3, M7. Target for launch: **3 / 3 reach M2, 2 / 3
   reach M7**. Fix the top stall before announcing.

## Launch checklist (before you share it widely)

- [ ] LICENSE committed
- [ ] Phase 1 merged, starter kit works from a fresh clone
- [ ] README "Use it on your own agent" section written
- [ ] Riddler + Vicki Vale pass on the README (required for any public artifact)
- [ ] 3 outside dry-runs done, top stall fixed
- [ ] Then: the announcement post (Nightwing), with the C13 regression as the hook

## Open decisions for Rich

1. **License:** MIT or Apache-2.0?
2. **Demo second agent:** ship a small support-bot profile so the README can show "two agents, one
   method"? Its labels must be your own reviews, which is human time.
3. **Scope of first share:** announce after Phase 0 ("here's the method, watch it work") or wait for
   Phase 1 ("use it on your agent")? Phase 0 alone is shareable as a portfolio piece; Phase 1 is what
   makes it a framework other people use.
4. **Rename:** finish the AgentTrust → Evalxiety rename during the profile refactor (package name,
   `AGENTTRUST_URL`), with the old variable kept as a fallback?

## Size

Phase 0: half a day. Phase 1: about a day. Phase 2: about a day. Phase 3: half a day. No API spend
except an optional judge calibration on a demo profile, which needs approval like any paid batch.
