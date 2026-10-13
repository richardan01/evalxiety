/**
 * Human-review target for this demo. Error analysis normally needs far more traces
 * (the evals FAQ suggests ~100); 5–10 is enough to demonstrate the workflow, not to
 * characterise the agent. The release gate requires at least `min`.
 */
export const REVIEW_TARGET: { readonly min: number; readonly max: number } = { min: 5, max: 10 };
