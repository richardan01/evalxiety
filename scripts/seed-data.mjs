#!/usr/bin/env node
/**
 * Runs before `npm run dev`, `npm start` and `npm run validate`: the app works on a copy of the demo's data in .data/
 * (git-ignored), made from the tracked data/ the first time. So using the app never changes tracked files, and deleting
 * .data/ resets the demo. An existing .data/ is never touched. Set EVALXIETY_DATA_DIR to use another folder (it's
 * seeded the same way when empty).
 *
 * The first copy also brings along what older versions kept in data/ itself (your agents' results in data/agents/, a
 * connected key in data/private/), so nothing you did before disappears.
 */
import { seedData } from "../bin/launcher.mjs";

const target = process.env.EVALXIETY_DATA_DIR || process.env.AGENTTRUST_DATA_DIR || ".data";
if (seedData("data", target)) console.log(`Evalxiety: copied data/ to ${target}/ (the app's working copy; delete it to reset the demo).`);
