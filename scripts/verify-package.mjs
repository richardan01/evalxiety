#!/usr/bin/env node
/**
 * Refuses an npm package folder that holds anything that must not be published: an env file, a key, private data, a
 * spreadsheet, a credential in any file's content, or an agent folder other than the starter kit and the template. Run
 * by build-npm.mjs after it assembles dist/npm, and again by `npm publish` there (prepublishOnly), so a file added by
 * hand in between is caught too.
 *
 *   node scripts/verify-package.mjs dist/npm
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scanFiles } from "./secret-scan.mjs";

/** Rules for the package on top of the shared ones. */
const PACKAGE_PATHS = [
  ["an agent folder other than the starter kit and the template", (f) => /^seed\/agents\//.test(f) && !/^seed\/agents\/(example-support-bot|_template)\//.test(f)],
  ["agent folders inside the prebuilt server (the launcher points it at your own folder)", (f) => /^app\/(agents|data|\.data)\//.test(f)],
  ["a build cache", (f) => /^app\/\.next\/cache\//.test(f)],
  ["git metadata", (f) => /(^|\/)\.git\//.test(f)],
];

function walk(root, dir = root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, abs, out);
    else out.push({ rel: path.relative(root, abs).split(path.sep).join("/"), abs });
  }
  return out;
}

export function verifyPackage(dir) {
  return scanFiles(walk(dir), { extraPathRules: PACKAGE_PATHS });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = path.resolve(process.argv[2] ?? ".");
  const files = walk(dir);
  const problems = scanFiles(files, { extraPathRules: PACKAGE_PATHS });
  if (problems.length) {
    console.error(`✕ ${problems.length} file(s) must not be published:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`✓ ${files.length} file(s) in ${path.relative(process.cwd(), dir) || "."} checked: nothing that shouldn't be published.`);
}
