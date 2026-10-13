"use client";

import { useSyncExternalStore } from "react";
import { getReviewer, setReviewer } from "@/lib/client/api";

const EVENT = "agenttrust:reviewer-changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Reviewer name from localStorage; "" on the server and until set. */
export function useReviewer(): string {
  return useSyncExternalStore(subscribe, getReviewer, () => "");
}

export function saveReviewer(name: string) {
  setReviewer(name);
  window.dispatchEvent(new Event(EVENT));
}
