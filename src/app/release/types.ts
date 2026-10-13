/**
 * Type-only views of the JSON returned by /api/release and /api/audit.
 * (Type imports are erased at build time — no server code reaches the client.)
 */
import type { releaseView } from "@/lib/services";
import type { AuditEvent, ReleaseApproval } from "@/lib/domain/schemas";

export type ReleaseView = Awaited<ReturnType<typeof releaseView>>;
export type ReleaseGateResult = ReleaseView["gate"];
export type ReleaseRunRow = ReleaseView["runs"][number];

/** POST /api/release/approve success body: the recomputed view plus the record just written. */
export type ReleaseDecisionResponse = ReleaseView & { recorded_approval: ReleaseApproval };

export interface AuditResponse {
  events: AuditEvent[];
  total: number;
  limit: number;
}
