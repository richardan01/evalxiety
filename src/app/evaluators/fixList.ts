/**
 * "Fix" drill-down: which answers fail a given check, deduplicated to the latest
 * trace per (case, agent version), the version you would ship first.
 */
import type { EvaluatorResultRow } from "./types";

export const JUDGE_CHECK_ID = "unsupported_pricing_justification";

export interface FixItem {
  trace_id: string;
  case_id: string;
  version: string; // e.g. "corrected-v2"
  role: "corrected" | "baseline" | "other";
  split: EvaluatorResultRow["split"];
  outcome: string; // FAIL / ERROR / REQUIRES_REVIEW
  severity: string | null;
  reason: string;
  occurrences: number; // how many stored traces of this case+version fail this check
}

function failing(row: EvaluatorResultRow, checkId: string): { outcome: string; severity: string | null; reason: string } | null {
  if (checkId === JUDGE_CHECK_ID) {
    const j = row.judge;
    if (!j || !["FAIL", "REQUIRES_REVIEW", "ERROR"].includes(j.verdict)) return null;
    const reason =
      j.verdict === "REQUIRES_REVIEW"
        ? `Judge unsure: ${j.output?.uncertainty_reason ?? "no reason given"}`
        : j.verdict === "ERROR"
          ? `Judge error: ${j.error ?? "unknown"}`
          : j.output?.relevant_claims[0]
            ? `Unsupported claim: “${j.output.relevant_claims[0]}”`
            : (j.output?.explanation ?? "Flagged by the judge");
    return { outcome: j.verdict, severity: "major", reason };
  }
  const c = row.deterministic.find((d) => d.evaluator_id === checkId);
  if (!c || (c.outcome !== "FAIL" && c.outcome !== "ERROR")) return null;
  return { outcome: c.outcome, severity: c.severity, reason: c.summary };
}

/** Latest live answer per case+version that fails the check (mock only when there is no live data). */
export function fixList(rows: EvaluatorResultRow[], checkId: string): FixItem[] {
  const pool = rows.some((r) => r.execution_mode === "live") ? rows.filter((r) => r.execution_mode === "live") : rows;
  const latest = new Map<string, EvaluatorResultRow>();
  const failCounts = new Map<string, number>();
  for (const r of pool) {
    const key = `${r.case_id}|${r.agent_version}`;
    if (failing(r, checkId)) failCounts.set(key, (failCounts.get(key) ?? 0) + 1);
    const prev = latest.get(key);
    if (!prev || r.timestamp > prev.timestamp) latest.set(key, r);
  }
  const items: FixItem[] = [];
  for (const [key, r] of latest) {
    const f = failing(r, checkId);
    if (!f) continue;
    const version = r.agent_version.replace("pricing-agent@", "");
    items.push({
      trace_id: r.trace_id,
      case_id: r.case_id,
      version,
      role: version.startsWith("corrected") ? "corrected" : version.startsWith("baseline") ? "baseline" : "other",
      split: r.split,
      outcome: f.outcome,
      severity: f.severity,
      reason: f.reason,
      occurrences: failCounts.get(key) ?? 1,
    });
  }
  const roleRank = { corrected: 0, baseline: 1, other: 2 };
  return items.sort(
    (a, b) =>
      roleRank[a.role] - roleRank[b.role] ||
      Number(b.severity === "critical") - Number(a.severity === "critical") ||
      a.case_id.localeCompare(b.case_id),
  );
}
