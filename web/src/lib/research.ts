// The state of one research run, built up event by event from the SSE stream.
//
// This is a reducer: a pure function (state, action) -> new state. React's
// useReducer runs it for us, and because it never touches the network or the
// DOM we can test the whole streaming flow with plain arrays of events.

import { toolLabel } from "./format";
import type { Citation, Effort, ResearchEvent } from "./types";

export type TimelineItem =
  | { kind: "status"; message: string }
  | { kind: "tool"; name: string; input: Record<string, unknown> }
  | { kind: "thinking"; text: string };

export type Phase = "idle" | "running" | "done" | "error";

export interface ResearchState {
  /** Goes up by one per run, so the UI can reset per-run state (React key). */
  runId: number;
  phase: Phase;
  question: string;
  effort: Effort;
  /** The latest status line, read out by screen readers. */
  status: string;
  timeline: TimelineItem[];
  answer: string | null;
  /** null until the citations event arrives (it comes after the answer). */
  citations: Citation[] | null;
  usage: { summary: string; costUsd: number } | null;
  error: string | null;
  /** True once any event has arrived, so we can tell "server down" from "dropped". */
  connected: boolean;
}

export type ResearchAction =
  | { type: "start"; question: string; effort: Effort }
  | { type: "event"; event: ResearchEvent }
  | { type: "connection-lost" }
  | { type: "cancel" };

export const initialResearchState: ResearchState = {
  runId: 0,
  phase: "idle",
  question: "",
  effort: "medium",
  status: "",
  timeline: [],
  answer: null,
  citations: null,
  usage: null,
  error: null,
  connected: false,
};

export const SERVER_DOWN_MESSAGE =
  "Could not reach the research server. Check that it is running (uv run pd serve) and try again.";
export const CONNECTION_LOST_MESSAGE =
  "The connection to the server dropped before the answer finished. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseCitation(value: unknown): Citation | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const url = str(value.url);
  if (!id || !url) return null;
  return {
    id,
    kind: value.kind === "trial" ? "trial" : "pubmed",
    exists: value.exists === true,
    title: str(value.title),
    url,
    year: value.year == null ? null : String(value.year),
    source: str(value.source),
  };
}

/**
 * Turn a raw SSE event (its name and its JSON text) into a typed event.
 * Returns null for anything malformed, so one bad event cannot crash the UI.
 */
export function parseResearchEvent(name: string, data: string): ResearchEvent | null {
  let json: unknown = {};
  if (data.trim() !== "") {
    try {
      json = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!isRecord(json)) return null;

  switch (name) {
    case "status": {
      const message = str(json.message);
      return message === null ? null : { type: "status", message };
    }
    case "tool": {
      const toolName = str(json.name);
      if (toolName === null) return null;
      return { type: "tool", name: toolName, input: isRecord(json.input) ? json.input : {} };
    }
    case "thinking": {
      const text = str(json.text);
      return text === null ? null : { type: "thinking", text };
    }
    case "answer": {
      const markdown = str(json.markdown);
      return markdown === null ? null : { type: "answer", markdown };
    }
    case "citations": {
      if (!Array.isArray(json.items)) return null;
      const items = json.items.map(parseCitation).filter((c): c is Citation => c !== null);
      return { type: "citations", items };
    }
    case "usage": {
      const summary = str(json.summary) ?? "";
      const cost = typeof json.cost_usd === "number" ? json.cost_usd : 0;
      return { type: "usage", summary, costUsd: cost };
    }
    case "error":
      return { type: "error", message: str(json.message) ?? "Something went wrong." };
    case "done":
      return { type: "done" };
    default:
      return null;
  }
}

function applyEvent(state: ResearchState, event: ResearchEvent): ResearchState {
  const next = { ...state, connected: true };
  switch (event.type) {
    case "status":
      return {
        ...next,
        status: event.message,
        timeline: [...state.timeline, { kind: "status", message: event.message }],
      };
    case "tool":
      return {
        ...next,
        status: `${toolLabel(event.name)}…`,
        timeline: [...state.timeline, { kind: "tool", name: event.name, input: event.input }],
      };
    case "thinking":
      return {
        ...next,
        status: "Thinking…",
        timeline: [...state.timeline, { kind: "thinking", text: event.text }],
      };
    case "answer":
      return { ...next, answer: event.markdown, status: "Answer ready. Checking citations." };
    case "citations":
      return { ...next, citations: event.items };
    case "usage":
      return { ...next, usage: { summary: event.summary, costUsd: event.costUsd } };
    case "error":
      return { ...next, phase: "error", error: event.message, status: event.message };
    case "done":
      return { ...next, phase: "done", status: state.answer ? "Answer ready." : "Finished." };
  }
}

export function researchReducer(state: ResearchState, action: ResearchAction): ResearchState {
  switch (action.type) {
    case "start":
      return {
        ...initialResearchState,
        runId: state.runId + 1,
        phase: "running",
        question: action.question,
        effort: action.effort,
        status: "Starting research…",
      };
    case "event":
      // Ignore stragglers after the run has finished, failed or been cancelled.
      // (The server sends done after an error event; this keeps the error shown.)
      if (state.phase !== "running") return state;
      return applyEvent(state, action.event);
    case "connection-lost": {
      if (state.phase !== "running") return state;
      const error = state.connected ? CONNECTION_LOST_MESSAGE : SERVER_DOWN_MESSAGE;
      return { ...state, phase: "error", error, status: error };
    }
    case "cancel":
      if (state.phase !== "running") return state;
      return { ...state, phase: "idle", status: "Stopped." };
  }
}

/** Fold a whole list of events, as if they had streamed in one by one. */
export function reduceEvents(
  question: string,
  effort: Effort,
  events: ResearchEvent[],
): ResearchState {
  return events.reduce(
    (state, event) => researchReducer(state, { type: "event", event }),
    researchReducer(initialResearchState, { type: "start", question, effort }),
  );
}
