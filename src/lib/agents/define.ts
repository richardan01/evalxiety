/**
 * Defining "good" without JSON: the pure, client-safe pieces the agent page's editors and the server share.
 *
 *   - what a test case's input looks like (plain text, one text field, or JSON), so a person types a question and the
 *     case gets the same shape as the others;
 *   - the next free case ids;
 *   - rule ids from a plain-words question, and a "must (not) contain these phrases" pattern from a list of phrases;
 *   - the rule types a person can add in the app, with plain names.
 */
import type { CheckType } from "./schemas";

// ---------------------------------------------------------------------------
// Case inputs
// ---------------------------------------------------------------------------

/** text = the input is the question itself; field = { [key]: question }; json = anything else (edited as JSON). */
export type InputShape = { kind: "text" } | { kind: "field"; key: string } | { kind: "json" };

const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The shape every given input shares. No inputs (a new agent) = plain text. */
export function inputShape(inputs: unknown[]): InputShape {
  if (inputs.every((i) => typeof i === "string")) return { kind: "text" };
  const first = inputs[0];
  if (isPlainObject(first)) {
    const keys = Object.keys(first);
    if (keys.length === 1 && inputs.every((i) => isPlainObject(i) && Object.keys(i).length === 1 && typeof i[keys[0]] === "string")) {
      return { kind: "field", key: keys[0] };
    }
  }
  return { kind: "json" };
}

/** A typed question as an input of this shape. For json, the text must be JSON. Throws with a plain message. */
export function inputFromText(shape: InputShape, text: string): unknown {
  if (shape.kind === "text") return text;
  if (shape.kind === "field") return { [shape.key]: text };
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("This agent's inputs are JSON: write the input as JSON (look at another case for the shape).");
  }
}

/** The text a person edits for an input of this shape. */
export function textFromInput(shape: InputShape, input: unknown): string {
  if (shape.kind === "text" && typeof input === "string") return input;
  if (shape.kind === "field" && isPlainObject(input) && typeof input[shape.key] === "string") return input[shape.key] as string;
  return JSON.stringify(input, null, 2);
}

/**
 * How reference answers are written: text = the reference is plain text; answer = { answer: text } (what a spreadsheet
 * of questions produces, and the default); json = anything richer (e.g. { "escalate": true }), edited as JSON.
 */
export type ExpectedShape = "text" | "answer" | "json";

export function expectedShape(values: unknown[]): ExpectedShape {
  const given = values.filter((v) => v !== undefined && v !== null);
  if (given.some((v) => isPlainObject(v) && !(Object.keys(v).length === 1 && typeof v.answer === "string")) || given.some((v) => typeof v !== "string" && !isPlainObject(v))) return "json";
  if (given.some((v) => typeof v === "string")) return "text";
  return "answer";
}

/** The reference answer from what a person typed; blank = no reference answer. Throws on invalid JSON. */
export function expectedFromText(shape: ExpectedShape, text: string): unknown {
  if (!text.trim()) return undefined;
  if (shape === "text") return text;
  if (shape === "answer") return { answer: text };
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Write the reference answer as JSON, like the other cases (e.g. {\"escalate\": true}).");
  }
}

export function textFromExpected(shape: ExpectedShape, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (shape === "text" && typeof value === "string") return value;
  if (shape === "answer" && isPlainObject(value) && typeof value.answer === "string") return value.answer;
  return JSON.stringify(value, null, 2);
}

/**
 * `n` new case ids continuing the most common numbering (q07 → q08, q09; c01–c09 beside h01–h03 → c10), skipping any id
 * already taken.
 */
export function nextCaseIds(existing: string[], n: number): string[] {
  const numbered = existing.map((id) => /^(.*?)(\d+)$/.exec(id)).filter((m): m is RegExpExecArray => m !== null);
  const count = new Map<string, number>();
  for (const m of numbered) count.set(m[1], (count.get(m[1]) ?? 0) + 1);
  const prefix = [...count].reduce<[string, number] | null>((best, cur) => (!best || cur[1] >= best[1] ? cur : best), null)?.[0] ?? "c";
  const width = numbered.filter((m) => m[1] === prefix).at(-1)?.[2].length ?? 2;
  let i = Math.max(0, ...numbered.filter((m) => m[1] === prefix).map((m) => Number(m[2])));
  const taken = new Set(existing);
  const out: string[] = [];
  while (out.length < n) {
    const id = `${prefix}${String(++i).padStart(width, "0")}`;
    if (!taken.has(id)) {
      taken.add(id);
      out.push(id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** A rule id from its question: "Does the answer avoid promising refunds?" → "answer_avoid_promising_refunds". */
export function ruleIdFrom(question: string, taken: string[]): string {
  const STOP = new Set(["a", "an", "the", "does", "do", "is", "are", "it", "its", "of", "to", "and", "or", "in", "on", "for", "with", "that", "this"]);
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  let base = "";
  for (const w of words) {
    if ((base ? base.length + 1 : 0) + w.length > 40) break;
    base = base ? `${base}_${w}` : w;
  }
  base ||= "rule";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Phrases (one per line) as one pattern that finds any of them as whole words: "guarantee\nno questions asked" → \b(guarantee|no questions asked)\b. */
export function phrasesToPattern(text: string): string {
  const phrases = [...new Set(text.split("\n").map((p) => p.trim()).filter(Boolean))];
  if (!phrases.length) return "";
  const parts = phrases.map((p) => escapeRegex(p).replace(/\s+/g, "\\s+"));
  // \b only next to a word character: a phrase like "$100" or "100%" must still be found.
  const alt = parts.length === 1 ? parts[0] : `(${parts.join("|")})`;
  const startWord = phrases.every((p) => /^\w/.test(p));
  const endWord = phrases.every((p) => /\w$/.test(p));
  return `${startWord ? "\\b" : ""}${alt}${endWord ? "\\b" : ""}`;
}

/** The phrases a pattern made by phrasesToPattern stands for, or null when it's a hand-written expression. */
export function patternToPhrases(pattern: string): string | null {
  const body = pattern.replace(/^\\b/, "").replace(/\\b$/, "");
  const inner = body.startsWith("(") && body.endsWith(")") ? body.slice(1, -1) : body;
  const phrases = inner
    .split("|")
    .map((part) => part.replace(/\\s\+/g, " ").replace(/\\([.*+?^${}()|[\]\\])/g, "$1"))
    .join("\n");
  // Only if turning the phrases back into a pattern gives this one (anything else is a hand-written expression). A plain
  // space counts as \s+, which the phrases' pattern uses so a line break or double space between words still matches.
  return phrases && phrasesToPattern(phrases) === pattern.replace(/ /g, "\\s+") ? phrases : null;
}

/** Rule types a person can add from the agent page, in plain words. Custom rules run code, so they're added in code. */
export const EDITABLE_RULE_TYPES: Array<{ type: Exclude<CheckType, "custom">; label: string; hint: string }> = [
  { type: "regex", label: "Must (not) contain certain words", hint: "Banned promises, leaked secrets, a required disclaimer." },
  { type: "non_empty", label: "Must fill in a field", hint: "Fails when this part of the answer is blank. (A wholly empty answer already fails every rule.)" },
  { type: "max_length", label: "Not longer than…", hint: "A word or character limit." },
  { type: "matches_expected", label: "Matches the reference answer", hint: "Compares with each test case's reference answer." },
  { type: "json_output", label: "Has these fields", hint: "The answer is JSON with these fields filled in." },
  { type: "cites_evidence", label: "Only cites sources it was given", hint: "Every cited id is in the evidence the agent received." },
  { type: "max_latency_ms", label: "Answers fast enough", hint: "A time limit per answer, in milliseconds." },
  { type: "max_cost_usd", label: "Costs at most…", hint: "A cost limit per answer, in US dollars." },
  { type: "no_tool_errors", label: "No tool errors", hint: "Fails when a tool call in the answer reports an error." },
];
