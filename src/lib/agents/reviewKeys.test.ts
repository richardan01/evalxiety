import { describe, expect, it } from "vitest";
import { reviewKeyAction } from "./reviewKeys";

const key = (k: string, over: Partial<Parameters<typeof reviewKeyAction>[0]> = {}) => ({ key: k, inField: false, ...over });
const ctx = { failing: false, hasJudge: false };

describe("review keyboard shortcuts", () => {
  it("marks pass, fail and not sure, upper or lower case", () => {
    expect(reviewKeyAction(key("p"), ctx)).toEqual({ type: "outcome", value: "pass" });
    expect(reviewKeyAction(key("F"), ctx)).toEqual({ type: "outcome", value: "fail" });
    expect(reviewKeyAction(key("u"), ctx)).toEqual({ type: "outcome", value: "unsure" });
  });

  it("sets severity only on a fail, and answers the AI reviewer's question only when there is one", () => {
    expect(reviewKeyAction(key("1"), ctx)).toBeNull();
    expect(reviewKeyAction(key("1"), { ...ctx, failing: true })).toEqual({ type: "severity", value: "critical" });
    expect(reviewKeyAction(key("3"), { ...ctx, failing: true })).toEqual({ type: "severity", value: "minor" });
    expect(reviewKeyAction(key("y"), ctx)).toBeNull();
    expect(reviewKeyAction(key("n"), { ...ctx, hasJudge: true })).toEqual({ type: "judge", value: "absent" });
  });

  it("saves with Enter, moves with J/K or the arrows, and toggles help", () => {
    expect(reviewKeyAction(key("Enter"), ctx)).toEqual({ type: "save" });
    expect(reviewKeyAction(key("j"), ctx)).toEqual({ type: "go", to: "next" });
    expect(reviewKeyAction(key("ArrowLeft"), ctx)).toEqual({ type: "go", to: "prev" });
    expect(reviewKeyAction(key("?"), ctx)).toEqual({ type: "help" });
  });

  it("never hijacks typing or browser shortcuts", () => {
    expect(reviewKeyAction(key("p", { inField: true }), ctx)).toBeNull();
    expect(reviewKeyAction(key("Enter", { inField: true }), ctx)).toBeNull();
    expect(reviewKeyAction(key("Escape", { inField: true }), ctx)).toEqual({ type: "leave_field" });
    expect(reviewKeyAction(key("f", { metaKey: true }), ctx)).toBeNull();
    expect(reviewKeyAction(key("p", { ctrlKey: true }), ctx)).toBeNull();
    // Enter on a focused button or link activates it, as it always does.
    expect(reviewKeyAction(key("Enter", { onControl: true }), ctx)).toBeNull();
    // Ctrl/Cmd+Enter saves from anywhere, a text field included.
    expect(reviewKeyAction(key("Enter", { metaKey: true, inField: true }), ctx)).toEqual({ type: "save" });
  });
});
