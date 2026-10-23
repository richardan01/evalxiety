import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { clearConnectedKey, readConnectedKey, saveConnectedKey } from "./connection";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "evalxiety-key-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("connected API key file", () => {
  it("is private (0600) even when it replaces a file that was world-readable", async () => {
    const f = path.join(dir, "private", "ai-connection.json");
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, "{}", { mode: 0o644 });
    saveConnectedKey("sk-ant-test-key-1234");
    expect((await fs.stat(f)).mode & 0o777).toBe(0o600);
    expect(readConnectedKey()).toBe("sk-ant-test-key-1234");
    saveConnectedKey("sk-ant-test-key-5678");
    expect((await fs.stat(f)).mode & 0o777).toBe(0o600);
    expect(readConnectedKey()).toBe("sk-ant-test-key-5678");
    expect((await fs.readdir(path.dirname(f))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("is removed on clear", () => {
    clearConnectedKey();
    expect(readConnectedKey()).toBeNull();
  });
});
