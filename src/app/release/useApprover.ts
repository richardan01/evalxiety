"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { getReviewer, setReviewer } from "@/lib/client/api";

// Same event other tabs dispatch, so a name entered anywhere shows up here.
const CHANGE_EVENT = "agenttrust:reviewer-changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Approver identity = the shared reviewer name (localStorage), editable inline. */
export function useApprover() {
  const stored = useSyncExternalStore(subscribe, getReviewer, () => "");
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? stored;

  /** Persist the current value as the reviewer name and return it (trimmed). */
  const commit = useCallback((): string => {
    const name = value.trim();
    if (name && name !== stored) {
      setReviewer(name);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
    setDraft(null);
    return name;
  }, [value, stored]);

  return { value, setValue: setDraft, commit };
}
