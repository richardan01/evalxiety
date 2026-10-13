import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { handle } from "@/lib/api/http";
import { MODEL_ID, SpendCapError, estimateCostUsd, modeInfo, reserveSpend, settleSpend, utf8Bytes, worstCaseCostUsd } from "@/lib/llm/client";
import { GUIDE_SYSTEM } from "@/lib/guide/knowledge";
import { guideState, mockReply } from "@/lib/guide/snapshot";

const Body = z.object({
  page: z.string().max(200).default("/"),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(30)
    .refine((m) => m.length > 0 && m[0].role === "user" && m[m.length - 1].role === "user", "conversation must start and end with a user turn"),
});

const encoder = new TextEncoder();

function textStream(text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

const MAX_TOKENS = 4000;
let client: Anthropic | null = null;

/** Chat with the in-app guide. Streams plain text. Live calls respect the spend cap and are recorded in the ledger. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const state = await guideState(body.page);
    const question = body.messages[body.messages.length - 1].content;

    if (state.mode !== "live") return textStream(mockReply(question, state, modeInfo().reason), { "X-Guide-Mode": "mock" });

    const messages = [...body.messages, { role: "system" as const, content: state.text }];
    const reservedUsd = worstCaseCostUsd(utf8Bytes(GUIDE_SYSTEM, ...messages.map((m) => m.content)), MAX_TOKENS);
    let reservationId: string;
    try {
      reservationId = await reserveSpend("guide", reservedUsd);
    } catch (err) {
      if (!(err instanceof SpendCapError)) throw err;
      return textStream(mockReply(question, state, "the live spend cap has no room for another call"), { "X-Guide-Mode": "mock" });
    }

    client ??= new Anthropic();
    const stream = client.beta.messages.stream({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: GUIDE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
    });

    const out = new ReadableStream<Uint8Array>({
      async start(controller) {
        let settled = false;
        const settle = async (usd: number | null, model: string | null) => {
          if (settled) return;
          settled = true;
          await settleSpend(reservationId, "guide", usd, model);
        };
        stream.on("text", (t) => controller.enqueue(encoder.encode(t)));
        try {
          const final = await stream.finalMessage();
          const usage = {
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
            cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: final.usage.cache_creation_input_tokens ?? 0,
          };
          await settle(estimateCostUsd(usage), final.model);
          if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n\n_The model declined to answer this one — try rephrasing._"));
          if (final.stop_reason === "max_tokens") controller.enqueue(encoder.encode("\n\n_(answer cut off)_"));
        } catch (err) {
          // API error responses aren't billed; a dropped stream may have been, so keep the worst case.
          await settle(err instanceof Anthropic.APIError && err.status ? null : reservedUsd, null);
          let message: string;
          if (err instanceof Anthropic.AuthenticationError) message = "Authentication failed — check ANTHROPIC_API_KEY in .env.local";
          else if (err instanceof Anthropic.RateLimitError) message = "Rate limited — try again in a moment";
          else if (err instanceof Anthropic.APIError) message = `API error ${err.status}: ${err.message}`;
          else message = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`\n\n⚠️ ${message}`));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(out, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Guide-Mode": "live" } });
  });
}
