/** Map "your agents" errors to HTTP responses with messages written for a first-time user. */
import { fail, ok } from "../api/http";
import { AgentNotFoundError } from "./config";
import { MissingEnvError, UnsafeConnectionError } from "./http";
import { CasesChangedError, ConfirmationRequiredError, ImportValidationError } from "./runs";
import { GateNotEligibleError, JudgeBusyError, JudgeConfirmationRequired } from "./services";
import { RealTraceNeedsLiveJudgeError } from "./judge";
import { EditError } from "./edit";
import { NotProvenError } from "./rules";
import { SpendCapError } from "../llm/client";

export function agentError(err: unknown): Response {
  if (err instanceof AgentNotFoundError) return fail(404, err.message);
  if (err instanceof ImportValidationError) {
    return ok({ error: err.message, problems: err.problems }, { status: err.heldout ? 423 : 422 });
  }
  if (err instanceof ConfirmationRequiredError) return ok({ error: err.message, confirmation_required: true, estimate: err.estimate }, { status: 409 });
  if (err instanceof JudgeConfirmationRequired) {
    return ok({ error: err.message, confirmation_required: true, calls: err.calls, estimated_usd: err.estimated_usd }, { status: 409 });
  }
  if (err instanceof CasesChangedError) return fail(409, err.message);
  if (err instanceof MissingEnvError || err instanceof UnsafeConnectionError) return fail(400, err.message);
  if (err instanceof JudgeBusyError) return fail(409, err.message);
  if (err instanceof RealTraceNeedsLiveJudgeError) return fail(400, err.message);
  if (err instanceof GateNotEligibleError) return fail(409, err.message);
  if (err instanceof NotProvenError) return ok({ error: err.message, preview: err.preview }, { status: err.status });
  if (err instanceof EditError) return fail(err.status, err.message);
  if (err instanceof SpendCapError) return fail(402, err.message);
  throw err;
}

/** Run fn and map known errors; anything else falls through to handle() (Zod → 400, else 500). */
export async function withAgentErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return agentError(err);
  }
}
