/**
 * What must never leave this machine, in one place: the tracked-files check (check-tracked.mjs) and the npm package
 * check (verify-package.mjs) both use it.
 */
import { readFileSync, statSync } from "node:fs";

/** [why, test] for a path (forward slashes, relative to the folder being checked) that must not be shipped. */
export const FORBIDDEN_PATHS = [
  ["an env file (secrets live in .env.local, which is never committed)", (f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example")],
  ["a key or certificate", (f) => /\.(pem|key|p12|pfx)$/i.test(f) || /(^|\/)id_(rsa|ed25519)/.test(f)],
  ["the app's private data (API key, agent tokens)", (f) => /(^|\/)data\/private\//.test(f)],
  ["your own agent's data (traces and labels can hold customer data)", (f) => /(^|\/)data\/agents\//.test(f)],
  ["the app's working copy of the data (.data/)", (f) => /(^|\/)\.data\//.test(f)],
  ["a spreadsheet (questions and answers can hold customer data)", (f) => /\.(csv|tsv|xlsx|xls)$/i.test(f)],
  ["personal Claude Code settings or a lock file", (f) => /(^|\/)\.claude\/(settings\.local\.json|.*\.lock)$/.test(f) || /(^|\/)CLAUDE\.local\.md$/.test(f)],
];

/** Credential shapes that must never appear in a shipped file's content. */
export const SECRET_CONTENT = [
  ["an Anthropic API key", /sk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{20,}/],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a GitHub token", /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

const SKIP_CONTENT = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|pdf|woff2?|node|wasm)$/i;

/**
 * Problems with these files: a forbidden path, or content shaped like a credential. `rel` is how a file is named in
 * the report and matched against FORBIDDEN_PATHS; `abs` is where to read it.
 */
export function scanFiles(files, { extraPathRules = [] } = {}) {
  const problems = [];
  for (const { rel, abs } of files) {
    for (const [why, test] of [...FORBIDDEN_PATHS, ...extraPathRules]) if (test(rel)) problems.push(`${rel}: ${why}`);
    if (SKIP_CONTENT.test(rel)) continue;
    let text;
    try {
      if (statSync(abs).size > 5 * 1024 * 1024) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue; // deleted in the working tree, or not a regular file
    }
    for (const [why, re] of SECRET_CONTENT) if (re.test(text)) problems.push(`${rel}: contains what looks like ${why}`);
  }
  return problems;
}
