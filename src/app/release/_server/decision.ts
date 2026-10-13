/**
 * Server-only logic for POST /api/release/approve. Kept out of the
 * route file so it can be tested without a Next.js request context. Never import from client code.
 *
 * Rules:
 * - The gate is RECOMPUTED here; the client's view is never trusted.
 * - "approved" is refused (409) unless canApprove(gate) — evaluation status
 *   must be ELIGIBLE_FOR_DEMO_APPROVAL. Blocked attempts are audited.
 * - "rejected" is always allowed (and recorded); notes are required.
 * - If the client sends the snapshot hash it reviewed and the evidence has
 *   changed since, nothing is recorded (the human must look again).
 */
import { z } from "zod";
import type { ReleaseApproval } from "@/lib/domain/schemas";
import { canApprove } from "@/lib/release/gate";
import { releaseView } from "@/lib/services";
import { audit, saveApproval } from "@/lib/storage/repos";
import { newId } from "@/lib/storage/store";

export const DecisionBody = z
  .object({
    approver: z.string().trim().min(1, "approver name is required"),
    decision: z.enum(["approved", "rejected"]),
    notes: z.string().trim().default(""),
    candidate_run_id: z.string().trim().min(1, "candidate_run_id is required"),
    baseline_run_id: z.string().trim().min(1).nullish(),
    /** Optional: the evidence snapshot the human reviewed. Mismatch → 409, nothing recorded. */
    expected_evidence_snapshot_hash: z.string().trim().min(1).optional(),
  })
  .refine((b) => b.decision !== "rejected" || b.notes.length > 0, {
    message: "notes are required when rejecting (explain why)",
    path: ["notes"],
  });
export type DecisionBody = z.infer<typeof DecisionBody>;

type View = Awaited<ReturnType<typeof releaseView>>;

export type DecisionOutcome =
  | { kind: "not_found"; message: string }
  | { kind: "snapshot_changed"; message: string; current_hash: string }
  | { kind: "blocked"; message: string; view: View }
  | { kind: "recorded"; approval: ReleaseApproval; view: View };

export async function recordReleaseDecision(body: DecisionBody): Promise<DecisionOutcome> {
  const view = await releaseView({
    candidate_run_id: body.candidate_run_id,
    baseline_run_id: body.baseline_run_id ?? undefined,
  });
  if (!view.candidate_run) return { kind: "not_found", message: `Candidate run ${body.candidate_run_id} not found` };
  if (body.baseline_run_id && !view.baseline_run) return { kind: "not_found", message: `Baseline run ${body.baseline_run_id} not found` };

  if (body.expected_evidence_snapshot_hash && body.expected_evidence_snapshot_hash !== view.evidence_snapshot_hash) {
    return {
      kind: "snapshot_changed",
      current_hash: view.evidence_snapshot_hash,
      message:
        "The evidence changed after you loaded this page, so your decision was NOT recorded. Reload, review the current evidence, and decide again.",
    };
  }

  const { gate } = view;
  if (body.decision === "approved" && !canApprove(gate)) {
    await audit(body.approver, "release.approval_blocked", {
      candidate_run_id: view.candidate_run.run_id,
      baseline_run_id: view.baseline_run?.run_id ?? null,
      evaluation_status: gate.evaluation_status,
      evidence_snapshot_hash: view.evidence_snapshot_hash,
      reason_codes: gate.reasons.filter((r) => r.level !== "WARNING").map((r) => r.code),
    });
    return {
      kind: "blocked",
      view,
      message: `Approval blocked: evaluation status is ${gate.evaluation_status}. Only ELIGIBLE_FOR_DEMO_APPROVAL candidates can be approved. Nothing was recorded.`,
    };
  }

  const approval: ReleaseApproval = {
    approval_id: newId("appr"),
    approver: body.approver,
    decision: body.decision,
    notes: body.notes,
    candidate_run_id: view.candidate_run.run_id,
    // Record the baseline the gate actually compared against (may be the default latest run).
    baseline_run_id: view.baseline_run?.run_id ?? null,
    evidence_snapshot_hash: view.evidence_snapshot_hash,
    status_at_approval: gate.evaluation_status,
    created_at: new Date().toISOString(),
  };
  await saveApproval(approval);
  await audit(body.approver, "release.approval", {
    approval_id: approval.approval_id,
    decision: approval.decision,
    candidate_run_id: approval.candidate_run_id,
    baseline_run_id: approval.baseline_run_id,
    evidence_snapshot_hash: approval.evidence_snapshot_hash,
    status_at_approval: approval.status_at_approval,
  });

  const next = await releaseView({
    candidate_run_id: approval.candidate_run_id,
    baseline_run_id: approval.baseline_run_id ?? undefined,
  });
  return { kind: "recorded", approval, view: next };
}
