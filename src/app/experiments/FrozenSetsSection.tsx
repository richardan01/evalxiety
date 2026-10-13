"use client";

import Link from "next/link";
import { Badge, Callout, Card, fmtDateTime } from "@/components/ui";
import { shortHash } from "./shared";
import type { ExperimentsData, FrozenSetRow } from "./types";

export function HeldoutLockBadge({ set, heldout }: { set: FrozenSetRow; heldout: ExperimentsData["heldout"] }) {
  if (!set.includesHeldout) return <Badge tone="neutral">no held-out cases</Badge>;
  if (heldout.revealed) {
    return (
      <Badge tone="amber" title={heldout.reason ?? undefined}>
        UNLOCKED — revealed{heldout.revealed_by ? ` by ${heldout.revealed_by}` : ""}
        {heldout.revealed_at ? ` · ${fmtDateTime(heldout.revealed_at)}` : ""}
      </Badge>
    );
  }
  return (
    <Badge tone="purple" title="Held-out cases cannot run until an audited reveal">
      LOCKED until audited reveal
    </Badge>
  );
}

export function FrozenSetsSection({ sets, heldout }: { sets: FrozenSetRow[]; heldout: ExperimentsData["heldout"] }) {
  return (
    <div className="space-y-3">
      <Card title="Frozen test sets" subtitle="Synthetic cases only — fabricated merchants. Not production data.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="py-1.5 pr-3 font-medium">Set</th>
                <th className="py-1.5 pr-3 font-medium">Description</th>
                <th className="py-1.5 pr-3 font-medium">Cases</th>
                <th className="py-1.5 pr-3 font-medium" title="SHA-256 over every case's scenario JSON plus the split version">
                  Content hash
                </th>
                <th className="py-1.5 pr-3 font-medium">Split</th>
                <th className="py-1.5 font-medium">Held-out access</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.frozen_set_id} className="border-b border-slate-50 align-top last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs font-semibold whitespace-nowrap">{s.frozen_set_id}</td>
                  <td className="py-2 pr-3 text-slate-700">{s.description}</td>
                  <td className="py-2 pr-3 tabular-nums" title={s.case_ids.join(", ")}>
                    {s.case_ids.length}
                  </td>
                  <td className="py-2 pr-3">
                    <code className="font-mono text-xs" title={s.content_hash}>
                      {shortHash(s.content_hash)}…
                    </code>
                  </td>
                  <td className="py-2 pr-3">
                    {s.split === "heldout" ? <Badge tone="purple">held-out</Badge> : s.split === "full" ? <Badge tone="amber">full (dev + held-out)</Badge> : <Badge>dev</Badge>}
                  </td>
                  <td className="py-2">
                    <HeldoutLockBadge set={s} heldout={heldout} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Callout tone="blue" title="What “frozen” means">
        The scenario content of every case in a set is hashed (shown above). Each run records the hash it ran on, and a comparison only
        pairs two runs whose hashes are <b>identical</b> — so a difference between runs can never come from edited inputs. Held-out
        cases stay locked until an audited reveal in{" "}
        <Link href="/evaluators#calibration" className="font-medium underline">
          Evaluators → judge calibration
        </Link>
        ; they are for the final check only, never for tuning prompts.
      </Callout>
    </div>
  );
}
