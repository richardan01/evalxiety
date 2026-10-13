"use client";

/** Client-side fetch helpers. All API routes return JSON and are uncached. */
export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `GET ${url} failed (${res.status})`);
  return body as T;
}

export async function postJSON<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(body?.details) ? `: ${body.details.join("; ")}` : "";
    throw new Error((body?.error ?? `POST ${url} failed (${res.status})`) + details);
  }
  return body as T;
}

/** Reviewer identity is kept in localStorage so annotations always carry a named human. */
export function getReviewer(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("agenttrust.reviewer") ?? "";
}

export function setReviewer(name: string) {
  window.localStorage.setItem("agenttrust.reviewer", name.trim());
}
