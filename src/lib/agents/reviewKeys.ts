/**
 * Keyboard shortcuts on the review screen, as a pure mapping so they can be tested and listed in one place.
 *
 * Single keys act only when you're not typing in a field, and never with Ctrl, Cmd or Alt held, so browser shortcuts
 * keep working. Ctrl/Cmd+Enter saves from anywhere, including a text field; Esc leaves a field.
 */
export type ReviewAction =
  | { type: "outcome"; value: "pass" | "fail" | "unsure" }
  | { type: "severity"; value: "critical" | "major" | "minor" }
  | { type: "judge"; value: "present" | "absent" | "not_assessed" }
  | { type: "save" }
  | { type: "go"; to: "prev" | "next" }
  | { type: "help" }
  | { type: "leave_field" };

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Focus is in a text field, select or editable element. */
  inField: boolean;
  /** Focus is on a button or link: Enter activates it, as usual. */
  onControl?: boolean;
}

export interface KeyContext {
  /** The answer is marked as failing, so severity keys apply. */
  failing: boolean;
  /** The agent has an AI reviewer question to answer. */
  hasJudge: boolean;
}

export function reviewKeyAction(e: KeyInput, ctx: KeyContext): ReviewAction | null {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return { type: "save" };
  if (e.inField) return e.key === "Escape" ? { type: "leave_field" } : null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (k) {
    case "p":
      return { type: "outcome", value: "pass" };
    case "f":
      return { type: "outcome", value: "fail" };
    case "u":
      return { type: "outcome", value: "unsure" };
    case "1":
    case "2":
    case "3":
      return ctx.failing ? { type: "severity", value: (["critical", "major", "minor"] as const)[Number(k) - 1] } : null;
    case "y":
      return ctx.hasJudge ? { type: "judge", value: "present" } : null;
    case "n":
      return ctx.hasJudge ? { type: "judge", value: "absent" } : null;
    case "s":
      return ctx.hasJudge ? { type: "judge", value: "not_assessed" } : null;
    case "Enter":
      return e.onControl ? null : { type: "save" };
    case "j":
    case "ArrowRight":
      return { type: "go", to: "next" };
    case "k":
    case "ArrowLeft":
      return { type: "go", to: "prev" };
    case "?":
      return { type: "help" };
    default:
      return null;
  }
}

/** The list the help panel shows. */
export const SHORTCUTS: Array<[keys: string, what: string, judgeOnly?: boolean]> = [
  ["P", "Pass"],
  ["F", "Fail (then type the first thing that went wrong)"],
  ["U", "Not sure (then say what's unclear)"],
  ["1 2 3", "Severity of a fail: critical, major, minor"],
  ["Y N S", "Answer the AI reviewer's question: yes, no, skip", true],
  ["Enter", "Save and go to the next answer you haven't marked"],
  ["Ctrl/⌘ Enter", "Save from inside a text field"],
  ["Esc", "Leave a text field"],
  ["J  →", "Next answer"],
  ["K  ←", "Previous answer"],
  ["?", "Show or hide these shortcuts"],
];
