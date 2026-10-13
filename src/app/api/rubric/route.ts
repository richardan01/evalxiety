import { connection } from "next/server";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/http";
import { ChecklistItem, JudgeCriterion } from "@/lib/rubric/rubric";
import { buildJudgeSystemPrompt, judgeVersion } from "@/lib/judge/judge";
import { POLICIES } from "@/lib/domain/policies";
import { DETERMINISTIC_EVALUATORS } from "@/lib/evaluators/deterministic";
import { appendRubricVersion, audit, getHeldoutState, latestTaxonomy, listRubricVersions, RubricConflictError } from "@/lib/storage/repos";

/** GET /api/rubric → the current rubric, its history, the judge prompt it produces, and the (read-only) policy thresholds. */
export async function GET() {
  await connection();
  return handle(async () => {
    const [versions, taxonomy] = await Promise.all([listRubricVersions(), latestTaxonomy()]);
    const rubric = versions[versions.length - 1];
    return ok({
      rubric,
      versions: versions
        .map((v) => ({ version: v.version, created_at: v.created_at, author: v.author, change_note: v.change_note }))
        .reverse(),
      judge: {
        system_prompt: buildJudgeSystemPrompt(rubric.judge_criterion),
        live_version: judgeVersion("live", rubric.judge_criterion),
        mock_version: judgeVersion("mock", rubric.judge_criterion),
      },
      failure_modes: taxonomy.failure_modes
        .filter((m) => m.status !== "merged" && m.status !== "retired")
        .map((m) => ({ failure_mode_id: m.failure_mode_id, name: m.name })),
      evaluators: [
        ...DETERMINISTIC_EVALUATORS.map((d) => ({ evaluator_id: d.evaluator_id, kind: "code" as const })),
        { evaluator_id: "unsupported_pricing_justification", kind: "judge" as const },
      ],
      policy_thresholds: POLICIES.map((p) => ({
        policy_id: p.policy_id,
        effective_from: p.effective_from,
        effective_to: p.effective_to,
        min_margin_pct: p.min_margin_pct,
        discount_approval_threshold_pct: p.discount_approval_threshold_pct,
        high_volume_threshold_usd: p.high_volume_threshold_usd,
        promotions: p.promotions.map((x) => `${x.code} (${x.valid_from}→${x.valid_to}, −${x.margin_floor_relief_pp}pp)`),
      })),
    });
  });
}

const Body = z.object({
  author: z.string().trim().min(1, "author (a named human) is required"),
  change_note: z.string().trim().min(3, "describe the change"),
  base_version: z.number().int(),
  review_checklist: z.array(ChecklistItem).min(1).max(8),
  judge_criterion: JudgeCriterion,
});

/** POST /api/rubric → save a new rubric version. Changing the judge criterion starts a new judge version. */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = Body.parse(await req.json().catch(() => null));
    const ids = body.review_checklist.map((c) => c.id);
    if (new Set(ids).size !== ids.length) return fail(400, "Checklist item ids must be unique");
    const before = (await listRubricVersions()).at(-1)!;
    const judgeEdit = JSON.stringify(before.judge_criterion) !== JSON.stringify(body.judge_criterion);
    if (judgeEdit && (await getHeldoutState()).revealed) {
      return fail(
        409,
        "The held-out cases have been revealed, so the judge criterion is frozen: a judge tuned after seeing held-out results would make the held-out check meaningless. Checklist wording can still change.",
      );
    }
    let created;
    try {
      created = await appendRubricVersion(body.author, body.change_note, body, body.base_version);
    } catch (err) {
      if (err instanceof RubricConflictError) return fail(409, err.message);
      throw err;
    }
    const judgeChanged = judgeVersion("live", before.judge_criterion) !== judgeVersion("live", created.judge_criterion);
    await audit(body.author, "rubric.saved", {
      version: created.version,
      change_note: body.change_note,
      judge_version_changed: judgeChanged,
      new_live_judge_version: judgeVersion("live", created.judge_criterion),
    });
    return ok({ rubric: created, judge_version_changed: judgeChanged });
  });
}
