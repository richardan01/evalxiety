/**
 * Executes the pricing agent on one scenario and persists the trace.
 *
 * The trace records observable inputs and outputs only: prompts, supplied
 * policy context and evidence, the raw response text, the parsed structured
 * output, usage and latency. Hidden model reasoning is not requested or stored.
 */
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MODEL_ID, callStructured, modeInfo } from "../llm/client";
import { PricingRecommendation, type MerchantScenario, type Trace } from "../domain/schemas";
import { newId } from "../storage/store";
import { saveTrace } from "../storage/repos";
import { getAgentConfig, retrievePolicies } from "./configs";
import { buildEvidencePack } from "./evidence";
import { systemPrompt, userPrompt } from "./prompts";
import { mockRecommendation } from "./mock";
import { assertHeldoutUnlocked } from "./heldout-lock";

export interface RunOptions {
  experimentRunId?: string | null;
  bypassCache?: boolean;
  /** Force mock execution even when live mode is available (UI development). */
  forceMock?: boolean;
}

const OUTPUT_FORMAT = betaZodOutputFormat(PricingRecommendation);

export async function runPricingAgent(
  scenario: MerchantScenario,
  configId: string,
  opts: RunOptions = {},
): Promise<Trace> {
  const config = getAgentConfig(configId);
  await assertHeldoutUnlocked(scenario);
  const policies = retrievePolicies(config.retrieval_strategy, scenario.decision_date);
  const evidence = buildEvidencePack(scenario, policies);
  const system = systemPrompt(config.prompt_version);
  const user = userPrompt(scenario, policies, evidence);
  const mode = opts.forceMock ? "mock" : modeInfo().mode;

  const base = {
    trace_id: newId("trace"),
    case_id: scenario.case_id,
    timestamp: new Date().toISOString(),
    input: scenario,
    agent_version: config.config_id,
    model_id: mode === "live" ? MODEL_ID : "mock-pricing-agent",
    prompt_version: config.prompt_version,
    retrieval_strategy: config.retrieval_strategy,
    policy_context: policies.map((p) => ({
      policy_id: p.policy_id,
      effective_from: p.effective_from,
      effective_to: p.effective_to,
    })),
    evidence_pack: evidence,
    retrieved_or_supplied_source_ids: [scenario.case_id, ...policies.map((p) => p.policy_id)],
    system_prompt: system,
    user_prompt: user,
    tool_calls_if_any: [], // this agent makes a single structured call; it has no tools
    experiment_run_id: opts.experimentRunId ?? null,
    data_origin: scenario.data_origin,
  } satisfies Partial<Trace>;

  let trace: Trace;
  if (mode === "mock") {
    const started = Date.now();
    let parsed: PricingRecommendation | null = null;
    let error: string | null = null;
    try {
      parsed = mockRecommendation(scenario, config, policies);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    trace = {
      ...base,
      served_model_id: null,
      selected_policy_id: parsed?.selected_policy_id ?? null,
      final_response: parsed ? JSON.stringify(parsed) : null,
      parsed_structured_output: parsed,
      latency_ms: Date.now() - started,
      token_usage: null,
      estimated_cost_usd: null,
      stop_reason: null,
      execution_error: error,
      execution_mode: "mock",
      cache_hit: false,
    };
  } else {
    const res = await callStructured({
      purpose: `agent:${config.config_id}:${scenario.case_id}`,
      system,
      user,
      format: OUTPUT_FORMAT,
      effort: config.effort,
      bypassCache: opts.bypassCache,
    });
    let parsed: PricingRecommendation | null = null;
    let error = res.error;
    if (!error && res.raw_text) {
      try {
        const result = PricingRecommendation.safeParse(JSON.parse(res.raw_text));
        if (result.success) parsed = result.data;
        else error = `Structured output failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
      } catch (e) {
        error = `Response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else if (!error) {
      error = "Empty response";
    }
    trace = {
      ...base,
      served_model_id: res.served_model_id,
      selected_policy_id: parsed?.selected_policy_id ?? null,
      final_response: res.raw_text,
      parsed_structured_output: parsed,
      latency_ms: res.latency_ms,
      token_usage: res.usage,
      estimated_cost_usd: res.estimated_cost_usd,
      stop_reason: res.stop_reason,
      execution_error: error,
      execution_mode: "live",
      cache_hit: res.cache_hit,
    };
  }

  await saveTrace(trace);
  return trace;
}
