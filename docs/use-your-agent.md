# Use Evalxiety on your own agent

You changed your agent's prompt, model or tools. Did it get better, or did you break something that used to work?
Evalxiety runs your old and new versions on the same test cases and shows, case by case, what got fixed and what
got worse. Then it gives a verdict: **No ship**, **Not enough evidence** or **Ready for approval**. It works with any
agent, built with any stack, because it only needs your agent's outputs.

**What leaves your machine.** Evalxiety runs locally and stores everything as JSON files under `data/`. Your cases,
traces and labels leave your machine only when you choose:
- **HTTP mode** sends each test input to your agent's URL.
- **The optional LLM judge** sends each trace (input, evidence, output) to the Anthropic API.
- **The optional MCP server** hands traces to the Claude client you connect it to.
- **The in-app guide chat** (bottom right) sends your question and a summary of the app's state to the Anthropic API,
  in live mode only.

Separately, Next.js (the framework Evalxiety runs on) sends its own anonymous usage telemetry, with no cases or
traces. Turn it off with `npx next telemetry disable`.

You don't need an Anthropic API key unless you turn on the judge.

**The fastest way in.** If your agent has an HTTP endpoint, click **Connect your agent** in the sidebar: name it, test
the endpoint with one sample question, keep the suggested rules, and paste your test questions. Nothing is written
until you click **Create agent**, and it never overwrites an existing folder. The rest of this guide covers what the
wizard writes for you, the file formats, and every rule behind the release decision.

## Try the starter kit (about 5 minutes)

You need Node.js 22.12+ or 24.

```bash
git clone https://github.com/richardan01/evalxiety.git && cd evalxiety
npm install
cp .env.example .env.local
npm run dev -- -p 3123
```

Open <http://localhost:3123/agents> and pick **Example support bot**. It is a toy help-desk agent with two versions.
An amber **MOCK MODE** banner sits above every page. Here it only means the judge uses a labelled mock; it's
expected.

**What you'll see:**
- **v2 fixes 7 of the 9 cases you tune on.** Three more cases are held out for the final check.
- **v2 also breaks a case that used to work.** In c09, "I want to cancel my monthly plan.", it hands the customer to
  a human when it shouldn't.
- **The verdict is "Not enough evidence", not "No ship".** This is by design: starter-kit data is labelled EXAMPLE
  and never counts as evidence. On your own agent, the same regression means No ship.

1. Under **Add a test → Import a file**, enter your name (it's recorded on what you do) and the version name `v1`.
2. Upload `agents/example-support-bot/traces.v1-baseline.jsonl` and click **Import answers**.
3. Do the same with `traces.v2-candidate.jsonl`, named `v2`.
4. Read the verdict at the top of the page:
   - it says this is a practice run that can never be approved;
   - **Worth knowing** lists what would block a real release, all naming c09;
   - **Still needed** lists what a real release would still need: reviews, the AI reviewer, the final-exam check.
5. Read the **Current vs new version** card: 7 fixed, 1 got worse (c09), 1 still passing (c08).
6. Click **Release report** for the one-page summary you'd share.

To try HTTP mode instead, start the toy agent in a second terminal (`npm run example-agent -- --version=v1`), use
**Call my agent (HTTP)** and name that test `v1`. Then restart the agent with `--version=v2` and run again, named
`v2`.

**Next:** [set up your own agent](#set-up-your-agent). [The loop](#the-loop) covers the review and final-check steps
this tour skipped.

## The loop

Words used here (the app uses the plain word first, with the technical one on hover):
- **case** (test case): one test input. **Dev cases** are the ones you look at and tune against.
- **held-out case** (final-exam case): a case you set aside and don't look at until the final check.
- **trace** (answer): your agent's output for one case, plus the evidence it was given (retrieved documents, tool
  results).
- **run** (test): one version of your agent on every case.
- **baseline / candidate** (current version / new version): the version you ship today, and your change.
- **code check** (rule) and **judge** (AI reviewer).

The steps:

1. **Baseline.** Get your cases right first: **the first run freezes them.** If you later change a case's `input`,
   `expected` or `split`, you must click **Lock as v2** and re-run the baseline too. Then import or run the version you
   ship today. Label it with something you'll recognise, such as
   `prompt-v3` or a git SHA. Tag it in git (or keep it runnable): you'll run it again at the final check. While it is
   your only version, it is shown as the baseline. Until you approve a release, the first version you import stays the
   default baseline.
2. **Read and label.** Click **Start reviewing**. For each trace:
   - mark it pass or fail;
   - write down the *first* thing that went wrong;
   - give that failure a short type name ("missed hand-off"). Reuse names so failures group together;
   - pick a severity. **Critical** on a candidate trace means No ship. Major and minor are shown to the approver.

   Review at least 10 (the gate's minimum; reviews of any run count toward it), and keep going until new traces stop
   showing new kinds of failure. With a 10–30-case set, that usually means reading every trace of your first run.
3. **Name what matters.** The failure-type counts on the agent page show what to fix first. Turn the objective
   failures into [code checks](#code-checks-checks-in-agentjson). Give at most one subjective failure to the judge.
4. **Candidate.** Change your agent, then import or run it under a new label. Review enough of it to see whether
   the change worked. If you have held-out cases, the final run in step 5 replaces this one, so this review isn't the
   one the gate counts. If you don't, this is your final run: review every trace of it.
5. **Final check.** When you've stopped tuning:
   - on the agent page, in the **Test cases** card, enter your name and a reason (at least 10 characters), then click
     **Unlock N final-exam case(s)** (this can't be undone);
   - run both versions again on every case, re-using their exact labels. With the template script, add
     `--include-heldout`;
   - review **every** trace of the new candidate run: the gate needs a human look at each one;
   - if you use a judge, run it on that run too, and answer its question on any trace it flags.

   No held-out cases? Then the candidate from step 4 is already your final run.

   **Budget:** for a 20-case set, plan on up to 20 reviews of your first run (at least 10; fewer once new failure
   types stop appearing), plus 20 on the final run: about 40.
6. **Decide.** Read the verdict and the checklist under it. Only a named person's approval of that exact evidence
   turns "Ready for approval" into **Approved**. If the evidence changes later, the approval goes stale.
7. **Share it.** **Release report** (top of the agent page) is a one-page summary: the verdict, what was compared, what
   got fixed and worse, the reviews, the rules, the decision and the evidence fingerprint. Print it, save it as PDF,
   download it as Markdown, or copy it as text.

**Which runs are compared.** Only completed runs count. Labels match ignoring case and leading or trailing spaces
(`v1` = `V1 `, but not `v 1`).
- **Baseline:** the version you ship. That's the last version you approved, or else the first version you imported.
- **Candidate:** the newest run of the label you introduced most recently, other than the baseline's.
- **Re-runs:** re-running the baseline under its *exact* label keeps the roles; the label box suggests the labels
  you've used.
- **Scratch runs:** runs labelled `scratch-…` are never picked by default.
- **Changing them:** use the New version and Current version pickers on the **Release checklist** card, or **Use as
  new** and **Use as current** in the **Tests** table.

"Not enough evidence" is a real answer, not a failure of the tool. It tells you what to collect next.

**On the review screen, check and judge results stay hidden until you save your label**, so they don't anchor
your judgement. The agent page does show check results for each case, so do your review pass before you study the
comparison.

## Set up your agent

```bash
cp -r agents/_template agents/my-agent
```

The template has three files:
- `agent.json`: one `non_empty` check that works for any agent. If your agent returns JSON, set its `field` to your
  answer field (for example `"answer"`).
- `cases.jsonl`: comments only, so the app reports "no cases" until you add yours.
- `run-my-agent.mjs`: makes an import file.

Change `name` in `agent.json`. The folder name (`my-agent`) is the agent's id: lowercase letters, digits and dashes.
Don't start from a copy of the starter kit: its checks, judge and URL are all specific to the toy bot.

`agents/*` (apart from the starter kit and template) and `data/agents/` are git-ignored, so your cases and traces
stay out of a public fork.

To keep agent folders in your own repo instead:
- set `EVALXIETY_AGENTS_DIR=/path/to/agents` in `.env.local`;
- copy the template there: `cp -r agents/_template /path/to/agents/my-agent`;
- use that path in the commands below.

That setting replaces `./agents`, so the starter kit no longer appears. Custom checks still live in this repo's
`agents/custom-checks.ts`, which git tracks.

### Test cases: `cases.jsonl`

One JSON object per line. Lines starting with `//` are ignored.

```json
{"case_id": "q01", "input": {"question": "Can I get a refund?"}, "expected": {"escalate": false}, "notes": "inside the 30-day window"}
{"case_id": "q02", "split": "heldout", "input": {"question": "My lawyer will be in touch."}, "expected": {"escalate": true}}
```

| Field | Required | Meaning |
|---|---|---|
| `case_id` | yes | Unique id: letters, digits, `_ . : -` |
| `input` | yes | Exactly what your agent receives. Sent verbatim over HTTP. |
| `split` | no | `dev` (default) or `heldout` |
| `expected` | no | A reference answer for `matches_expected` checks. Never sent to your agent. |
| `notes` | no | What the case tests, shown to reviewers |

A misspelled field is reported with its line number. Use 10–30 real inputs that vary on what matters for your agent
(user type, edge cases, missing data). Pull them from production logs and remove personal data. Hold out about a
quarter.

**Freezing.** The first run freezes the cases as version 1. If you later change a case's `case_id`, `input`,
`expected` or `split`, new runs are blocked until you click **Lock as v2** on the agent page. Editing `notes` doesn't
need a new freeze. Runs on different versions are never compared.

**Held-out cases.**
- **Locked until revealed.** Evalxiety won't import, call or score a held-out case until its content is revealed.
  The reveal is logged and can't be undone. New content under a revealed id stays locked until its own reveal.
- **Moving one doesn't unlock it.** Once a run has frozen a held-out case, it stays locked until revealed, even if
  you move it to dev or rename it. A dev case that copies a held-out case's input is locked too. Move it back to fix
  it. (Renaming it *and* rewording it makes it a new case, which Evalxiety can't tell apart from a fresh one.)
- **The gate flags reused content.** If a held-out case's content was already run before its reveal (say, a dev
  case you promoted to held-out), the gate flags it until you give it fresh input. Deleting some held-out cases is
  shown to the approver as a warning; deleting all of them blocks the gate.
- **The limit:** Evalxiety can't stop you reading `cases.jsonl` or running your agent on those inputs yourself. The
  final check only means something if you leave them alone.

### Get traces in

Two ways, and you can mix them:
- **Import** fits if you already log your agent's runs, or it's easier to call it from your own code.
- **HTTP** fits if your agent has (or can get) an endpoint, so Evalxiety calls it for you on every run.

#### Import a file

Edit `callMyAgent()` in `agents/my-agent/run-my-agent.mjs` to call your agent: import your code, call your
endpoint, or start a subprocess. If you'd rather not use Node, write the same JSON lines from any language. Then:

```bash
node agents/my-agent/run-my-agent.mjs > agents/my-agent/v1.jsonl
npm run validate -- my-agent agents/my-agent/v1.jsonl
```

Upload the file on the agent page under **Add a test → Import a file**. In this repo, writing it inside
`agents/my-agent/` keeps it git-ignored. If you set `EVALXIETY_AGENTS_DIR`, add your trace files to that repo's
`.gitignore`, or write them somewhere else. The script skips held-out cases: add `--include-heldout` after you've revealed them.

Each line looks like this:

```json
{"case_id": "q01", "output": {"answer": "Refunds are available within 30 days."}, "evidence": [{"id": "kb-12", "text": "Refunds are available within 30 days of purchase."}], "model_id": "claude-sonnet-5-5", "latency_ms": 840, "cost_usd": 0.004}
```

| Field | Meaning |
|---|---|
| `case_id` | Must be in `cases.jsonl` |
| `output` | Any JSON value or text |
| `error` | The agent failed on this case. `null` or `""` means no error. |
| `evidence` | `[{"id", "text"}]`: what the agent was given. Used by `cites_evidence` and the judge. |
| `tool_calls` | `[{"name", "input", "output", "error"}]` |
| `model_id`, `latency_ms`, `cost_usd`, `timestamp`, `metadata` | Optional, shown in review |

Any other keys are kept under `metadata`.

**Empty answers.** A line with an `error`, or with no answer at all (null, blank text, `{}`), is an errored case.
It is ERROR on every check and never counts as a pass. When only the answer field is empty (say
`{"answer": "", "escalate": false}`), a `regex` or `max_length` check on that field is ERROR and a `non_empty` check
FAILs. That's why it's worth keeping a `non_empty` check on your answer field. If an empty answer can be correct for
your agent (an extractor that finds nothing, say), set `"allow_empty_output": true` in `agent.json`.

`npm run validate` checks a file and the agent's config:
- every problem in the file, with its line number;
- misspelled keys, custom checks that aren't registered, and secret names that aren't allowed.

It stops at the first broken file, and exits 1 if anything is wrong. It reads `.env.local` like the app does. In CI,
your agent folder must be in the checkout, and held-out cases count as locked. It checks files; it doesn't run the
gate.

The **Check file** button on the import screen runs the same file checks, and needs no name or version name.
Imports are all or nothing: one bad line and nothing is saved. Importing the same file under the same version name
twice doesn't create a second run.

#### Let Evalxiety call your agent (HTTP)

Add a connection to `agent.json`:

```json
"connection": {
  "type": "http",
  "url": "http://localhost:8000/eval",
  "headers": { "Authorization": "Bearer ${env:EVALXIETY_AGENT_MY_AGENT_TOKEN}" },
  "timeout_ms": 60000,
  "cost_per_call_usd": 0.01,
  "concurrency": 2
}
```

Leave out `headers` if your endpoint needs no auth; if you keep it, set the variable in `.env.local` first. Your
endpoint must accept the body `{"case_id": ..., "input": {...}}`. If it has its own request format, use **Import** and
call it from `callMyAgent()` instead.

Evalxiety sends one `POST` per case with `{"case_id": "q01", "input": {...}}`. It calls dev cases, plus held-out
cases once you've revealed them. It asks you to confirm first whenever a run makes more than one call or sends any
secret. The confirmation shows the number of calls, the estimated cost, the host and which secrets it will send.

Reply with any JSON or text. If you reply with an object that has an `output` key, these keys are read as well:
`error`, `evidence`, `tool_calls`, `model_id`, `cost_usd` and `metadata`. Any other keys are kept under
`metadata`.

Each of these is recorded on its case as an error, and the run carries on:
- a non-2xx status;
- a reply with `error` set;
- a reply with no answer in it;
- a reply whose `evidence`, `tool_calls`, `model_id`, `cost_usd` or `metadata` don't match the format above;
- a timeout;
- a refused connection;
- a redirect (never followed);
- a reply over 2 MB.

**Secrets.**
- **Where they live:** put secrets in `.env.local` and refer to them in header values as `${env:NAME}`.
- **Allowed names:** NAME must be `EVALXIETY_AGENT_<AGENT_ID>_<SUFFIX>`.
  - `<AGENT_ID>` is the folder name in capitals with `_` for `-`.
  - `<SUFFIX>` is capital letters and digits only.
  - So `my-agent` can read `EVALXIETY_AGENT_MY_AGENT_TOKEN`, and an agent called `my` can't.
  - An `agent.json` can't read `ANTHROPIC_API_KEY`, your cloud credentials, or another agent's token.
- **Value rules:** values must be one line, at least 8 characters, with no leading or trailing spaces.
- **Plain http:** secrets are never sent over plain `http://` to a host other than localhost.
- **What's stored:** before anything from an HTTP run is stored, secret values are replaced with `[REDACTED:NAME]`,
  even if your agent echoes them back: raw, JSON-escaped, HTML-escaped, URL-encoded or base64. Other encodings aren't
  recognised, so don't have your agent echo request headers. The URL is recorded in the audit
  log, so keep tokens out of it. These rules cover HTTP mode; an imported file is stored as you wrote it.

## Code checks: `checks` in `agent.json`

Add checks after your first review, for failures you've actually seen. Each check answers one yes/no question.

Every check has:
- an `id` and a `question`;
- a `severity`: `critical`, `major` (the default) or `minor`;
- optionally `blocking: true` and a `fix_hint`.

A failed `critical` check always means No ship. Use `blocking` to make a `major` or `minor` check block a release
too.

The **pass-all bar** is the share of cases that must pass every check: `pass_all_threshold` in `agent.json`, 90% by
default.

| `type` | Passes when | Settings |
|---|---|---|
| `non_empty` | The output (or a field) contains some text | `field` |
| `json_output` | The output is a JSON object or array, with these fields present and not null | `required_fields` |
| `matches_expected` | An output field equals the case's `expected` | `field`, `expected_field`, `mode`: `exact`, `case_insensitive`, or `contains` (case-insensitive substring) |
| `regex` | The output matches, or doesn't match, a pattern | `field`, `pattern`, `flags`, `must`: `match` or `no_match` |
| `max_length` | The output is short enough | `field`, plus `max_words` and/or `max_chars` (at least one) |
| `cites_evidence` | Every cited id is in the evidence the agent was given | `citations_field`, `require_at_least_one` |
| `no_tool_errors` | No tool call reports an error | none |
| `max_latency_ms`, `max_cost_usd` | The trace is fast or cheap enough | `max` |
| `custom` | Your function returns PASS | `function`: a function registered under your agent's id in `agents/custom-checks.ts` |

**Mistakes reported when the agent loads:**
- misspelled keys;
- a `max_length` with no limit;
- an invalid pattern;
- an unregistered custom function;
- an `expected_field` that no case's `expected` contains.

If only some cases' `expected` lacks the field (a typo in one line, say), the gate shows a warning listing them.

**Reading results:**
- **`field`** is a dot path into the output, such as `answer` or `result.items.0`. Leave it empty to check the whole
  output.
- **Missing fields.** If the field is missing (the output changed shape), a `regex` with `no_match` and a
  `max_length` check read all the text in the output instead, so they can't be switched off.
- **Missing citations field.** `cites_evidence` fails if its citations field is missing. If the field is there but
  empty, the result is NOT_APPLICABLE, or FAIL with `require_at_least_one: true`.
- **ERROR** means the check couldn't run (see [Limits](#limits)). It never counts as a pass.
- **NOT_APPLICABLE** means there was nothing to check (for example, no `expected` value, or no latency recorded). It
  doesn't fail a case on its own. But a case where **every** check is NOT_APPLICABLE can't be shown to pass: it counts
  against the pass-all bar and shows as "incomplete" in the comparison. Keep one check that applies to every case,
  like the template's `non_empty`.

Before you trust a new check, make it fail once on purpose. Copy a trace file, break one output, and import it under
a label starting with `scratch-` (scratch runs are never picked as defaults).

## Optional LLM judge: `judge` in `agent.json`

Use the judge for **one** subjective failure that code can't catch:

```json
"judge": {
  "question": "Does the answer state a fact the evidence does not support?",
  "fail_definition": "At least one factual statement is missing from, or contradicts, the evidence.",
  "pass_definition": "Every factual statement can be found in the evidence.",
  "model": "claude-sonnet-5-5"
}
```

**Setup and cost.**
- **It needs an API key.** The judge calls Claude, so set `MOCK_MODE=false` and `ANTHROPIC_API_KEY` in `.env.local`
  and restart the app. Without them, it only runs on starter-kit data, using a labelled mock.
- **The gate waits for it.** Once a judge is configured, the gate needs it run on every candidate trace that didn't
  error. When it flags a trace, open it and answer the judge's question; the **Release checklist** card lists those traces
  under **Still to review**.
- **You confirm the cost.** Judging more than one trace shows an estimated cost and asks you to confirm.
- **Errors are retried.** Click **Run AI reviewer** again to retry errored verdicts (a rate limit, say).
- **Spend cap.** `LIVE_SPEND_CAP_USD` caps Evalxiety's estimated Claude spend. It does not cap what your own agent
  costs over HTTP.
- **Cached responses** quote your agent's output, so they are kept under `data/agents/<id>/llm_cache`, which is
  git-ignored.

**How the judge is checked.**
- **Your labels are the answer key.** When you review a trace, you also answer the judge's question. Evalxiety
  measures how many real failures the judge catches (TPR) and how many good answers it clears (TNR).
- **It stays "experimental".** The numbers are reported as insufficient until there are 30 human-labelled failures
  and 30 passes on the current judge version.
- **New versions start from zero.** Editing the question or the definitions, changing the model (in live mode),
  renaming the agent, or switching between mock and live mode starts a new version: earlier verdicts and calibration
  stop counting.
- **It never replaces your review.** Every candidate trace still needs a human look.
- **Long traces:** if a trace was too long for the judge to read in full, a PASS becomes "requires review".

## What the gate checks

One No-ship reason is enough for **No ship**, even if evidence is also missing. Otherwise, any missing piece of
evidence gives **Not enough evidence**. Two exceptions:
- **Starter-kit data** never says No ship: its No-ship reasons show as warnings.
- **The pass-all bar** is applied only once every candidate case has an error-free trace.

**No ship**
- A critical check fails, or a blocking check fails.
- A critical check that passed on the baseline now fails. A non-critical regression is a warning.
- A reviewer marked a candidate trace as a critical failure.
- Fewer cases pass every check than the pass-all bar.

**Not enough evidence**
- **Setup:**
  - there are no code checks;
  - cases changed since the last freeze;
  - held-out cases are still locked;
  - a held-out case was moved into dev, or its content was run before its reveal.
- **The candidate run:**
  - it is missing, still running or failed;
  - it ran on old cases;
  - it has missing or errored cases.
- **The baseline:**
  - it is missing, incomplete or errored;
  - it is the same run as the candidate;
  - it ran on different cases from the candidate.
- **Review:**
  - fewer than `min_reviewed_traces` (default 10) traces are reviewed;
  - a candidate trace has no human review;
  - a trace the judge flagged has no answer from you to the judge's question;
  - the judge hasn't run on every candidate trace (only if you set one up).
- **Example data:** the starter kit's verdict always lands here.

**Ready for approval**
- None of the above.

## Limits

Each of these reports ERROR or an error message rather than guessing.

| What | Limit |
|---|---|
| Import file | 9 MB |
| HTTP reply | 2 MB; `timeout_ms` up to 300,000; `concurrency` 1–8 |
| Regex checks | Text over 100,000 characters → ERROR. A pattern that runs over 250 ms → ERROR, and it isn't run again until the app restarts. |
| Judge input | 20,000 characters each of input, evidence and output; a PASS on a cut trace becomes "requires review" |
| Secrets | One line, at least 8 characters, no surrounding spaces, named for the agent |

## Ask Claude about it

The read-only MCP server (setup in the README) has `list_my_agents`, `get_agent_status` and `get_agent_trace`. Try
"Is my-agent ready to ship?" or "Why did c09 regress?"

`get_agent_trace` puts your agent's input and output, the check summaries, the judge's explanation and reviewer notes
under `untrusted_agent_data`, and the tool's description tells the client to treat them as data. That's a hint to the client, not a
guarantee against prompt injection. Don't connect it to a Claude session with tools you wouldn't let your agent's
output trigger.

## Not built yet

- A CI command that fails a build on No ship.
- Importing a spreadsheet (CSV) of questions and answers.
- Deleting runs, or editing cases, checks or the judge question in the app. The wizard creates a new agent's files;
  after that they are files you review like code.
