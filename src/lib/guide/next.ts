import type { DemoStep } from "@/app/_overview/demoPath";

/**
 * The step the guide should push next: the first untouched step, else the
 * release step until a human has approved (steps 5/6/9 are often untracked,
 * so "nothing left to do" must not be inferred from their neutral state).
 */
export function nextStep(steps: DemoStep[]): DemoStep | null {
  const todo = steps.find((s) => s.state === "todo");
  if (todo) return todo;
  const last = steps[steps.length - 1];
  return last && last.state !== "done" ? last : null;
}
