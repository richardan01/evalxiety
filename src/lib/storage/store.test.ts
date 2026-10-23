import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { appendLine, readLines } from "./store";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "evalxiety-store-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const Row = z.object({ n: z.number() });

describe("readLines", () => {
  it("returns [] for a missing file", async () => {
    expect(await readLines("nope.jsonl", Row)).toEqual([]);
  });

  it("skips a torn or invalid line instead of failing the whole log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await appendLine("log.jsonl", { n: 1 });
    await fs.appendFile(path.join(dir, "log.jsonl"), '{"n": 2, "tru\n{"n":"not a number"}\n', "utf8");
    await appendLine("log.jsonl", { n: 3 });
    expect(await readLines("log.jsonl", Row)).toEqual([{ n: 1 }, { n: 3 }]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("line 2 of log.jsonl");
    warn.mockRestore();
  });
});
