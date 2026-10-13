import { describe, expect, it } from "vitest";
import { paragraphDiff } from "./promptDiff";
import { systemPrompt } from "@/lib/agent/prompts";

describe("paragraphDiff", () => {
  it("aligns identical paragraphs and pairs a replaced paragraph into one changed row", () => {
    const rows = paragraphDiff("a\n\nb\n\nc", "a\n\nB2\n\nc");
    expect(rows).toEqual([
      { left: "a", right: "a", changed: false },
      { left: "b", right: "B2", changed: true },
      { left: "c", right: "c", changed: false },
    ]);
  });

  it("handles pure insertions and removals", () => {
    expect(paragraphDiff("a", "a\n\nnew")).toEqual([
      { left: "a", right: "a", changed: false },
      { left: null, right: "new", changed: true },
    ]);
    expect(paragraphDiff("a\n\nold", "a")).toEqual([
      { left: "a", right: "a", changed: false },
      { left: "old", right: null, changed: true },
    ]);
  });

  it("finds exactly one differing paragraph (policy selection) between baseline v1 and corrected v2 prompts", () => {
    const rows = paragraphDiff(systemPrompt("pricing-prompt-v1"), systemPrompt("pricing-prompt-v2"));
    const changed = rows.filter((r) => r.changed);
    expect(changed).toHaveLength(1);
    expect(changed[0].left).toMatch(/^Policy: use the pricing policy provided/);
    expect(changed[0].right).toMatch(/^Policy selection:/);
    expect(rows.filter((r) => !r.changed).length).toBeGreaterThan(0);
  });
});
