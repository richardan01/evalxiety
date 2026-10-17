/**
 * Pure parsing and validation of an import file (JSONL, one trace per line). Shared by the import endpoint and
 * the offline `npm run validate` CLI, so both report exactly the same problems with the same line numbers.
 */
import { sha256 } from "../storage/store";
import type { FrozenVersion, HeldoutState } from "./schemas";
import { formatZodIssues, jsonError } from "./config";
import { ImportedTraceLine, type AgentCase, type LoadedAgent } from "./schemas";

export interface ImportProblem {
  line: number;
  message: string;
}

export interface ParsedImport {
  lines: Array<{ line: number; value: ImportedTraceLine }>;
  problems: ImportProblem[];
  /** Locked cases present in the file (refused until the audited reveal). */
  heldout_case_ids: string[];
  /** Visible cases with no line in the file (the run will be incomplete). */
  missing_case_ids: string[];
}

/**
 * Hash of what defines each case (id, input, expected, split). A run is pinned to it; changing any of these makes old
 * runs incomparable. Reviewer notes are left out, so editing a note doesn't force a re-freeze.
 */
/** Code-point order: the same file must hash the same under every locale. */
const byId = (a: AgentCase, b: AgentCase) => (a.case_id < b.case_id ? -1 : a.case_id > b.case_id ? 1 : 0);

/** Identifies a case's content regardless of its id, so a renamed or re-used held-out case is still recognised. */
export function caseInputHash(input: unknown): string {
  return sha256({ input });
}

export interface LockState {
  /** case_id → why the case can't be imported or run right now. */
  locked: Map<string, string>;
  /** Held-out cases whose current content was revealed. */
  revealed: Set<string>;
  /** Dev cases that were held out (same id or same content) in a frozen version and never revealed. */
  movedToDev: string[];
}

/**
 * The single rule for what may be traced. A held-out case is locked until its current content (input hash) is
 * revealed. A dev case is locked too if it was held out — by id or by content — in any frozen version and never
 * revealed: moving or renaming a held-out case into dev can't be used to look at it early. Reveals are keyed by
 * content, so new content under a revealed id stays locked, and revealed content keeps its reveal if renamed.
 */
export function computeLockState(agent: LoadedAgent, frozen: FrozenVersion[], heldout: HeldoutState): LockState {
  const revealedHashes = new Set(heldout.revealed_cases.map((c) => c.input_hash));
  const heldIds = new Set<string>();
  const heldHashes = new Set<string>();
  // Current held-out content counts from the very first run (before anything is frozen): a dev copy is locked too.
  for (const c of agent.cases) {
    const h = caseInputHash(c.input);
    if (c.split === "heldout" && !revealedHashes.has(h)) heldHashes.add(h);
  }
  for (const f of frozen) {
    for (const h of f.heldout_cases) {
      if (revealedHashes.has(h.input_hash)) continue;
      heldIds.add(h.case_id);
      heldHashes.add(h.input_hash);
    }
  }
  const locked = new Map<string, string>();
  const revealed = new Set<string>();
  const movedToDev: string[] = [];
  for (const c of agent.cases) {
    const hash = caseInputHash(c.input);
    if (c.split === "heldout") {
      if (revealedHashes.has(hash)) revealed.add(c.case_id);
      else locked.set(c.case_id, `"${c.case_id}" is held out. It stays locked until you reveal it (agent page → Cases), so you can't tune on it.`);
    } else if (!revealedHashes.has(hash) && (heldHashes.has(hash) || heldIds.has(c.case_id))) {
      movedToDev.push(c.case_id);
      locked.set(
        c.case_id,
        `"${c.case_id}" was held out in an earlier frozen version and never revealed, so it can't be run as a dev case. Move it back to "split": "heldout".`,
      );
    }
  }
  return { locked, revealed, movedToDev };
}

export function hashAgentCases(cases: AgentCase[]): string {
  const sorted = [...cases]
    .sort(byId)
    .map((c) => ({ case_id: c.case_id, input: c.input, expected: c.expected, split: c.split }));
  return sha256({ cases: sorted });
}

/** Cases a run may cover right now (everything not locked). */
export function visibleCases(agent: LoadedAgent, lock: LockState): AgentCase[] {
  return agent.cases.filter((c) => !lock.locked.has(c.case_id));
}

/** Locked held-out cases: the ones a reveal would unlock. */
export function revealableCases(agent: LoadedAgent, lock: LockState): AgentCase[] {
  return agent.cases.filter((c) => c.split === "heldout" && lock.locked.has(c.case_id));
}

export const MAX_IMPORT_BYTES = 9 * 1024 * 1024;

export function parseImport(text: string, agent: LoadedAgent, lock: LockState): ParsedImport {
  const problems: ImportProblem[] = [];
  const lines: ParsedImport["lines"] = [];
  const byId = new Map(agent.cases.map((c) => [c.case_id, c]));
  const seen = new Map<string, number>();
  const heldout = new Set<string>();

  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    return { lines: [], problems: [{ line: 0, message: `File is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.` }], heldout_case_ids: [], missing_case_ids: [] };
  }

  text.replace(/^\uFEFF/, "").split("\n").forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      problems.push({ line, message: `Not valid JSON: ${jsonError(e)}. Each line must be one complete JSON object.` });
      return;
    }
    const parsed = ImportedTraceLine.safeParse(json);
    if (!parsed.success) {
      problems.push({ line, message: formatZodIssues(parsed.error) });
      return;
    }
    const v = parsed.data;
    const c = byId.get(v.case_id);
    if (!c) {
      const known = agent.cases.slice(0, 5).map((x) => x.case_id).join(", ");
      problems.push({ line, message: `case_id "${v.case_id}" is not in agents/${agent.agent_id}/cases.jsonl (known ids include: ${known}${agent.cases.length > 5 ? ", …" : ""}).` });
      return;
    }
    const prev = seen.get(v.case_id);
    if (prev !== undefined) {
      problems.push({ line, message: `case_id "${v.case_id}" appears twice (first on line ${prev}). A run has one trace per case.` });
      return;
    }
    seen.set(v.case_id, line);
    const why = lock.locked.get(c.case_id);
    if (why) {
      heldout.add(v.case_id);
      problems.push({ line, message: why });
      return;
    }
    lines.push({ line, value: v });
  });

  if (lines.length === 0 && problems.length === 0) problems.push({ line: 0, message: "The file has no trace lines." });
  const missing = visibleCases(agent, lock)
    .map((c) => c.case_id)
    .filter((id) => !seen.has(id));
  return { lines, problems, heldout_case_ids: [...heldout], missing_case_ids: missing };
}
