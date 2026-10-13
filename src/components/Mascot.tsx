/**
 * Evalxiety's mascot: an original, nervous clipboard that checks whether the
 * evaluation evidence can be trusted. Its face follows the release status.
 * (Original artwork — deliberately not based on any existing character design.)
 */
import { cx } from "./ui";

export type Mood = "panic" | "worried" | "cautious" | "relieved";

export function moodFor(status: string): Mood {
  if (status === "NO_SHIP") return "panic";
  if (status === "INSUFFICIENT_EVIDENCE") return "worried";
  if (status === "ELIGIBLE_FOR_DEMO_APPROVAL") return "cautious";
  return "relieved";
}

export function Mascot({ mood = "worried", size = 56, className }: { mood?: Mood; size?: number; className?: string }) {
  const brows: Record<Mood, string> = {
    panic: "M20 22 L28 18 M44 22 L36 18",
    worried: "M20 20 Q24 17 28 19 M44 20 Q40 17 36 19",
    cautious: "M20 20 L28 20 M36 20 L44 20",
    relieved: "M20 19 Q24 17 28 19 M36 19 Q40 17 44 19",
  };
  const mouth: Record<Mood, string> = {
    panic: "M23 42 L26 39 L29 42 L32 39 L35 42 L38 39 L41 42",
    worried: "M24 42 Q28 39 32 42 Q36 45 40 42",
    cautious: "M25 42 L39 42",
    relieved: "M25 40 Q32 46 39 40",
  };
  const pupil = mood === "panic" ? 1.6 : 2.4;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={`Evalxiety is ${mood}`}
      className={cx(mood === "panic" ? "evx-jitter-fast" : mood === "worried" ? "evx-jitter" : "", className)}
    >
      {/* clipboard body */}
      <rect x="10" y="9" width="44" height="50" rx="9" fill="#6d5bd0" />
      <rect x="15" y="14" width="34" height="40" rx="6" fill="#f5f3ff" />
      {/* clip */}
      <rect x="24" y="4" width="16" height="9" rx="3" fill="#4c3fa3" />
      <rect x="28" y="6.5" width="8" height="3" rx="1.5" fill="#f5f3ff" />
      {/* eyes */}
      <circle cx="24" cy="28" r="5.5" fill="#fff" stroke="#1e1b4b" strokeWidth="1.5" />
      <circle cx="40" cy="28" r="5.5" fill="#fff" stroke="#1e1b4b" strokeWidth="1.5" />
      <circle cx={mood === "panic" ? 25 : 26} cy="28.5" r={pupil} fill="#1e1b4b" />
      <circle cx={mood === "panic" ? 41 : 42} cy="28.5" r={pupil} fill="#1e1b4b" />
      {/* brows + mouth */}
      <path d={brows[mood]} stroke="#1e1b4b" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d={mouth[mood]} stroke="#1e1b4b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* checklist ticks on the board */}
      <path d="M19 49 l2 2 l3 -4 M28 50 h10" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {/* sweat */}
      {(mood === "panic" || mood === "worried") && <path d="M52 16 q3 5 0 7 q-3 -2 0 -7z" fill="#38bdf8" />}
      {mood === "panic" && <path d="M8 22 q2.5 4 0 6 q-2.5 -2 0 -6z" fill="#38bdf8" />}
    </svg>
  );
}
