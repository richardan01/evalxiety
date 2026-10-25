/**
 * Plain-language names for the method's terms. The UI leads with the plain word and keeps the technical one in the
 * definition, so a product manager can read a page and an engineer can still map it to the docs.
 */
export const GLOSSARY = {
  trace: { term: "Answer (trace)", def: "One recorded answer from the agent: the question it got, the evidence it was given, what it said, cost and time." },
  case: { term: "Test case", def: "One question the agent is tested on, from cases.jsonl. The same cases are used for every version, so results are comparable." },
  run: { term: "Test (run)", def: "One version of the agent answering every test case." },
  baseline: { term: "Current version (baseline)", def: "The version you ship today. Every change is compared with it, so you can see what got worse." },
  candidate: { term: "New version (candidate)", def: "The change you want to ship. The release decision is about this version." },
  heldout: {
    term: "Final-exam cases (held out)",
    def: "Test cases kept hidden while you improve the agent. Unlocking them is logged and can't be undone, so the final score is on questions nobody tuned for.",
  },
  freeze: { term: "Lock the cases (freeze)", def: "Fixes the exact set of test cases, so two versions are only compared on identical questions." },
  check: { term: "Rule (code check)", def: "An automatic yes/no test on every answer, e.g. 'cites only the evidence it was given'. Rules are objective; no AI is involved." },
  judge: {
    term: "AI reviewer (LLM judge)",
    def: "Claude answering one narrow yes/no question about each answer. Experimental until it agrees with your own labels often enough; it never replaces your review.",
  },
  tpr: { term: "Catches real problems (TPR)", def: "Of the answers you marked as a problem, how many the AI reviewer also flagged." },
  tnr: { term: "Avoids false alarms (TNR)", def: "Of the answers you marked as fine, how many the AI reviewer also cleared." },
  pass_all: { term: "Passed every rule (pass-all)", def: "Share of test cases where every rule passed. Never an average score, so one bad case can't hide behind good ones." },
  regression: { term: "Got worse (regression)", def: "A case that passed in the current version and fails in the new one." },
  gate: { term: "Release decision (gate)", def: "Turns the evidence into No ship, Not enough evidence, Ready for your decision, or Approved by a named person." },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
