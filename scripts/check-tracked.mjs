#!/usr/bin/env node
/**
 * Fails if git tracks anything that must never reach GitHub: env files, keys, the app's private data, your own
 * agents' folders, build output, spreadsheets, or a file whose content looks like a credential. .gitignore keeps these
 * out by default; this catches a `git add -f`, a renamed file or a rule someone deleted. Runs in CI (npm run
 * check:files) and works as a pre-commit hook.
 *
 *   npm run check:files            # everything git tracks
 *   npm run check:files -- --staged  # only what you're about to commit
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const staged = process.argv.includes("--staged");
const files = execFileSync("git", staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] : ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

/** [why, test] — a path matching any of these must not be tracked. */
const FORBIDDEN_PATHS = [
  ["an env file (secrets live in .env.local, which is never committed)", (f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example")],
  ["a key or certificate", (f) => /\.(pem|key|p12|pfx)$/i.test(f) || /(^|\/)id_(rsa|ed25519)/.test(f)],
  ["the app's private data (API key, agent tokens)", (f) => f.startsWith("data/private/")],
  ["your own agent's data (traces and labels can hold customer data)", (f) => f.startsWith("data/agents/")],
  [
    "your own agent's folder (only the starter kit and the template are shared)",
    (f) => f.startsWith("agents/") && !/^agents\/(example-support-bot\/|_template\/|custom-checks\.ts$)/.test(f),
  ],
  ["build output or dependencies", (f) => /^(node_modules|\.next|out|build|coverage|test-results|playwright-report)\//.test(f)],
  ["a spreadsheet (questions and answers can hold customer data)", (f) => /\.(csv|tsv|xlsx|xls)$/i.test(f)],
  ["personal Claude Code settings or a lock file", (f) => /^\.claude\/(settings\.local\.json|.*\.lock)$/.test(f) || f === "CLAUDE.local.md"],
];

/** Credential shapes that must never appear in a tracked file's content. */
const SECRET_CONTENT = [
  ["an Anthropic API key", /sk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{20,}/],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a GitHub token", /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const SKIP_CONTENT = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|pdf|woff2?)$/i;

const problems = [];
for (const f of files) {
  for (const [why, test] of FORBIDDEN_PATHS) if (test(f)) problems.push(`${f}: ${why}`);
  if (SKIP_CONTENT.test(f)) continue;
  let text;
  try {
    if (statSync(f).size > 5 * 1024 * 1024) continue;
    text = readFileSync(f, "utf8");
  } catch {
    continue; // deleted in the working tree, or not a regular file
  }
  for (const [why, re] of SECRET_CONTENT) if (re.test(text)) problems.push(`${f}: contains what looks like ${why}`);
}

if (problems.length) {
  console.error(`✕ ${problems.length} file(s) must not be committed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  console.error("\nRemove them from git (git rm --cached <file>), keep secrets in .env.local or the app, and rotate any real credential that was pushed.");
  process.exit(1);
}
console.log(`✓ ${files.length} ${staged ? "staged" : "tracked"} file(s) checked: nothing that shouldn't be on GitHub.`);
