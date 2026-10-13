"use client";

import type { Annotation, FailureMode } from "@/lib/domain/schemas";
import { Badge, Card, SeverityBadge, fmtDateTime } from "@/components/ui";
import { CRITERION_TEXT, modeName } from "../_queue/annotationForm";

/** Other reviewers' human labels on this trace. Collapsed until you have saved your own, to keep labels independent. */
export function OtherAnnotations({
  annotations,
  modes,
  ownSaved,
}: {
  annotations: Annotation[];
  modes: FailureMode[] | null;
  ownSaved: boolean;
}) {
  if (annotations.length === 0) {
    return (
      <Card title="Other reviewers">
        <p className="text-xs text-slate-500">No other reviewer has labelled this trace yet.</p>
      </Card>
    );
  }
  return (
    <Card
      title={`Other reviewers (${annotations.length})`}
      subtitle={
        ownSaved
          ? "Human labels from other reviewers. Disagreements are worth discussing before axial coding."
          : "Collapsed until you save your own label, so your judgment stays independent."
      }
    >
      <p className="mb-2 text-xs text-slate-600">
        Labelled by: {annotations.map((a) => a.reviewer).join(", ")}
      </p>
      <details open={ownSaved} className="rounded border border-slate-200">
        <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium text-slate-600">
          {ownSaved ? "Their labels" : "Show their labels anyway (may anchor your judgment)"}
        </summary>
        <ul className="divide-y divide-slate-100 border-t border-slate-200">
          {annotations.map((a) => (
            <li key={a.annotation_id} className="space-y-1 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <b className="text-slate-900">{a.reviewer}</b>
                <Badge tone={a.task_outcome === "pass" ? "green" : "red"}>{a.task_outcome.toUpperCase()}</Badge>
                <SeverityBadge severity={a.severity} />
                <span className="text-xs text-slate-500">{fmtDateTime(a.updated_at)}</span>
              </div>
              {a.first_failure && (
                <p className="text-xs text-slate-700">
                  <span className="font-medium">First failure:</span> {a.first_failure.description}{" "}
                  <span className="text-slate-500">[{modeName(modes, a.first_failure.failure_mode_id)}]</span>
                </p>
              )}
              {a.additional_failure_mode_ids.length > 0 && (
                <p className="text-xs text-slate-700">
                  <span className="font-medium">Also:</span>{" "}
                  {a.additional_failure_mode_ids.map((id) => modeName(modes, id)).join(", ")}
                </p>
              )}
              <p className="text-xs text-slate-700">
                <span className="font-medium">Unsupported justification:</span> {CRITERION_TEXT[a.unsupported_justification_label]}
              </p>
              <p className="whitespace-pre-wrap text-xs text-slate-600">{a.open_coding_notes}</p>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
