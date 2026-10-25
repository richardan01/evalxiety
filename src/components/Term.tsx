import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/** A word with its plain-language definition on hover (and for screen readers), from the shared glossary. */
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const g = GLOSSARY[k];
  return (
    <span title={`${g.term}: ${g.def}`} className="cursor-help underline decoration-slate-300 decoration-dotted underline-offset-2">
      {children ?? g.term}
    </span>
  );
}

/** The whole glossary as a definition list, for a "What do these words mean?" tip. */
export function GlossaryList({ keys }: { keys?: GlossaryKey[] }) {
  const entries = (keys ?? (Object.keys(GLOSSARY) as GlossaryKey[])).map((k) => GLOSSARY[k]);
  return (
    <dl className="space-y-1.5">
      {entries.map((g) => (
        <div key={g.term}>
          <dt className="font-semibold text-slate-800">{g.term}</dt>
          <dd className="text-slate-600">{g.def}</dd>
        </div>
      ))}
    </dl>
  );
}
