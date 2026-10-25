/**
 * Spreadsheets in, for people who keep test questions and agent answers in a sheet rather than in JSONL.
 *
 * Pure and client-safe. Reads CSV, TSV (what you get when you copy cells from Google Sheets or Excel) and
 * semicolon-separated files, with quoted cells that contain commas, quotes or line breaks. The first row is the header.
 * Two conversions:
 *   - casesFromTable: a sheet of questions → cases.jsonl (the wizard);
 *   - tracesFromTable: a sheet of answers → the import JSONL, each row matched to a test case by its case id or by its
 *     question text (the agent page). Rows for locked final-exam cases are left out and counted, never imported.
 */
export interface Table {
  header: string[];
  /** Data rows (header excluded), each padded to the header's length. */
  rows: string[][];
  delimiter: "," | "\t" | ";";
}

export const MAX_TABLE_ROWS = 5000;

function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

/** The delimiter used by the header line: tab, comma or semicolon, whichever splits it most. */
export function detectDelimiter(text: string): Table["delimiter"] {
  const first = text.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = (["\t", ",", ";"] as const).map((d) => [d, countOutsideQuotes(first, d)] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ",";
}

/** Parse a CSV/TSV text. Throws with a plain message when it isn't a usable table. */
export function parseTable(text: string): Table {
  const src = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(src);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("A quoted cell is never closed: check for a stray double quote (\").");
  if (cell !== "" || row.length) {
    row.push(cell);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((x) => x.trim() !== ""));
  if (nonEmpty.length < 2) throw new Error("The sheet needs a header row and at least one row below it.");
  if (nonEmpty.length - 1 > MAX_TABLE_ROWS) throw new Error(`The sheet has more than ${MAX_TABLE_ROWS} rows. Split it into smaller files.`);
  const header = nonEmpty[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = nonEmpty.slice(1).map((r) => header.map((_, i) => r[i] ?? ""));
  return { header, rows, delimiter };
}

/** Best guess at the column whose header matches one of these words, or null. */
export function guessColumn(header: string[], words: RegExp): number | null {
  const i = header.findIndex((h) => words.test(h));
  return i >= 0 ? i : null;
}

export const QUESTION_WORDS = /question|input|prompt|query|message|request|ask/i;
export const ANSWER_WORDS = /answer|response|reply|output|result|completion/i;
export const CASE_ID_WORDS = /^\s*(case[\s_-]?id|id)\s*$/i;

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// ---------------------------------------------------------------------------
// Questions → cases.jsonl
// ---------------------------------------------------------------------------

export interface CasesMapping {
  question: number;
  /** "What this case tests", shown to reviewers. */
  notes?: number | null;
  /** A reference answer, stored as expected.answer: shown to reviewers, and usable by a matches_expected rule. */
  expected?: number | null;
  /** The input field the question goes in (e.g. "question"); null sends the bare string. */
  input_key: string | null;
  /** Hold out every 5th question for the final check (needs at least 5). */
  holdout: boolean;
}

export function casesFromTable(table: Table, m: CasesMapping): { jsonl: string; count: number; heldout: number; skipped_blank: number } {
  const rows = table.rows.filter((r) => r[m.question]?.trim());
  const width = Math.max(2, String(rows.length).length);
  let heldout = 0;
  const lines = rows.map((r, i) => {
    const q = r[m.question].trim();
    const held = m.holdout && rows.length >= 5 && (i + 1) % 5 === 0;
    if (held) heldout++;
    const notes = m.notes != null ? r[m.notes]?.trim() : "";
    const expected = m.expected != null ? r[m.expected]?.trim() : "";
    return JSON.stringify({
      case_id: `q${String(i + 1).padStart(width, "0")}`,
      ...(held ? { split: "heldout" } : {}),
      input: m.input_key ? { [m.input_key]: q } : q,
      ...(expected ? { expected: { answer: expected } } : {}),
      ...(notes ? { notes } : {}),
    });
  });
  return { jsonl: lines.length ? lines.join("\n") + "\n" : "", count: lines.length, heldout, skipped_blank: table.rows.length - rows.length };
}

// ---------------------------------------------------------------------------
// Answers → import JSONL
// ---------------------------------------------------------------------------

export interface TracesMapping {
  answer: number;
  /**
   * Store each answer as { [answer_field]: text } instead of plain text, so rules that read a field (e.g. `answer`) see
   * the same shape as answers that came over HTTP. Null or absent: plain text.
   */
  answer_field?: string | null;
  /** Match rows to cases by this column's case id… */
  case_id?: number | null;
  /** …or else by this column's question text. */
  question?: number | null;
}

export interface TableProblem {
  /** Line in the file: the header is line 1. */
  line: number;
  message: string;
}

/** The text a case's input can be matched on: the input itself if it's text, else each of its top-level text fields. */
function questionTexts(input: unknown): string[] {
  if (typeof input === "string") return [input];
  if (input && typeof input === "object" && !Array.isArray(input)) return Object.values(input).filter((v): v is string => typeof v === "string");
  return [];
}

export function tracesFromTable(
  table: Table,
  cases: Array<{ case_id: string; input: unknown }>,
  locked: Set<string>,
  m: TracesMapping,
): { jsonl: string; lines: number; problems: TableProblem[]; skipped_locked: string[] } {
  const problems: TableProblem[] = [];
  if (m.answer < 0 || m.answer >= table.header.length) problems.push({ line: 1, message: "Pick the column that holds the agent's answers." });
  const byId = new Map(cases.map((c) => [c.case_id, c]));
  const byQuestion = new Map<string, string[]>();
  for (const c of cases) {
    for (const t of new Set(questionTexts(c.input).map(normalize))) byQuestion.set(t, [...(byQuestion.get(t) ?? []), c.case_id]);
  }
  if (m.case_id == null && m.question == null) problems.push({ line: 1, message: "Pick how to match rows to test cases: a case id column or a question column." });
  if (problems.length) return { jsonl: "", lines: 0, problems, skipped_locked: [] };

  const out: string[] = [];
  const skipped = new Set<string>();
  table.rows.forEach((r, i) => {
    const line = i + 2;
    let caseId: string | null = null;
    if (m.case_id != null) {
      const id = r[m.case_id]?.trim() ?? "";
      if (!id) return void problems.push({ line, message: "This row has no case id." });
      if (!byId.has(id)) return void problems.push({ line, message: `No test case has the id “${id}”.` });
      caseId = id;
    } else {
      const q = r[m.question!]?.trim() ?? "";
      if (!q) return void problems.push({ line, message: "This row has no question." });
      const hits = byQuestion.get(normalize(q)) ?? [];
      if (hits.length === 0) return void problems.push({ line, message: `No test case has the question “${q.length > 80 ? `${q.slice(0, 80)}…` : q}”.` });
      if (hits.length > 1) return void problems.push({ line, message: `More than one test case has this question (${hits.join(", ")}). Add a case id column to tell them apart.` });
      caseId = hits[0];
    }
    if (locked.has(caseId)) {
      skipped.add(caseId);
      return;
    }
    const text = r[m.answer] ?? "";
    out.push(JSON.stringify({ case_id: caseId, output: m.answer_field ? { [m.answer_field]: text } : text }));
  });
  return { jsonl: out.join("\n"), lines: out.length, problems, skipped_locked: [...skipped] };
}

/** True when pasted or uploaded text is a sheet rather than JSONL (every JSONL line starts with "{"). */
export function looksLikeTable(text: string): boolean {
  const first = text.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim());
  return Boolean(first && !first.trim().startsWith("{"));
}
