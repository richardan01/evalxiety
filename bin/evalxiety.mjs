#!/usr/bin/env node
// `npx evalxiety` — see launcher.mjs. The Node version is checked before anything else loads, so an old Node gets a
// plain message instead of a syntax error.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Evalxiety needs Node.js 22.12 or newer; this is ${process.versions.node}. Get the current LTS from https://nodejs.org and try again.`);
  process.exit(1);
}
const { main } = await import("./launcher.mjs");
const code = await main(process.argv.slice(2));
if (code !== null) process.exitCode = code;
