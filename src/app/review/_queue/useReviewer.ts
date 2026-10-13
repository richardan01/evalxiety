"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { getReviewer, setReviewer } from "@/lib/client/api";

const CHANGE_EVENT = "agenttrust:reviewer-changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * Reviewer identity (localStorage, via getReviewer/setReviewer) with an editable draft.
 * `stored` is the committed name used for labels; `commit()` persists the draft and returns the name.
 */
export function useReviewerDraft() {
  const stored = useSyncExternalStore(subscribe, getReviewer, () => "");
  const [draft, setDraft] = useState<string | null>(null);

  const commit = useCallback((): string => {
    if (draft === null) return stored;
    const name = draft.trim();
    setReviewer(name);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    setDraft(null);
    return name;
  }, [draft, stored]);

  return { stored, value: draft ?? stored, setValue: setDraft, commit, editing: draft !== null };
}
