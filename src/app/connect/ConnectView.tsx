"use client";

/**
 * Connect: how to use Evalxiety from Claude Desktop, Claude Code or (later) your own agent.
 * Everything shown comes from GET /api/connect, so the snippets carry this machine's real paths.
 */
import { useEffect, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/client/api";
import { Badge, Button, Callout, Card, InfoTip, MockBadge, PageHeader, cx } from "@/components/ui";

interface ConnectData {
  server_path: string;
  server_exists: boolean;
  node_path: string;
  sdk_installed: boolean;
  api_base_url: string;
  tools: Array<{ name: string; description: string }>;
  mode: { mode: "live" | "mock"; reason: string; spend_cap_usd: number; model_id: string };
}

const DESKTOP_CONFIG_PATH = "~/Library/Application Support/Claude/claude_desktop_config.json";

const EXAMPLE_PROMPTS = [
  "Is the pricing agent ready to ship?",
  "Why did C13 regress?",
  "Which traces still need my review?",
];

function desktopSnippet(d: ConnectData): string {
  return JSON.stringify(
    {
      mcpServers: {
        evalxiety: {
          command: d.node_path,
          args: [d.server_path],
          env: { AGENTTRUST_URL: d.api_base_url },
        },
      },
    },
    null,
    2,
  );
}

const codeCommand = (d: ConnectData) => `claude mcp add evalxiety -- node ${d.server_path}`;

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
    setTimeout(() => setState("idle"), 1600);
  };
  return (
    <Button variant="secondary" onClick={copy} title="Copy to clipboard">
      {state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed" : "Copy"}
    </Button>
  );
}

function CodeBlock({ code, wrap }: { code: string; wrap?: boolean }) {
  return (
    <pre
      className={cx(
        wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "overflow-x-auto",
        "rounded-md border border-slate-200 bg-slate-950 px-3 py-2.5 font-mono text-xs leading-relaxed text-slate-100",
      )}
    >
      {code}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------

function Node({ title, sub, tone = "white" }: { title: string; sub?: ReactNode; tone?: "white" | "dark" | "accent" }) {
  return (
    <div
      className={cx(
        "min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-center",
        tone === "white" && "border-slate-200 bg-white",
        tone === "dark" && "border-slate-900 bg-slate-900 text-white",
        tone === "accent" && "border-sky-200 bg-sky-50",
      )}
    >
      <div className="text-sm font-semibold">{title}</div>
      {sub && <div className={cx("mt-0.5 text-xs", tone === "dark" ? "text-slate-300" : "text-slate-500")}>{sub}</div>}
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex w-36 shrink-0 flex-col items-center justify-center px-1">
      <span className="mb-1 whitespace-nowrap text-[11px] font-medium text-slate-500">{label}</span>
      <svg viewBox="0 0 120 10" className="h-2.5 w-full text-slate-400" aria-hidden>
        <line x1="0" y1="5" x2="112" y2="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M110 1 L118 5 L110 9 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

function FlowRow({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{caption}</div>
      <div className="flex items-stretch">{children}</div>
    </div>
  );
}

function Diagram({ mode }: { mode: ConnectData["mode"] | null }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          How it fits together
          <InfoTip>
            Inbound, your Claude reads Evalxiety over MCP (GET requests only). Outbound, Evalxiety is the only part
            that calls the Claude API: it runs the agent under test and the judge, within the spend cap.
          </InfoTip>
        </span>
      }
    >
      <div className="space-y-4 py-1">
        <FlowRow caption="You ask">
          <Node title="Your Claude" sub="Desktop / Code" />
          <Arrow label="MCP · read-only" />
          <Node title="Evalxiety" sub="runs, checks, gate" tone="dark" />
        </FlowRow>
        <FlowRow caption="Evalxiety tests">
          <Node title="Evalxiety" sub="runner + judge" tone="dark" />
          <Arrow label="Claude API" />
          <Node
            title="Agent under test"
            sub={
              <span className="inline-flex items-center gap-1.5">
                pricing agent: Baseline / Corrected {mode && <MockBadge mode={mode.mode} />}
              </span>
            }
            tone="accent"
          />
        </FlowRow>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ConnectView() {
  const [data, setData] = useState<ConnectData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJSON<ConnectData>("/api/connect").then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const readOnly = (
    <Badge tone="green" title="Every tool is an HTTP GET. Nothing runs the agent or judge, reveals held-out data, labels or approves.">
      READ-ONLY · no spend
    </Badge>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Connect"
        question="Use Evalxiety from Claude Desktop, Claude Code or your own agent."
        info={
          <>
            Evalxiety ships a local MCP server (<code>mcp/server.mjs</code>, stdio). It only calls GET endpoints of this
            app, so asking Claude about results never spends API credits or changes data.
          </>
        }
        action={readOnly}
      />

      {error && <Callout tone="red" title="Could not load connection details">{error}</Callout>}
      {data && !data.server_exists && (
        <Callout tone="red" title="MCP server not found">Expected at {data.server_path}.</Callout>
      )}
      {data && data.server_exists && !data.sdk_installed && (
        <Callout tone="amber" title="MCP SDK missing">Run npm install in the Evalxiety folder.</Callout>
      )}

      <Diagram mode={data?.mode ?? null} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              Claude Desktop
              <InfoTip>
                Merge the <code>evalxiety</code> entry into <code>mcpServers</code> if the file already has other
                servers. The command is the absolute path of node because Claude Desktop does not use your shell PATH.
                Evalxiety must be running (<code>npm run dev</code>) when you ask.
              </InfoTip>
            </span>
          }
          subtitle={<span className="font-mono">{DESKTOP_CONFIG_PATH}</span>}
          actions={data && <CopyButton text={desktopSnippet(data)} />}
        >
          {data ? <CodeBlock code={desktopSnippet(data)} /> : <Loading />}
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Paste into the config file above.</li>
            <li>Restart Claude Desktop.</li>
            <li>Look for <span className="font-medium">evalxiety</span> in the tools menu.</li>
          </ol>
        </Card>

        <div className="space-y-5">
          <Card
            title={
              <span className="flex items-center gap-2">
                Claude Code
                <InfoTip>
                  Adds the server to your Claude Code config (local scope). Add <code>-s user</code> to use it in every
                  project; check with <code>claude mcp list</code>.
                </InfoTip>
              </span>
            }
            subtitle="Run once in a terminal"
            actions={data && <CopyButton text={codeCommand(data)} />}
          >
            {data ? <CodeBlock code={codeCommand(data)} wrap /> : <Loading />}
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>Run the command above.</li>
              <li>
                Check with <code className="font-mono text-xs">claude mcp list</code>.
              </li>
              <li>
                Ask away. API: <span className="font-mono text-xs">{data?.api_base_url ?? "…"}</span>
              </li>
            </ol>
          </Card>

          <Card title="Try asking Claude">
            <ul className="space-y-2">
              {EXAMPLE_PROMPTS.map((p) => (
                <li key={p} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">
                  <span>“{p}”</span>
                  <CopyButton text={p} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <Card title="Tools" subtitle={data ? `${data.tools.length} tools, all GET` : undefined} actions={readOnly}>
          {data ? (
            <ul className="divide-y divide-slate-100">
              {data.tools.map((t) => (
                <li key={t.name} className="flex gap-3 py-2 text-sm">
                  <code className="w-40 shrink-0 font-mono text-xs font-semibold text-slate-900">{t.name}</code>
                  <span className="text-slate-600">{t.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Loading />
          )}
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            Not exposed: run, judge, held-out reveal, labels, approval.
            <InfoTip>
              Those spend API credits or need a named human, so they stay in this UI. The server only calls an allowlist
              of GET endpoints.
            </InfoTip>
          </div>
        </Card>

        <div className="space-y-5">
          <Card
            title={
              <span className="flex items-center gap-2">
                Bring your own agent <Badge tone="amber">coming next</Badge>
              </span>
            }
          >
            <p className="text-sm text-slate-700">Today the agent under test is the built-in pricing agent.</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              <li className="flex items-center gap-1.5">
                <span className="text-slate-400">○</span> Trace import (JSONL)
                <InfoTip>Upload your agent&apos;s logged traces and review, check and gate them here.</InfoTip>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-slate-400">○</span> HTTP adapter
                <InfoTip>Point Evalxiety at your agent&apos;s endpoint so frozen cases run against it.</InfoTip>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-slate-400">○</span> <code className="font-mono text-xs">evalxiety gate --ci</code>
                <InfoTip>Fail a CI build when the release gate is not met.</InfoTip>
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">Not built yet.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return <div className="h-16 animate-pulse rounded-md bg-slate-100" />;
}
