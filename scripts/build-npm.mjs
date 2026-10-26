#!/usr/bin/env node
/**
 * Builds the npm package behind `npx evalxiety` into dist/npm, ready to publish from that folder:
 *
 *   npm run build:npm
 *   cd dist/npm && npm publish        # runs the package check again first (prepublishOnly)
 *
 * What goes in:
 *   app/    the prebuilt, self-contained Next.js server (output: "standalone"), with its static files. The image
 *           library (sharp, with Linux-only binaries) is left out: the app shows no optimised images.
 *   bin/    the launcher (bin/launcher.mjs). mcp/: the read-only MCP server. cli/: the offline checker, bundled.
 *   seed/   the demo's data and the starter kit, taken from the last commit with `git archive`, so nothing from using
 *           the app here (your agents, results, keys, a changed working tree) can end up in the package. The spend
 *           ledger starts at $0: past spend is this repository's, not the user's.
 * Then every file is checked (verify-package.mjs): no env file, key, private data or credential-shaped content.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { verifyPackage } from "./verify-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "npm");
const root = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const step = (s) => console.log(`\n▸ ${s}`);
const fail = (s) => {
  console.error(`✕ ${s}`);
  process.exit(1);
};

/** Anything a package user needs that the prebuilt server doesn't load. */
const SEED_PATHS = ["data", "agents/example-support-bot", "agents/_template"];
/** Left out of the prebuilt server: the launcher points it at the user's own folders, and the app uses no image optimisation. */
const STRIP_FROM_APP = ["agents", "mcp", "data", ".data", "node_modules/sharp", "node_modules/@img", "node_modules/@modelcontextprotocol", ".next/cache"];

step("Building the app (standalone)");
const nb = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "build"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, EVALXIETY_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" },
});
if (nb.status !== 0) fail("next build failed.");
const standalone = path.join(ROOT, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) fail("next build didn't produce .next/standalone/server.js.");

step(`Assembling ${path.relative(ROOT, OUT)}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const app = path.join(OUT, "app");
cpSync(standalone, app, { recursive: true });
cpSync(path.join(ROOT, ".next", "static"), path.join(app, ".next", "static"), { recursive: true });
if (existsSync(path.join(ROOT, "public"))) cpSync(path.join(ROOT, "public"), path.join(app, "public"), { recursive: true });
for (const p of STRIP_FROM_APP) rmSync(path.join(app, p), { recursive: true, force: true });
// Next copies env files next to the standalone server; a package must never carry one (they hold API keys).
for (const f of [".env", ".env.local", ".env.production", ".env.production.local"]) rmSync(path.join(app, f), { force: true });

for (const f of ["bin/evalxiety.mjs", "bin/launcher.mjs", "mcp/server.mjs", "mcp/tools.json", "LICENSE"]) {
  mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
  cpSync(path.join(ROOT, f), path.join(OUT, f));
}
mkdirSync(path.join(OUT, "tools"), { recursive: true });
for (const f of ["verify-package.mjs", "secret-scan.mjs"]) cpSync(path.join(ROOT, "scripts", f), path.join(OUT, "tools", f));
cpSync(path.join(ROOT, "docs", "npm-readme.md"), path.join(OUT, "README.md"));

step("Seed: the demo's data and the starter kit, from the last commit");
const dirty = execFileSync("git", ["status", "--porcelain", "--", ...SEED_PATHS], { cwd: ROOT, encoding: "utf8" }).trim();
if (dirty) console.log(`  (uncommitted changes there are left out:\n${dirty.split("\n").map((l) => `   ${l}`).join("\n")})`);
const seed = path.join(OUT, "seed");
mkdirSync(seed, { recursive: true });
const tarball = execFileSync("git", ["archive", "--format=tar", "HEAD", "--", ...SEED_PATHS], { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 });
execFileSync("tar", ["-x", "-C", seed], { input: tarball });
writeFileSync(path.join(seed, "data", "spend_ledger.json"), JSON.stringify({ total_estimated_usd: 0, live_calls: 0, entries: [], reservations: [] }, null, 2) + "\n");

step("Bundling the offline checker (npx evalxiety validate)");
await build({
  entryPoints: [path.join(ROOT, "scripts", "validate.ts")],
  outfile: path.join(OUT, "cli", "validate.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: path.join(ROOT, "tsconfig.json"),
  // Some bundled CommonJS calls require(); give it one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "warning",
});

step("package.json");
const pkg = {
  name: "evalxiety",
  version: root.version,
  description: "Decide whether your AI agent's new version is ready to ship: test it, review its answers, define what good means, and get a release verdict. Runs on your computer.",
  keywords: ["ai", "agents", "evals", "llm", "release", "claude", "evaluation"],
  license: "MIT",
  repository: { type: "git", url: "git+https://github.com/richardan01/evalxiety.git" },
  homepage: "https://github.com/richardan01/evalxiety#readme",
  bin: { evalxiety: "bin/evalxiety.mjs" },
  engines: root.engines,
  // The prebuilt server carries its own dependencies (app/node_modules). These are for the MCP server.
  dependencies: { "@modelcontextprotocol/sdk": root.dependencies["@modelcontextprotocol/sdk"], zod: root.dependencies.zod },
  files: ["app", "bin", "cli", "mcp", "seed", "tools", "README.md", "LICENSE"],
  scripts: { prepublishOnly: "node tools/verify-package.mjs ." },
};
writeFileSync(path.join(OUT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

step("Checking every file");
const problems = verifyPackage(OUT);
if (problems.length) fail(`${problems.length} file(s) must not be published:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

const dry = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json"], { cwd: OUT, encoding: "utf8" });
if (dry.status !== 0) fail(`npm pack --dry-run failed:\n${dry.stderr}`);
const [info] = JSON.parse(dry.stdout);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`\n✓ evalxiety@${pkg.version}: ${info.entryCount} files, ${mb(info.size)} to download (${mb(info.unpackedSize)} unpacked).`);
console.log(`  Try it:   cd ${path.relative(process.cwd(), OUT)} && npm pack && npx --yes ./evalxiety-${pkg.version}.tgz`);
console.log(`  Publish:  cd ${path.relative(process.cwd(), OUT)} && npm publish`);
