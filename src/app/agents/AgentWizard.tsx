"use client";

/**
 * "Connect your agent" wizard: name it, test its endpoint once, keep the suggested checks, paste test cases, and the
 * server writes a new agents/<id>/ folder. Nothing is created until the last step.
 */
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { postJSON } from "@/lib/client/api";
import type { CheckConfig } from "@/lib/agents/schemas";
import { suggestChecks } from "@/lib/agents/suggest";
import { Badge, Button, Callout, Card, InfoTip, cx } from "@/components/ui";
import { inputCls } from "./[agentId]/shared";

interface TestResponse {
  result: { output: unknown; evidence: Array<{ id: string; text: string }>; model_id: string | null; latency_ms: number; error: string | null };
  suggested_checks: CheckConfig[];
}

interface Created {
  agent_id: string;
  cases: number;
  heldout: number;
  checks: number;
  token_env: string | null;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const envName = (id: string) => `EVALXIETY_AGENT_${id.toUpperCase().replace(/-/g, "_")}_TOKEN`;

function parseSample(text: string): { value: unknown; error: string | null } {
  try {
    return { value: JSON.parse(text), error: null };
  } catch {
    return { value: null, error: "Sample input must be JSON, e.g. {\"question\": \"…\"} or \"a plain string\"." };
  }
}

/** Plain-text case lines are wrapped in the sample's first text field, or sent as the bare string. */
function inputKeyOf(sample: unknown): string | null {
  if (sample && typeof sample === "object" && !Array.isArray(sample)) {
    return Object.entries(sample).find(([, v]) => typeof v === "string")?.[0] ?? null;
  }
  return null;
}

function checkSummary(c: CheckConfig): string {
  switch (c.type) {
    case "non_empty":
      return c.field ? `\`${c.field}\` has text` : "output has text";
    case "json_output":
      return `fields present: ${c.required_fields.join(", ")}`;
    case "cites_evidence":
      return `\`${c.citations_field}\` only cites given evidence`;
    case "max_latency_ms":
      return `under ${c.max / 1000} s`;
    default:
      return c.type;
  }
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-slate-100 py-4 first:border-t-0 first:pt-1">
      <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700")}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-2 text-sm font-semibold text-slate-900">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function AgentWizard({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [description, setDescription] = useState("");

  const [mode, setMode] = useState<"http" | "import">("http");
  const [url, setUrl] = useState("http://127.0.0.1:8000/answer");
  const [needsToken, setNeedsToken] = useState(false);
  const [authName, setAuthName] = useState("Authorization");
  const [authPrefix, setAuthPrefix] = useState("Bearer ");
  const [sampleText, setSampleText] = useState('{\n  "question": "How do I reset my password?"\n}');

  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<(TestResponse & { key: string }) | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());

  const [casesText, setCasesText] = useState("");
  const [holdout, setHoldout] = useState(true);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const sample = useMemo(() => parseSample(sampleText), [sampleText]);
  const inputKey = inputKeyOf(sample.value);
  const id = idEdited ? agentId : slugify(name);
  const idValid = /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
  const auth = mode === "http" && needsToken ? { name: authName.trim(), prefix: authPrefix } : null;
  const connection = mode === "http" ? { url: url.trim(), auth, timeout_ms: 30_000 } : null;

  // Without an endpoint there is no reply to learn from: start with the one check every agent needs.
  const checks: CheckConfig[] = mode === "http" ? (test?.suggested_checks ?? []) : suggestChecks(null);
  const keptChecks = mode === "http" ? checks.filter((c) => keep.has(c.id)) : checks;

  const caseLines = casesText.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  const isJsonl = caseLines.length > 0 && caseLines.every((l) => l.startsWith("{"));
  const heldoutCount = !isJsonl && holdout && caseLines.length >= 5 ? Math.floor(caseLines.length / 5) : 0;

  // A test only counts for the exact id, endpoint and sample it ran with.
  const testKey = JSON.stringify({ id, connection, sample: sample.value });
  const tested = mode === "import" || Boolean(test && !test.result.error && test.key === testKey);
  const canCreate = idValid && name.trim() && tested && caseLines.length > 0 && !creating && !created;

  const runTest = async () => {
    if (sample.error) return setTestError(sample.error);
    setTesting(true);
    setTestError(null);
    setTest(null);
    try {
      const r = await postJSON<TestResponse>("/api/onboard/test", { agent_id: id, connection, sample_input: sample.value });
      setTest({ ...r, key: testKey });
      setKeep(new Set(r.suggested_checks.map((c) => c.id)));
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      setCreated(
        await postJSON<Created>("/api/onboard", {
          agent_id: id,
          name: name.trim(),
          description: description.trim(),
          connection,
          checks: keptChecks,
          cases_text: casesText,
          input_key: inputKey,
          holdout,
        }),
      );
      onCreated();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  if (created) {
    return (
      <Card title="Agent connected" actions={<Badge tone="green">CREATED</Badge>}>
        <p className="text-sm text-slate-700">
          Wrote <code className="font-mono text-xs">agents/{created.agent_id}/</code> with {created.cases} cases ({created.heldout} held out) and {created.checks}{" "}
          checks. Edit those files any time to refine them.
        </p>
        {created.token_env && (
          <Callout tone="amber" title="One more step: add the token">
            Put your agent&apos;s token in <code>.env.local</code> as <code>{created.token_env}=…</code>, then restart the app. The token is never stored in
            agent.json.
          </Callout>
        )}
        <div className="mt-3 flex gap-2">
          <Link href={`/agents/${created.agent_id}`} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            Open {name.trim()} and run it →
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Connect your agent"
      subtitle="About 3 minutes. Nothing is written until you click Create."
      actions={
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      }
    >
      <Step n={1} title="Name it" done={Boolean(name.trim()) && idValid}>
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support bot" className={cx(inputCls, "w-56")} />
          <span className="flex items-center gap-1 text-sm text-slate-500">
            agents/
            <input
              value={id}
              onChange={(e) => {
                setIdEdited(true);
                setAgentId(e.target.value);
              }}
              placeholder="support-bot"
              className={cx(inputCls, "w-44 font-mono text-xs", id && !idValid && "border-rose-400")}
            />
          </span>
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it does, in one sentence (optional)" className={cx(inputCls, "mt-2 w-full")} />
        {id && !idValid && <div className="mt-1 text-xs text-rose-700">Use lowercase letters, digits and dashes.</div>}
      </Step>

      <Step n={2} title="How should Evalxiety reach it?" done={tested}>
        <div className="flex gap-4 text-sm">
          {(["http", "import"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
              {m === "http" ? "It has an HTTP endpoint" : "I'll upload its traces (JSONL)"}
            </label>
          ))}
        </div>

        {mode === "http" ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              Evalxiety will POST <code className="font-mono">{`{"case_id", "input"}`}</code> and record the JSON or text reply.
              <InfoTip>
                If the reply is an object with an <code>output</code> key, <code>evidence</code>, <code>tool_calls</code>, <code>model_id</code> and{" "}
                <code>cost_usd</code> are read too. Otherwise the whole body is the output. Redirects are refused.
              </InfoTip>
            </div>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://my-agent.example.com/answer" className={cx(inputCls, "w-full font-mono text-xs")} />
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={needsToken} onChange={(e) => setNeedsToken(e.target.checked)} />
              It needs an auth token
            </label>
            {needsToken && (
              <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-1.5">
                  Header
                  <input value={authName} onChange={(e) => setAuthName(e.target.value)} className={cx(inputCls, "w-36 font-mono text-xs")} />
                  value
                  <input value={authPrefix} onChange={(e) => setAuthPrefix(e.target.value)} className={cx(inputCls, "w-20 font-mono text-xs")} />
                  <code className="font-mono">{`\${env:${envName(id || "my-agent")}}`}</code>
                </div>
                <div className="mt-1">
                  Don&apos;t paste the token here. Put it in <code>.env.local</code> as <code>{envName(id || "my-agent")}</code> and restart the app before testing.
                </div>
              </div>
            )}
            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">One sample input (what your agent normally receives)</div>
              <textarea value={sampleText} onChange={(e) => setSampleText(e.target.value)} rows={3} className={cx(inputCls, "w-full font-mono text-xs", sample.error && "border-rose-400")} />
            </div>
            <Button onClick={runTest} disabled={testing || !idValid || !url.trim() || Boolean(sample.error)}>
              {testing ? "Calling your agent…" : test ? "Test again" : "Test connection"}
            </Button>
            {!idValid && <span className="ml-2 text-xs text-slate-500">Name it first.</span>}
            {testError && <div className="text-sm text-rose-700">{testError}</div>}
            {test && (
              <div className={cx("rounded-md border p-2 text-xs", test.result.error ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50")}>
                <div className="mb-1 font-medium">
                  {test.result.error ? `✗ ${test.result.error}` : `✓ Replied in ${test.result.latency_ms} ms${test.result.model_id ? ` · ${test.result.model_id}` : ""}${test.result.evidence.length ? ` · ${test.result.evidence.length} evidence items` : ""}`}
                </div>
                {!test.result.error && (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-slate-800 [overflow-wrap:anywhere]">
                    {typeof test.result.output === "string" ? test.result.output : JSON.stringify(test.result.output, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            After it&apos;s created, use <span className="font-medium">Add a run → Import</span> on the agent&apos;s page. <code>agents/_template/run-my-agent.mjs</code> shows the
            JSONL format.
          </p>
        )}
      </Step>

      <Step n={3} title="Checks to start with" done={tested && keptChecks.length > 0}>
        {mode === "http" && !test ? (
          <p className="text-xs text-slate-500">Test the connection and Evalxiety suggests checks that fit your agent&apos;s reply.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={mode === "import"}
                    checked={mode === "import" || keep.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(keep);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setKeep(next);
                    }}
                  />
                  <span>
                    <span className="text-slate-800">{c.question}</span>{" "}
                    <span className="font-mono text-[11px] text-slate-500">({checkSummary(c)})</span>{" "}
                    {c.severity === "critical" && <Badge tone="red">critical</Badge>}
                    {c.blocking && <Badge tone="amber">blocking</Badge>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Rules about content (&quot;hands off legal questions&quot;, &quot;quotes the right price&quot;) come later: review real traces first, then add them to agent.json.
            </p>
          </>
        )}
      </Step>

      <Step n={4} title="Test cases" done={caseLines.length > 0}>
        <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-500">
          {isJsonl ? (
            <>JSONL detected: each line is used as written.</>
          ) : (
            <>
              One input per line (10–30 real ones is a good start). Each line becomes{" "}
              <code className="font-mono">{inputKey ? `{"${inputKey}": "<line>"}` : `"<line>"`}</code>.
            </>
          )}
          <InfoTip>
            Need expected answers or structured input? Paste JSONL instead: <code>{`{"case_id": "q1", "input": {...}, "expected": {...}}`}</code>.
          </InfoTip>
        </div>
        <textarea
          value={casesText}
          onChange={(e) => setCasesText(e.target.value)}
          rows={6}
          placeholder={"How do I reset my password?\nCan I get a refund after 45 days?\nMy lawyer will be in touch about the outage."}
          className={cx(inputCls, "w-full font-mono text-xs")}
        />
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span>{caseLines.length} cases</span>
          {!isJsonl && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={holdout} onChange={(e) => setHoldout(e.target.checked)} />
              Hold out every 5th case for the final check{heldoutCount ? ` (${heldoutCount})` : ""}
              <InfoTip>Held-out cases stay locked while you tune, so the final run measures cases you never optimised for.</InfoTip>
            </label>
          )}
        </div>
      </Step>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">
          Creates <code className="font-mono">agents/{id || "…"}/agent.json</code> and <code className="font-mono">cases.jsonl</code>. Existing folders are never overwritten.
        </span>
        <Button onClick={create} disabled={!canCreate}>
          {creating ? "Creating…" : "Create agent"}
        </Button>
      </div>
      {createError && <div className="mt-2 text-sm text-rose-700">{createError}</div>}
    </Card>
  );
}
