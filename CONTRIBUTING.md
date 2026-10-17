# Contributing to Evalxiety

Thanks for taking a look. Evalxiety is small and young, so issues are as useful as pull requests. If you tried it on
your own agent and got stuck, please open a **"I tried it on my agent and got stuck"** issue. That feedback shapes what
gets built next.

## Run the tests

You need Node.js 22.12 or newer (the test runner requires it; CI uses Node 24).

```bash
npm ci                         # install exactly what package-lock.json pins
cp .env.example .env.local     # MOCK_MODE=true: no API key or spend needed
npm test                       # Vitest suite
npm run lint                   # ESLint
npm run typecheck              # optional: tsc --noEmit
```

CI runs `npm ci`, `npm test` and `npm run lint` on every pull request and on every push to `main`. Please run them
locally before you open a PR. The tests run in mock mode and need no API key.

This project runs on Next.js 16, which differs from older versions in ways that matter (for example, `params` is a
Promise). Read [AGENTS.md](AGENTS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before you change routes or
pages.

## Project rules

These rules exist because the whole point of the tool is evidence you can trust. A PR that breaks one of them will not
be merged, however useful it is otherwise.

1. **Mock mode by default.** Live Claude calls happen only when `MOCK_MODE=false` and an API key is set. Mock output is
   always labelled as mock and never counts as release evidence. Don't add a code path that calls the API in tests, in
   CI or on startup.
2. **Never fabricate human labels.** Annotations carry `label_source: "human"` and a named reviewer, and only a person
   reviewing a trace may create one. Don't generate, script or back-fill labels, and don't present AI judge verdicts
   as human labels or as gold. Failure-mode frequencies, gold examples and judge calibration are all built from human
   labels, so one fake label corrupts all three.
3. **Ask before paid API batches.** Any change that runs more than one live call (a multi-case experiment, a judge
   batch, a calibration run, an HTTP run against someone's agent) must show a cost estimate and require explicit
   confirmation (`confirm_paid_batch` in the pricing demo; `confirm_batch` / `confirm` for your agents). If
   your PR needs live results, say so in the PR and the maintainer will decide whether to spend on them. Keep the spend
   cap (`LIVE_SPEND_CAP_USD`) in force.
4. **Undefined is not zero.** A metric with a zero denominator is `null` and renders as "undefined", never 0 % or 100 %.
   Inconclusive or errored judge verdicts are never counted as PASS.

The full list of rules, and where each one is enforced, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#non-negotiable-rules-enforced-in-code).

## Propose a new code check

A code check answers one narrow, objective question about a trace with PASS or FAIL. If a failure needs judgement to
spot, it belongs in an LLM judge question, not in a code check. There are three kinds of check, and they live in
different places.

**A check for your own agent** needs no PR. Add it to `checks` in `agents/<your-agent>/agent.json` using a built-in
type, or write a TypeScript function in `agents/custom-checks.ts`. See
[docs/use-your-agent.md](docs/use-your-agent.md#code-checks-checks-in-agentjson).

**A new built-in check type** (something many agents would use, like `cites_evidence`) is a PR. Start with an issue
that describes:

- the failure you saw, with at least one real trace that shows it (anonymised is fine);
- the yes/no question the check type would answer, and its settings;
- the exact pass and fail rules, including any tolerance, and when it is NOT_APPLICABLE.

Checks should come from failures someone actually saw while reviewing traces (error analysis), not from a list of
things that might go wrong. Once the idea is agreed, a built-in type touches these files:

| What | Where |
|---|---|
| The settings schema (one entry in the `type` union) | `CheckConfig` in `src/lib/agents/schemas.ts` |
| The implementation and its plain-words rule | `runBuiltIn` and `describeRule` in `src/lib/agents/checks.ts` |
| Tests: at least one PASS, one FAIL, and NOT_APPLICABLE or ERROR where they can happen | `src/lib/agents/checks.test.ts` |
| The reference table | `docs/use-your-agent.md` |

A check that can't run must return ERROR, never PASS. Run `npm test` and say in the PR which outcome each new test
forces.

**A check for the built-in pricing demo** is a PR to `src/lib/evaluators/deterministic.ts`:

| What | Where |
|---|---|
| Definition (`evaluator_id`, severity, pass/fail rules, `blocking`) | `DETERMINISTIC_EVALUATORS` in `src/lib/evaluators/deterministic.ts` |
| The check function, registered by ID | same file, `EVALUATOR_FNS` |
| Tests: at least one PASS and one FAIL case, plus the "correct recommendations pass" sweep | `src/lib/evaluators/deterministic.test.ts`, using `src/lib/testing/fixtures.ts` |
| The failure mode it detects (`linked_evaluator_id`) | `src/lib/taxonomy/seed.ts` |
| "How to fix this" guidance in the fix panel | `GUIDE` in `src/app/evaluators/FixPanel.tsx` |
| Short display label | `src/app/evaluators/matrix.ts`, `src/app/experiments/shared.tsx`, `src/app/_overview/DashboardCharts.tsx` |

Every check in `DETERMINISTIC_EVALUATORS` counts toward "cases passing every check" as soon as it is added, so it must
arrive with tests that cover both outcomes. Adding one changes the pass counts of every existing run: say so in the
PR, with the before and after numbers from the Experiments tab.

## Pull requests

- Keep each PR to one change, and explain why in the description.
- Add or update tests for any logic you change.
- Don't commit `.env.local`, API keys, your own agents' folders or anything under `data/` that came from a live run you
  didn't intend to share. (`agents/*` and `data/agents/` are git-ignored by default for this reason.)
- Changes to `data/` (traces, labels, experiment runs) need a note on where the data came from.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
