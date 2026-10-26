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
import { scanFiles } from "./secret-scan.mjs";

const staged = process.argv.includes("--staged");
const files = execFileSync("git", staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] : ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

/** Rules for this repository on top of the shared ones (secret-scan.mjs). */
const REPO_PATHS = [
  [
    "your own agent's folder (only the starter kit and the template are shared)",
    (f) => f.startsWith("agents/") && !/^agents\/(example-support-bot\/|_template\/|custom-checks\.ts$)/.test(f),
  ],
  ["build output or dependencies", (f) => /^(node_modules|\.next|out|build|dist|coverage|test-results|playwright-report)\//.test(f)],
];

const problems = scanFiles(
  files.map((f) => ({ rel: f, abs: f })),
  { extraPathRules: REPO_PATHS },
);

if (problems.length) {
  console.error(`✕ ${problems.length} file(s) must not be committed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  console.error("\nRemove them from git (git rm --cached <file>), keep secrets in .env.local or the app, and rotate any real credential that was pushed.");
  process.exit(1);
}
console.log(`✓ ${files.length} ${staged ? "staged" : "tracked"} file(s) checked: nothing that shouldn't be on GitHub.`);
