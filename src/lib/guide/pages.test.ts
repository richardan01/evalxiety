import { describe, expect, it } from "vitest";
import { agentIdOf, isDemoPath } from "./pages";
import { mockReply, type GuideState } from "./snapshot";

describe("guide pages", () => {
  it("tells demo pages from your own agents' pages", () => {
    expect(isDemoPath("/demo")).toBe(true);
    expect(isDemoPath("/review/gold")).toBe(true);
    expect(isDemoPath("/release")).toBe(true);
    expect(isDemoPath("/agents/support-bot")).toBe(false);
    expect(isDemoPath("/start")).toBe(false);
    expect(isDemoPath("/reviewer")).toBe(false);
    expect(agentIdOf("/agents/support-bot")).toBe("support-bot");
    expect(agentIdOf("/agents/support-bot/traces/atr_1")).toBe("support-bot");
    expect(agentIdOf("/agents/support-bot/report?candidate=r1")).toBe("support-bot");
    expect(agentIdOf("/agents")).toBeNull();
    expect(agentIdOf("/agents/../etc")).toBeNull();
  });

  it("offline answers lead with your agent's next step, not the demo's", () => {
    const state: GuideState = {
      mode: "mock",
      page: "/agents/support-bot",
      steps: [{ n: 1, title: "Execute a pricing case", detail: "run C04", href: "/review", state: "todo" }],
      agent: { agent_id: "support-bot", name: "Support bot", headline: "Not enough evidence to decide yet", summary: "", next: "Review 8 more answers.", href: "/agents/support-bot" },
      text: "",
    };
    const reply = mockReply("what's my next step?", state, "mock mode");
    expect(reply).toContain("**Support bot: Not enough evidence to decide yet.** Next: Review 8 more answers.");
    expect(reply).not.toContain("Execute a pricing case");
    expect(reply).toContain("Your agent's page");
  });
});
