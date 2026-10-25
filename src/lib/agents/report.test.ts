/**
 * The release report, built from a real agent overview (the starter kit's two runs), says what the gate says and
 * carries the evidence fingerprint.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getAgent } from "./config";
import { importRun } from "./runs";
import { agentOverview } from "./services";
import { reportMarkdown, verdictOf } from "./report";

const STARTER = path.join(process.cwd(), "agents", "example-support-bot");
let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "evx-report-"));
  process.env.AGENTTRUST_DATA_DIR = dataDir;
  process.env.MOCK_MODE = "true";
  delete process.env.EVALXIETY_AGENTS_DIR;
});
afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("release report", () => {
  it("summarises the starter kit's comparison in plain words", async () => {
    const agent = await getAgent("example-support-bot");
    for (const [file, version] of [
      ["traces.v1-baseline.jsonl", "v1"],
      ["traces.v2-candidate.jsonl", "v2"],
    ]) {
      await importRun({ agent, text: await fs.readFile(path.join(STARTER, file), "utf8"), agent_version: version, actor: "tester" });
    }
    const view = await agentOverview("example-support-bot");
    const md = reportMarkdown(view, new Date("2026-10-25T09:00:00Z"));

    expect(md).toMatch(/^# Release report: Example support bot/);
    expect(md).toContain("> Practice data from the starter kit");
    expect(md).toContain(`## Verdict: ${verdictOf(view).headline}`);
    expect(md).toMatch(/- New version: \*\*v2\*\*/);
    expect(md).toMatch(/- Current version: \*\*v1\*\*/);
    // The starter kit's known result: 7 fixed, c09 got worse on the hand-off rule.
    expect(md).toContain("- Fixed: 7 (");
    expect(md).toMatch(/- Got worse: 1 \(c09: “Does the bot hand off to a human exactly when policy says it must\?”\)/);
    expect(md).toContain("Would block a real release:");
    expect(md).toContain("## Rules checked on the new version");
    expect(md).toContain("| Does the bot hand off to a human exactly when policy says it must? | critical | 8 | 1 | 0 |");
    expect(md).toContain("- No decision yet.");
    expect(md).toContain(`\`${view.evidence_snapshot_hash}\``);
    expect(md).toContain("still locked");
  });
});
