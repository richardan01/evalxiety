import { connection } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api/http";
import { MerchantScenario } from "@/lib/domain/schemas";
import { getScenario } from "@/lib/domain/scenarios";
import { runPricingAgent } from "@/lib/agent/runner";
import { getAgentConfig } from "@/lib/agent/configs";
import { audit } from "@/lib/storage/repos";
import { SpendCapError } from "@/lib/llm/client";
import { HeldoutAccessError } from "@/lib/agent/heldout-lock";

const Body = z.object({
  config_id: z.string(),
  case_id: z.string().optional(),
  scenario: MerchantScenario.optional(), // user-supplied custom scenario
  force_mock: z.boolean().optional(),
  bypass_cache: z.boolean().optional(),
  actor: z.string().trim().min(1, "actor (a named person) is required: live runs spend money and are audited"),
});

/** Execute the pricing agent on ONE scenario (single call — never a batch). */
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    const body = Body.parse(await req.json());
    getAgentConfig(body.config_id); // throws on unknown config
    let scenario = body.case_id ? getScenario(body.case_id) : undefined;
    if (!scenario && body.scenario) {
      // Custom scenarios are always tagged user_supplied with a CUSTOM- id and never join frozen sets.
      scenario = {
        ...body.scenario,
        case_id: body.scenario.case_id.startsWith("CUSTOM-") ? body.scenario.case_id : `CUSTOM-${body.scenario.case_id}`,
        variation: null,
        data_origin: "user_supplied",
      };
    }
    if (!scenario) return fail(400, "Provide a known case_id or a custom scenario");
    let trace;
    try {
      trace = await runPricingAgent(scenario, body.config_id, {
        forceMock: body.force_mock,
        bypassCache: body.bypass_cache,
      });
    } catch (err) {
      if (err instanceof SpendCapError) return fail(402, err.message);
      if (err instanceof HeldoutAccessError) return fail(403, err.message);
      throw err;
    }
    await audit(body.actor, "agent.run", {
      trace_id: trace.trace_id,
      case_id: trace.case_id,
      config_id: body.config_id,
      execution_mode: trace.execution_mode,
      cache_hit: trace.cache_hit,
    });
    return ok({ trace });
  });
}
