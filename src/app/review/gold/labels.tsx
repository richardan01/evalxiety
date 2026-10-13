"use client";

import type { CriterionLabel } from "@/lib/domain/schemas";
import { Badge } from "@/components/ui";

export function HumanLabelBadge({ label }: { label: "pass" | "fail" }) {
  return (
    <Badge tone={label === "pass" ? "green" : "red"} title="Verdict recorded by a named human reviewer">
      {label === "pass" ? "✓ PASS" : "✕ FAIL"}
    </Badge>
  );
}

/** Label for the judge's single criterion: is an unsupported pricing justification present? */
export function UnsupportedLabelBadge({ label }: { label: CriterionLabel }) {
  if (label === "present") {
    return (
      <Badge tone="red" title="Reviewer found an unsupported pricing justification (judge criterion: FAIL)">
        unsupported claim present
      </Badge>
    );
  }
  if (label === "absent") {
    return (
      <Badge tone="green" title="Reviewer found every pricing claim supported (judge criterion: PASS)">
        unsupported claim absent
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" title="Not assessed — excluded from judge calibration">
      not assessed
    </Badge>
  );
}

export function ModeNames({ ids, names, firstId }: { ids: string[]; names: Record<string, string>; firstId?: string | null }) {
  if (ids.length === 0) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} tone={id === firstId ? "amber" : "neutral"} title={id === firstId ? "First failure" : id}>
          {names[id] ?? id}
          {id === firstId ? " (first)" : ""}
        </Badge>
      ))}
    </span>
  );
}
