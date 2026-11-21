// Small fetch helpers for the JSON endpoints. The streaming endpoint lives
// in stream.ts because it uses EventSource rather than fetch.

import type { Digest, DigestSummary, Health, Note } from "./types";

/** Thrown when the server cannot be reached at all (as opposed to an HTTP error). */
export class ServerUnreachableError extends Error {
  constructor() {
    super("Could not reach the server. Check that it is running (uv run pd serve).");
    this.name = "ServerUnreachableError";
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ServerUnreachableError();
  }
  // The Vite proxy answers 502/504 (or 500 with no body) when FastAPI is not running.
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new ServerUnreachableError();
  }
  if (!response.ok) {
    throw new Error(`The server answered ${response.status} ${response.statusText} for ${path}.`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ServerUnreachableError();
  }
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return getJson<Health>("/api/health", signal);
}

export function getNotes(query: string, signal?: AbortSignal): Promise<Note[]> {
  const q = query.trim();
  const path = q ? `/api/notes?${new URLSearchParams({ q }).toString()}` : "/api/notes";
  return getJson<Note[]>(path, signal);
}

export function getDigests(signal?: AbortSignal): Promise<DigestSummary[]> {
  return getJson<DigestSummary[]>("/api/digests", signal);
}

export function getDigest(date: string, signal?: AbortSignal): Promise<Digest> {
  return getJson<Digest>(`/api/digests/${encodeURIComponent(date)}`, signal);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
