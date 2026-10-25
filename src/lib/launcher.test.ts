/**
 * `npx evalxiety`: the launcher's own logic (bin/launcher.mjs) and the package check that stands between a build and
 * `npm publish` (scripts/verify-package.mjs). The packaged server itself is exercised by `npm run smoke:npm`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homeDir, nodeTooOld, parseArgs, parseEnvFile, pickPort, prepareHome, seedData, serverEnv, UsageError } from "../../bin/launcher.mjs";
import { verifyPackage } from "../../scripts/verify-package.mjs";
import { launcher, runWords } from "./launcher";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "evx-launcher-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const write = (file: string, text = "x") => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

describe("arguments", () => {
  it("reads commands and options, in either --flag value or --flag=value form", () => {
    expect(parseArgs([])).toMatchObject({ command: "start", open: true, port: null, data: null });
    expect(parseArgs(["--port", "3300", "--no-open", "--data=~/work"])).toMatchObject({ command: "start", port: 3300, open: false, data: "~/work" });
    expect(parseArgs(["validate", "help-desk", "answers.jsonl"])).toMatchObject({ command: "validate", rest: ["help-desk", "answers.jsonl"] });
    // A subcommand's own options pass through untouched, even one named like the launcher's (--version).
    expect(parseArgs(["example-agent", "--version=v2"])).toMatchObject({ command: "example-agent", version: false, rest: ["--version=v2"] });
    expect(parseArgs(["validate", "help-desk", "--data", "/tmp/evx"])).toMatchObject({ data: "/tmp/evx", rest: ["help-desk"] });
    expect(parseArgs(["mcp", "--url", "http://127.0.0.1:3200"]).url).toBe("http://127.0.0.1:3200");
    expect(parseArgs(["--help"]).command).toBe("help");
  });

  it("explains a wrong option instead of guessing", () => {
    expect(() => parseArgs(["--port", "nope"])).toThrow(UsageError);
    expect(() => parseArgs(["--data"])).toThrow(/needs a value/);
    expect(() => parseArgs(["strat"])).toThrow(/Unknown option or command: strat/);
  });

  it("checks the Node version", () => {
    expect(nodeTooOld("22.11.0")).toBe(true);
    expect(nodeTooOld("22.12.0")).toBe(false);
    expect(nodeTooOld("24.1.0")).toBe(false);
    expect(nodeTooOld("20.18.0")).toBe(true);
  });
});

describe("your folder", () => {
  it("is ~/Evalxiety unless --data or EVALXIETY_HOME says otherwise", () => {
    const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;
    expect(homeDir({ data: null }, env({}))).toBe(path.join(os.homedir(), "Evalxiety"));
    expect(homeDir({ data: null }, env({ EVALXIETY_HOME: "/srv/evx" }))).toBe(path.resolve("/srv/evx"));
    expect(homeDir({ data: "~/team-evals" }, env({ EVALXIETY_HOME: "/srv/evx" }))).toBe(path.join(os.homedir(), "team-evals"));
  });

  it("seeds the demo once, never over your work, and refreshes only the starter kit", () => {
    const seed = path.join(tmp, "seed");
    write(path.join(seed, "data", "traces", "t1.json"), "{}");
    write(path.join(seed, "data", "run.tmp"), "half-written");
    write(path.join(seed, "agents", "example-support-bot", "agent.json"), "v1");
    write(path.join(seed, "agents", "_template", "agent.json"), "t");
    const home = path.join(tmp, "home");

    const first = prepareHome(home, seed);
    expect(first.seeded).toBe(true);
    expect(existsSync(path.join(home, "data", "traces", "t1.json"))).toBe(true);
    expect(existsSync(path.join(home, "data", "run.tmp"))).toBe(false);
    expect(readFileSync(path.join(home, "README.txt"), "utf8")).toMatch(/Nothing in it is sent anywhere/);

    // Your work since, and your own agent; then a new version of the starter kit ships.
    write(path.join(home, "data", "annotations.json"), "[mine]");
    write(path.join(home, "agents", "my-bot", "agent.json"), "mine");
    write(path.join(home, "agents", "example-support-bot", "notes.txt"), "edited by hand");
    write(path.join(seed, "agents", "example-support-bot", "agent.json"), "v2");

    expect(prepareHome(home, seed).seeded).toBe(false);
    expect(readFileSync(path.join(home, "data", "annotations.json"), "utf8")).toBe("[mine]");
    expect(readFileSync(path.join(home, "agents", "my-bot", "agent.json"), "utf8")).toBe("mine");
    expect(readFileSync(path.join(home, "agents", "example-support-bot", "agent.json"), "utf8")).toBe("v2");
    expect(existsSync(path.join(home, "agents", "example-support-bot", "notes.txt"))).toBe(false);
  });

  it("leaves no half-copied folder behind and seeds an empty folder", () => {
    const to = path.join(tmp, "empty-target");
    mkdirSync(to);
    expect(seedData(path.join(tmp, "no-such-seed"), to)).toBe(true);
    expect(seedData(path.join(tmp, "seed", "data"), to)).toBe(true); // still empty, so seeded now
    expect(existsSync(path.join(to, "traces", "t1.json"))).toBe(true);
    expect(existsSync(`${to}.seeding-${process.pid}`)).toBe(false);
  });

  it("reads settings.env like .env.local", () => {
    expect(parseEnvFile('# live mode\nMOCK_MODE=false\nLIVE_SPEND_CAP_USD="5"  \nexport NAME=a b # note\nnot a line\n')).toEqual({
      MOCK_MODE: "false",
      LIVE_SPEND_CAP_USD: "5",
      NAME: "a b",
    });
  });
});

describe("the server", () => {
  it("always binds to loopback and your folders, whatever the shell or settings say", () => {
    const home = path.join(tmp, "env-home");
    write(path.join(home, "settings.env"), "LIVE_SPEND_CAP_USD=3\nEVALXIETY_DATA_DIR=/elsewhere\nHOSTNAME=0.0.0.0\n");
    const env: Record<string, string> = serverEnv({ home, data: path.join(home, "data"), agents: path.join(home, "agents"), settings: path.join(home, "settings.env") }, 3123, {
      HOSTNAME: "my-laptop",
      LIVE_SPEND_CAP_USD: "7",
    } as unknown as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ HOSTNAME: "127.0.0.1", PORT: "3123", EVALXIETY_DATA_DIR: path.join(home, "data"), EVALXIETY_LAUNCHER: "npx", NODE_ENV: "production" });
    // Your own environment wins over settings.env.
    expect(env.LIVE_SPEND_CAP_USD).toBe("7");
  });

  it("refuses a port that's taken and otherwise finds a free one", async () => {
    const busy = net.createServer();
    await new Promise<void>((r) => busy.listen(0, "127.0.0.1", () => r()));
    const port = (busy.address() as net.AddressInfo).port;
    await expect(pickPort(port)).rejects.toThrow(/Port \d+ is in use/);
    busy.close();
    expect(await pickPort(null)).toBeGreaterThanOrEqual(3123);
  });

  it("names the right commands and settings file for how it was started", () => {
    expect(launcher()).toBe("repo");
    expect(runWords("npx")).toMatchObject({ start: "npx evalxiety", settingsFile: expect.stringMatching(/settings\.env/) });
    expect(runWords("repo").settingsFile).toBe(".env.local");
  });
});

describe("the package check", () => {
  it("refuses env files, private data, other people's agents and credentials", () => {
    const pkg = path.join(tmp, "pkg");
    write(path.join(pkg, "bin", "evalxiety.mjs"), "ok");
    write(path.join(pkg, "seed", "agents", "example-support-bot", "agent.json"), "{}");
    expect(verifyPackage(pkg)).toEqual([]);
    write(path.join(pkg, "app", ".env.local"), "X=1");
    write(path.join(pkg, "seed", "data", "private", "ai-connection.json"), "{}");
    write(path.join(pkg, "seed", "agents", "my-bot", "agent.json"), "{}");
    write(path.join(pkg, "app", "agents", "x", "agent.json"), "{}");
    write(path.join(pkg, "app", "chunk.js"), `const k = "sk-ant-api03-${"a".repeat(40)}";`);
    const problems = verifyPackage(pkg).join("\n");
    expect(problems).toMatch(/app\/\.env\.local: an env file/);
    expect(problems).toMatch(/seed\/data\/private\/ai-connection\.json: the app's private data/);
    expect(problems).toMatch(/seed\/agents\/my-bot\/agent\.json: an agent folder other than/);
    expect(problems).toMatch(/app\/agents\/x\/agent\.json: agent folders inside the prebuilt server/);
    expect(problems).toMatch(/app\/chunk\.js: contains what looks like an Anthropic API key/);
  });
});
