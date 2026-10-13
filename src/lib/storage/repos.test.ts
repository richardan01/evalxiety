import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  appendTaxonomyVersion,
  getHeldoutState,
  latestTaxonomy,
  listAudit,
  revealHeldout,
  TaxonomyConflictError,
  upsertAnnotation,
  validateAnnotationInput,
  type AnnotationInput,
} from "./repos";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenttrust-repos-"));
  process.env.AGENTTRUST_DATA_DIR = dir;
});
afterAll(async () => fs.rm(dir, { recursive: true, force: true }));

const base: AnnotationInput = {
  trace_id: "trace_x",
  case_id: "C01",
  reviewer: "  rich  ",
  open_coding_notes: "Used the old policy.",
  task_outcome: "fail",
  first_failure: { description: "Stale policy", failure_mode_id: null },
  additional_failure_mode_ids: [],
  severity: "critical",
  unsupported_justification_label: "absent",
  taxonomy_version: 1,
};

describe("annotation invariants", () => {
  it("trims the reviewer and stores label_source human", async () => {
    const a = await upsertAnnotation(base);
    expect(a.reviewer).toBe("rich");
    expect(a.label_source).toBe("human");
  });
  it("rejects anonymous labels, failures without a first failure/severity, and passes with failure fields", () => {
    expect(() => validateAnnotationInput({ ...base, reviewer: "   " })).toThrow(/reviewer/);
    expect(() => validateAnnotationInput({ ...base, first_failure: null })).toThrow(/first-failure/);
    expect(() => validateAnnotationInput({ ...base, severity: null })).toThrow(/severity/);
    expect(() => validateAnnotationInput({ ...base, task_outcome: "pass" })).toThrow(/passing/);
    expect(() => validateAnnotationInput({ ...base, open_coding_notes: " " })).toThrow(/note/);
    // A pass may be saved without notes (one-tap review).
    expect(() => validateAnnotationInput({ ...base, task_outcome: "pass", first_failure: null, severity: null, open_coding_notes: "" })).not.toThrow();
  });
});

describe("taxonomy optimistic concurrency", () => {
  it("rejects a change computed from an outdated version", async () => {
    const v1 = await latestTaxonomy();
    await appendTaxonomyVersion("a", "first", v1.failure_modes, v1.version);
    await expect(appendTaxonomyVersion("b", "second (stale)", v1.failure_modes, v1.version)).rejects.toBeInstanceOf(TaxonomyConflictError);
    expect((await latestTaxonomy()).version).toBe(v1.version + 1);
  });
});

describe("held-out reveal", () => {
  it("is irreversible and idempotent: the first reveal is kept and audited once", async () => {
    expect((await getHeldoutState()).revealed).toBe(false);
    const first = await revealHeldout("rich", "final check of the corrected config");
    const second = await revealHeldout("someone-else", "another reason entirely");
    expect(second).toEqual(first);
    expect((await listAudit()).filter((e) => e.action === "heldout.revealed")).toHaveLength(1);
  });
});
