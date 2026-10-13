"use client";

import Link from "next/link";
import { Badge, InfoTip, fmtDateTime } from "@/components/ui";
import { HELDOUT_REVEAL_HREF, shortHash } from "./shared";
import type { ExperimentsData, FrozenSetRow } from "./types";

export function HeldoutLockBadge({ set, heldout }: { set: FrozenSetRow; heldout: ExperimentsData["heldout"] }) {
  if (!set.includesHeldout) return <Badge tone="neutral">no held-out cases</Badge>;
  if (heldout.revealed) {
    return (
      <Badge tone="amber" title={heldout.reason ?? undefined}>
        Unlocked{heldout.revealed_by ? ` by ${heldout.revealed_by}` : ""}
        {heldout.revealed_at ? ` · ${fmtDateTime(heldout.revealed_at)}` : ""}
      </Badge>
    );
  }
  return (
    <Badge tone="purple" title="Held-out cases cannot run until an audited reveal">
      Locked
    </Badge>
  );
}

export function FrozenSetsSection({ sets, heldout }: { sets: FrozenSetRow[]; heldout: ExperimentsData["heldout"] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr className="border-b border-slate-100">
          <th className="py-1.5 pr-3 font-medium">
            <span className="inline-flex items-center gap-1.5">
              Set
              <InfoTip label="What does frozen mean?">
                Synthetic cases only. Each set&apos;s content is hashed; two runs are compared only when their hashes are identical, so a
                difference can never come from edited inputs. Held-out cases are for the final check only and stay locked until the audited
                reveal in{" "}
                <Link href={HELDOUT_REVEAL_HREF} className="font-medium underline">
                  Evaluators → judge calibration
                </Link>
                .
              </InfoTip>
            </span>
          </th>
          <th className="py-1.5 pr-3 font-medium">Cases</th>
          <th className="py-1.5 pr-3 font-medium">Use</th>
          <th className="py-1.5 pr-3 font-medium">Content hash</th>
          <th className="py-1.5 font-medium">Held-out</th>
        </tr>
      </thead>
      <tbody>
        {sets.map((s) => (
          <tr key={s.frozen_set_id} className="border-b border-slate-50 last:border-0">
            <td className="py-1.5 pr-3 font-mono text-xs font-semibold whitespace-nowrap" title={s.description}>
              {s.frozen_set_id}
            </td>
            <td className="py-1.5 pr-3 tabular-nums" title={s.case_ids.join(", ")}>
              {s.case_ids.length}
            </td>
            <td className="py-1.5 pr-3 text-xs text-slate-600">
              {s.split === "heldout" ? "final check only" : s.split === "full" ? "release gate (dev + held-out)" : "iterate & compare"}
            </td>
            <td className="py-1.5 pr-3">
              <code className="font-mono text-xs text-slate-500" title={s.content_hash}>
                {shortHash(s.content_hash)}…
              </code>
            </td>
            <td className="py-1.5">
              <HeldoutLockBadge set={s} heldout={heldout} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
