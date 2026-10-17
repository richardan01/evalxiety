/**
 * Local JSON storage. One process, atomic writes (tmp file + rename) and an
 * in-process per-file lock so concurrent route handlers cannot clobber each
 * other's read-modify-write cycles.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { z } from "zod";

export function dataDir(): string {
  return process.env.AGENTTRUST_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

function abs(rel: string): string {
  return path.join(/*turbopackIgnore: true*/ dataDir(), rel);
}

const locks = new Map<string, Promise<unknown>>();

/** Serialise all read-modify-write operations on one file. */
export async function withLock<T>(rel: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(rel) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(rel, run);
  try {
    return await run;
  } finally {
    if (locks.get(rel) === run) locks.delete(rel);
  }
}

export async function readJson<T>(rel: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(abs(rel), "utf8");
    return schema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

export async function writeJson(rel: string, value: unknown): Promise<void> {
  const file = abs(rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

export async function appendLine(rel: string, value: unknown): Promise<void> {
  const file = abs(rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(value) + "\n", "utf8");
}

export async function readLines<T>(rel: string, schema: z.ZodType<T>): Promise<T[]> {
  try {
    const raw = await fs.readFile(abs(rel), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => schema.parse(JSON.parse(l)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function listJsonFiles(relDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(abs(relDir));
    return entries.filter((e) => e.endsWith(".json")).map((e) => path.join(relDir, e));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Read-modify-write under the file lock. */
export async function updateJson<T>(
  rel: string,
  schema: z.ZodType<T>,
  fallback: T,
  mutate: (current: T) => T | Promise<T>,
): Promise<T> {
  return withLock(rel, async () => {
    const current = await readJson(rel, schema, fallback);
    const next = await mutate(current);
    schema.parse(next);
    await writeJson(rel, next);
    return next;
  });
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Stable JSON (sorted keys) so content hashes do not depend on key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function sha256(value: unknown): string {
  const s = typeof value === "string" ? value : stableStringify(value);
  return crypto.createHash("sha256").update(s).digest("hex");
}
