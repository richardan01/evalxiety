#!/usr/bin/env node
/**
 * A tiny, rule-based "support bot" used by the Evalxiety starter kit. No API key, no dependencies.
 *
 *   node agents/example-support-bot/server.mjs --version=v1   # baseline (has bugs)
 *   node agents/example-support-bot/server.mjs --version=v2   # candidate (fixes most, breaks one thing)
 *
 * It speaks the Evalxiety HTTP contract:
 *   POST /answer  { "case_id": "...", "input": { "question": "..." } }
 *   → { "output": { "answer", "citations", "escalate" }, "evidence": [{ "id", "text" }], "model_id": "...", "metadata": {...} }
 *
 * Replace this with your own agent. Evalxiety only needs the request/response shape above.
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = (process.argv.find((a) => a.startsWith("--version=")) ?? "--version=v1").split("=")[1];
const PORT = Number(process.env.EXAMPLE_AGENT_PORT ?? 4010);

const KB = {
  "KB-1": { topic: /refund|money back/i, text: "Refunds are available within 30 days of purchase for annual plans. Monthly plans are not refundable." },
  "KB-2": { topic: /password|log ?in|reset/i, text: "Reset your password from Settings → Security → Reset password. The reset link expires after 24 hours." },
  "KB-3": { topic: /export|download.*data|all our data/i, text: "Admins can export workspace data as CSV from Settings → Data → Export. Exports include up to 12 months of history." },
  "KB-4": { topic: /outage|down|loads|uptime|status/i, text: "Check status.acme.example for live incidents. Enterprise customers get a 99.9% uptime SLA with service credits." },
  "KB-5": { topic: /lawyer|legal|breach|cancel/i, text: "Hand the conversation to a human agent when the customer mentions legal action, a security breach, or asks to cancel an enterprise contract." },
  "KB-6": { topic: /price|cost|plan cost|how much/i, text: "The Team plan costs $12 per user per month. Annual billing saves 2 months." },
};

function retrieve(question) {
  return Object.entries(KB)
    .filter(([, a]) => a.topic.test(question))
    .map(([id, a]) => ({ id, text: a.text }));
}

function shouldEscalate(q) {
  if (VERSION === "v1") return /enterprise contract/i.test(q); // BUG: misses legal threats and breaches
  return /lawyer|legal|breach|cancel/i.test(q); // FIX for legal/breach — but now escalates every "cancel"
}

function answer(question) {
  const evidence = retrieve(question);
  const ids = evidence.map((e) => e.id);
  const escalate = shouldEscalate(question);
  const parts = [];
  let citations = ids.filter((id) => id !== "KB-5");
  if (escalate) parts.push("I'm handing this to a member of our team, who will reply within one business day.");
  if (ids.includes("KB-2")) parts.push("You can reset your password from Settings → Security → Reset password; the link expires after 24 hours.");
  if (ids.includes("KB-3")) parts.push("An admin can export your data as CSV from Settings → Data → Export (up to 12 months of history).");
  if (ids.includes("KB-4")) parts.push("Please check status.acme.example for live incidents. Enterprise plans include a 99.9% uptime SLA.");
  if (ids.includes("KB-1")) {
    parts.push(
      VERSION === "v1"
        ? "We guarantee a full refund, no questions asked." // BUG: promise the policy doesn't make
        : "Annual plans can be refunded within 30 days of purchase; monthly plans are not refundable.",
    );
  }
  if (ids.includes("KB-6")) {
    if (VERSION === "v1") {
      parts.push("The Team plan is $10 per user per month."); // BUG: wrong number
      citations = [...citations, "KB-7"]; // BUG: cites an article it was never given
    } else {
      parts.push("The Team plan costs $12 per user per month, and annual billing saves 2 months.");
    }
  }
  const answeredFromArticle = ["KB-1", "KB-2", "KB-3", "KB-4", "KB-6"].some((id) => ids.includes(id));
  if (!parts.length) parts.push("Thanks for reaching out. Could you tell me a bit more about what you need?");
  if (VERSION === "v1" && answeredFromArticle) {
    // BUG: long boilerplate after every help-article answer pushes it past the length limit.
    parts.push(
      "We really value you as a customer and appreciate your patience while we look into this. Our team works around the clock across many time zones to make sure every customer gets the help they need, and we are always improving our products and our documentation based on feedback like yours. If you have any other questions at all, about this or anything else, please don't hesitate to reach out to us again at any time, day or night.",
    );
  }
  if (escalate) citations = [...citations, "KB-5"];
  // metadata.evalxiety_starter_kit marks toy output: Evalxiety keeps it labelled EXAMPLE even in a copied agent folder.
  return { output: { answer: parts.join(" "), citations, escalate }, evidence, model_id: `example-rules-${VERSION}`, metadata: { evalxiety_starter_kit: true } };
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/answer") {
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "POST /answer" }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { input } = JSON.parse(body);
      const out = answer(String(input?.question ?? ""));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e) }));
    }
  });
});

export { answer, VERSION };

// Start only when run directly (not when imported), on every OS.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, "127.0.0.1", () => console.log(`Example support bot ${VERSION} on http://127.0.0.1:${PORT}/answer`));
}
