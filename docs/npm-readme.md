# Evalxiety

Decide whether your AI agent's new version is ready to ship. Test it on your own questions, review its answers,
define what "good" means, and get a plain-language release verdict you can share. It runs on your computer.

```bash
npx evalxiety
```

You need [Node.js](https://nodejs.org) 22.12 or newer. Evalxiety opens in your browser, on this computer only
(127.0.0.1).

## What you can do

- **Connect your agent:** paste its URL (and its token, if it needs one), or upload a spreadsheet of its answers.
- **Test two versions** on the same questions, and see what got fixed and what got worse, case by case.
- **Review answers yourself.** Automated results stay hidden until you've saved your review.
- **Define what good means without JSON:** rules in plain English (Claude can draft them; each one must catch a bad
  answer before it counts), one AI reviewer question, and your test cases.
- **Get the verdict:** No ship, Not enough evidence, Ready for approval, or Approved by a named person, with a
  one-page release report.

Try it first on the built-in demo and the starter kit; your own agents appear next to them.

## Your files

Everything lives in `~/Evalxiety` (`npx evalxiety where` prints it):

| Folder | What's in it |
|---|---|
| `agents/` | One folder per agent: `agent.json` (rules, AI reviewer question, how to call it) and `cases.jsonl` (test cases). |
| `data/` | Tests, answers, reviews, approvals and audit logs. `data/private/` holds a connected API key and agent tokens. |
| `settings.env` | Optional settings, one `NAME=value` per line, e.g. `LIVE_SPEND_CAP_USD=5`. |

Back up the folder to keep your work. Use another folder with `npx evalxiety --data <folder>` (or `EVALXIETY_HOME`).

## Claude API credit

Nothing calls the Claude API until you connect a key on the **Connect** page. Until then, everything that needs
Claude (drafting rules, the AI reviewer on your own agent's answers) says so instead of running. With a key, calls are
cached, capped by `LIVE_SPEND_CAP_USD` (default $10), and confirmed before batches.

## Commands

| Command | What it does |
|---|---|
| `npx evalxiety` | Start it and open your browser (`--port`, `--no-open`, `--data`). |
| `npx evalxiety where` | Show where your files are, and whether it's running. |
| `npx evalxiety mcp` | The read-only connection for Claude Desktop or Claude Code (the **Connect** page has the exact setup). |
| `npx evalxiety validate <agent> [answers.jsonl]` | Check an agent's files, and a file of answers, without starting it. |
| `npx evalxiety example-agent --version=v1` | Run the starter kit's toy agent, to try calling an agent over HTTP. |

## More

The full guide, the method and the source: [github.com/richardan01/evalxiety](https://github.com/richardan01/evalxiety).
Custom rules written in TypeScript need a clone of the repository.
