"use client";

/**
 * Paste an agent's token once; it's saved on this computer (data/private, git-ignored) and never shown again. Replaces
 * "edit .env.local and restart the app" for people who don't live in a terminal.
 */
import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import { Button, cx } from "@/components/ui";

export const envNameFor = (agentId: string, suffix = "TOKEN") => `EVALXIETY_AGENT_${agentId.toUpperCase().replace(/-/g, "_")}_${suffix}`;

export function TokenField({ agentId, suffix = "TOKEN", saved, onSaved }: { agentId: string; suffix?: string; saved?: boolean; onSaved?: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const name = envNameFor(agentId || "my-agent", suffix);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJSON("/api/agent-secrets", { agent_id: agentId, suffix, value });
      setValue("");
      setDone(true);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDone(false);
          }}
          placeholder={saved || done ? "Saved. Paste a new one to replace it" : "Paste the token"}
          aria-label={`Token for ${agentId || "your agent"}`}
          className={cx("w-72 rounded border border-slate-300 px-2 py-1 font-mono text-xs")}
        />
        <Button variant="secondary" onClick={save} disabled={busy || !agentId || !value}>
          {busy ? "Saving…" : "Save token"}
        </Button>
        {(saved || done) && !value && <span className="text-xs text-emerald-700">✓ Saved on this computer</span>}
      </div>
      {error && <div className="text-xs text-rose-700">{error}</div>}
      <div className="text-[11px] text-slate-500">
        Stored on this computer in the app&apos;s private data folder (never committed, never shown again) as <code>{name}</code>. Prefer a file? Put{" "}
        <code>{name}=…</code> in <code>.env.local</code> (or <code>settings.env</code> in your Evalxiety folder, if you started it with <code>npx evalxiety</code>) and
        restart the app.
      </div>
    </div>
  );
}
