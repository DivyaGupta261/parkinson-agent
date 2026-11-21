// Shapes of the JSON the Python server sends. Keep these in step with
// src/pd_agent/server.py: if a field changes there, change it here too and
// TypeScript will point at every place in the UI that needs updating.

export type Effort = "low" | "medium" | "high";

export interface Health {
  ok: boolean;
  demo: boolean;
}

export interface Citation {
  /** "PMID:12345678" or "NCT01234567" */
  id: string;
  kind: "pubmed" | "trial";
  /** false means the source could not be found: the model may have invented it. */
  exists: boolean;
  title: string | null;
  url: string;
  year: string | null;
  source: string | null;
}

export interface Note {
  id: number;
  created_at: string;
  title: string;
  content: string;
  tags: string[];
  sources: string[];
}

export interface DigestSummary {
  date: string;
  title: string;
}

export interface Digest {
  date: string;
  markdown: string;
}

/**
 * One server-sent event from /api/research, after its JSON has been parsed.
 * The `type` is the SSE event name; the other fields are its data.
 */
export type ResearchEvent =
  | { type: "status"; message: string }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  | { type: "thinking"; text: string }
  | { type: "answer"; markdown: string }
  | { type: "citations"; items: Citation[] }
  | { type: "usage"; summary: string; costUsd: number }
  | { type: "error"; message: string }
  | { type: "done" };

export type ResearchEventName = ResearchEvent["type"];

export const RESEARCH_EVENT_NAMES: readonly ResearchEventName[] = [
  "status",
  "tool",
  "thinking",
  "answer",
  "citations",
  "usage",
  "error",
  "done",
];
