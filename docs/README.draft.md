# Evalxiety

**Because your AI should be nervous before shipping.**

Evalxiety tests an AI agent before you ship it. It runs the agent on test cases, has a human review the answers,
checks the evidence, and refuses to say "ship it" until the evidence holds up.

I built it in one day for a Claude hackathon. The agent under test is a Claude-powered **merchant pricing agent** working
on synthetic business data. Want it running in 30 seconds? Skip to [Run it](#run-it). Got an agent of your own? See
[Use it on your own agent](#use-it-on-your-own-agent).

![Evalxiety dashboard: "Absolutely not shipping this."](docs/screenshots/dashboard.png)

## The result it caught

I built two versions of the pricing agent and ran both on the same 20 locked test cases with Claude Opus 5.5:

| | Baseline | Corrected |
|---|---|---|
| Cases passing every check | 9 / 20 | **18 / 20** |
| Picked the policy in force on the decision date | 9 / 20 | **20 / 20** |
| Kept margin above the policy floor | 15 / 20 | **20 / 20** |
| Routed every required human approval | 12 / 20 | 18 / 20 |

*The pass counts use only the four code checks. The AI judge is excluded because it has only 3 human labels to be
checked against.*

The fix worked: 10 cases fixed and 1 regressed (net +9). Four of the fixed cases were held out, so the agent was never
tuned on them. Four cases is an anecdote, not proof that the fix generalises.

**Evalxiety still says No ship.** 18 / 20 looks like a win. But one case that passed before the fix (C13) now skips a
required CFO sign-off, and another (C07) misses the same sign-off in both versions. A 90 % average hides exactly those
two.

![Paired, case-by-case comparison](docs/screenshots/experiments.png)

![Release gate: No ship](docs/screenshots/release-gate.png)

## How it works

Evalxiety follows the eval method from Hamel Husain and Shreya Shankar:

1. **Run the agent** on realistic cases and save every trace (inputs, evidence, answer, cost, latency).
2. **Review answers as a human.** You fill in a 5-question checklist. Automated results stay hidden until you've saved
   your answers, so they don't anchor your judgement.
3. **Define what "good" means.** Group your review notes into failure types, and keep a versioned rubric.
4. **Check automatically.** Code checks cover objective rules. One narrow AI judge covers the subjective question: is
   every reason backed by the evidence? The judge is labelled *experimental* and is reported separately from the code
   checks. Its agreement with human labels is measured as TPR / TNR with Wilson intervals. Until each class has at
   least 30 labels, those numbers are reported as "insufficient".
5. **Compare and ship.** Run versions on the same locked test cases (any edit to a case or policy changes a pinned hash)
   and read fixes and regressions case by case. Then decide at a release gate: *No ship · Not enough evidence ·
   Ready for approval · Approved for demo*.

![Jump from a failing check straight to the answers that fail it](docs/screenshots/fix-panel.png)

## Highlights

- **Read-only MCP server.** Ask Claude Desktop or Claude Code "Is the agent ready to ship?" or "Why did C13 regress?".
- **Fix panel.** Click a check to see every failing answer, why it failed, and how to fix that kind of failure.
- **One-screen trace review.** A compact summary and the checklist, then "you vs automated checks".
- **Experimental AI judge with explicit uncertainty.** Undefined metrics stay "undefined", never 0 % or 100 %.
  Inconclusive or errored verdicts are counted separately and never treated as PASS. You can choose Claude Haiku, Sonnet
  or Opus as the judge model, and each one is calibrated separately.
- **Credit controls.** Mock mode by default, cached responses (re-runs are free), a spend cap, and confirmation before
  paid batches. Held-out cases stay locked until an audited, irreversible reveal.

## Run it

```bash
npm install
cp .env.example .env.local    # MOCK_MODE=true: no API key or spend needed
npm run dev -- -p 3123        # http://localhost:3123
npm test                      # Vitest suite
```

This repo includes the data from my live run, so the dashboard, experiments and release gate show real results
immediately. For live Claude calls, set `MOCK_MODE=false` and `ANTHROPIC_API_KEY` in `.env.local`.
`LIVE_SPEND_CAP_USD` caps spend.

To connect Claude Code over MCP (read-only, no spend), keep the app running on port 3123, or point `AGENTTRUST_URL`
at another port. Then:

```bash
claude mcp add evalxiety -- node /absolute/path/to/mcp/server.mjs
```

The project was called AgentTrust during the hackathon. That name survives in the package name, the `AGENTTRUST_URL`
variable and some internal docs.

## Use it on your own agent

The pricing agent is only the demo: Evalxiety works on any agent, built with any stack, because it only needs your
agent's outputs. It is new and nobody outside this project has tried it on a real agent yet (see Limitations).

Start with the [5-minute starter kit](docs/use-your-agent.md#try-the-starter-kit-about-5-minutes), a toy help-desk
bot with two versions. Version 2 fixes 7 of the 9 cases you tune on, but it breaks one that used to work: it starts
handing self-serve cancellations to a human. Evalxiety flags that regression. The starter data is labelled EXAMPLE,
so by design the verdict reads "Not enough evidence".

Then point it at your own agent. You'll need two sets of traces (the version you ship today, and your change) and
time to read them: about one review per case on your final run.

1. `cp -r agents/_template agents/my-agent`, and name it in `agent.json`.
2. Put 10–30 real inputs in `cases.jsonl`, pulled from production logs with personal data removed.
3. Get traces in. Either edit `run-my-agent.mjs` to call your agent and import the file it writes, or add a
   `connection` block with your endpoint's URL to `agent.json` so Evalxiety calls it (after you confirm).
4. Review your traces, add code checks for the failures you find, then run your change and review every case of the
   final run. Read the gate at `/agents/my-agent`.

Full guide: [docs/use-your-agent.md](docs/use-your-agent.md).

## Built with

Next.js 16 (App Router) · TypeScript · Tailwind CSS · Anthropic SDK (Claude Opus 5.5) · Zod · Vitest · Model Context
Protocol SDK · local JSON storage. Built with Claude Code.

## Limitations

- **20 synthetic cases is a rehearsal, not production.** The cases and policies are synthetic and were written by
  the same person who built the agent (with Claude Code). The numbers show the method working; they can't establish
  production reliability.
- **The AI judge is uncalibrated.** It has 3 human labels against a 30-per-class minimum, so treat its verdicts as
  unvalidated.
- **Running it on your own agent is new.** The import and HTTP paths have automated tests, including HTTP calls to a
  real local server, but nobody outside this project has tried them on a real agent yet. Expect rough edges, and if
  you try it, [open an issue](https://github.com/richardan01/evalxiety/issues/new/choose) where it broke.
- **No CI command yet.** `npm run validate` checks your files in CI, but nothing yet fails a build on No ship.

## Credits

Methodology: Hamel Husain and Shreya Shankar's writing on product-specific evals ([evals FAQ](https://hamel.dev/blog/posts/evals-faq/),
[LLM-as-a-judge](https://hamel.dev/llm-judge/)).
