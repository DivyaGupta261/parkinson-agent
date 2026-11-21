import { describe, expect, it } from "vitest";
import {
  CONNECTION_LOST_MESSAGE,
  initialResearchState,
  parseResearchEvent,
  reduceEvents,
  researchReducer,
  SERVER_DOWN_MESSAGE,
} from "./research";
import { openResearchStream, type EventSourceLike } from "./stream";
import type { ResearchEvent } from "./types";

describe("parseResearchEvent", () => {
  it("parses each named event", () => {
    expect(parseResearchEvent("status", '{"message":"Searching"}')).toEqual({
      type: "status",
      message: "Searching",
    });
    expect(parseResearchEvent("tool", '{"name":"search_pubmed","input":{"query":"exercise"}}')).toEqual({
      type: "tool",
      name: "search_pubmed",
      input: { query: "exercise" },
    });
    expect(parseResearchEvent("thinking", '{"text":"Hmm"}')).toEqual({ type: "thinking", text: "Hmm" });
    expect(parseResearchEvent("answer", '{"markdown":"# Hi"}')).toEqual({ type: "answer", markdown: "# Hi" });
    expect(parseResearchEvent("usage", '{"summary":"1k tokens","cost_usd":0.012}')).toEqual({
      type: "usage",
      summary: "1k tokens",
      costUsd: 0.012,
    });
    expect(parseResearchEvent("error", '{"message":"Rate limited"}')).toEqual({
      type: "error",
      message: "Rate limited",
    });
    expect(parseResearchEvent("done", "{}")).toEqual({ type: "done" });
    expect(parseResearchEvent("done", "")).toEqual({ type: "done" });
  });

  it("parses citations and drops malformed items", () => {
    const data = JSON.stringify({
      items: [
        {
          id: "PMID:1",
          kind: "pubmed",
          exists: true,
          title: "A paper",
          url: "https://pubmed.ncbi.nlm.nih.gov/1/",
          year: 2021,
          source: "Lancet Neurol",
        },
        { id: "NCT01234567", kind: "trial", exists: false, title: null, url: "u", year: null, source: null },
        { kind: "pubmed" },
      ],
    });
    const event = parseResearchEvent("citations", data);
    expect(event?.type).toBe("citations");
    if (event?.type !== "citations") return;
    expect(event.items).toHaveLength(2);
    expect(event.items[0]?.year).toBe("2021");
    expect(event.items[1]).toMatchObject({ kind: "trial", exists: false, title: null });
  });

  it("returns null for bad JSON, wrong shapes and unknown events", () => {
    expect(parseResearchEvent("status", "not json")).toBeNull();
    expect(parseResearchEvent("status", "[]")).toBeNull();
    expect(parseResearchEvent("status", '{"message":5}')).toBeNull();
    expect(parseResearchEvent("mystery", "{}")).toBeNull();
  });
});

const fullRun: ResearchEvent[] = [
  { type: "status", message: "Planning searches" },
  { type: "tool", name: "search_pubmed", input: { query: "aerobic exercise parkinson" } },
  { type: "thinking", text: "Two RCTs look relevant." },
  { type: "tool", name: "fetch_abstracts", input: { pmids: ["1", "2"] } },
  { type: "answer", markdown: "Yes, moderately [PMID:1]." },
  {
    type: "citations",
    items: [
      { id: "PMID:1", kind: "pubmed", exists: true, title: "T", url: "u", year: "2020", source: "J" },
    ],
  },
  { type: "usage", summary: "12k tokens", costUsd: 0.05 },
  { type: "done" },
];

describe("researchReducer", () => {
  it("starts a fresh run", () => {
    const state = researchReducer(initialResearchState, {
      type: "start",
      question: "Q?",
      effort: "high",
    });
    expect(state).toMatchObject({ phase: "running", question: "Q?", effort: "high", runId: 1 });
    expect(state.timeline).toEqual([]);
  });

  it("shows the latest activity in the status line", () => {
    const state = reduceEvents("Q", "low", fullRun.slice(0, 2));
    expect(state.status).toBe("Searching PubMed…");
  });

  it("builds up a complete run", () => {
    const state = reduceEvents("Does exercise help?", "medium", fullRun);
    expect(state.phase).toBe("done");
    expect(state.timeline.map((t) => t.kind)).toEqual(["status", "tool", "thinking", "tool"]);
    expect(state.answer).toBe("Yes, moderately [PMID:1].");
    expect(state.citations).toHaveLength(1);
    expect(state.usage).toEqual({ summary: "12k tokens", costUsd: 0.05 });
    expect(state.status).toBe("Answer ready.");
    expect(state.error).toBeNull();
  });

  it("keeps an error visible when done follows it", () => {
    const state = reduceEvents("Q", "low", [
      { type: "tool", name: "search_pubmed", input: {} },
      { type: "error", message: "The model is overloaded." },
      { type: "done" },
    ]);
    expect(state.phase).toBe("error");
    expect(state.error).toBe("The model is overloaded.");
    expect(state.timeline).toHaveLength(1);
  });

  it("ignores events after the run has finished", () => {
    const done = reduceEvents("Q", "low", fullRun);
    const after = researchReducer(done, {
      type: "event",
      event: { type: "status", message: "late" },
    });
    expect(after).toBe(done);
  });

  it("reports server down when nothing ever arrived", () => {
    const running = researchReducer(initialResearchState, { type: "start", question: "Q", effort: "low" });
    const state = researchReducer(running, { type: "connection-lost" });
    expect(state).toMatchObject({ phase: "error", error: SERVER_DOWN_MESSAGE });
  });

  it("reports a dropped connection after events arrived", () => {
    const partial = reduceEvents("Q", "low", fullRun.slice(0, 2));
    const state = researchReducer(partial, { type: "connection-lost" });
    expect(state).toMatchObject({ phase: "error", error: CONNECTION_LOST_MESSAGE });
  });

  it("ignores a connection drop after done", () => {
    const done = reduceEvents("Q", "low", fullRun);
    expect(researchReducer(done, { type: "connection-lost" })).toBe(done);
  });

  it("cancel stops the run and ignores later events", () => {
    const partial = reduceEvents("Q", "low", fullRun.slice(0, 2));
    const cancelled = researchReducer(partial, { type: "cancel" });
    expect(cancelled.phase).toBe("idle");
    const after = researchReducer(cancelled, { type: "event", event: { type: "answer", markdown: "x" } });
    expect(after.answer).toBeNull();
  });
});

/** A stand-in for the browser's EventSource that the test drives by hand. */
class FakeEventSource implements EventSourceLike {
  listeners = new Map<string, ((event: Event) => void)[]>();
  closed = false;
  constructor(public url: string) {}
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  /** A named server event: carries a data string, like a MessageEvent. */
  emit(type: string, data: unknown) {
    const event = { type, data: JSON.stringify(data) } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  /** The browser's own connection error: a plain Event with no data. */
  fail() {
    const event = { type: "error" } as Event;
    for (const listener of this.listeners.get("error") ?? []) listener(event);
  }
}

function open() {
  let source: FakeEventSource | null = null;
  const events: ResearchEvent[] = [];
  let lost = 0;
  openResearchStream(
    "exercise & PD?",
    "low",
    (e) => events.push(e),
    () => lost++,
    (url) => (source = new FakeEventSource(url)),
  );
  return { source: source as unknown as FakeEventSource, events, lost: () => lost };
}

describe("openResearchStream", () => {
  it("encodes the question and effort in the URL", () => {
    const { source } = open();
    expect(source.url).toBe("/api/research?q=exercise+%26+PD%3F&effort=low");
  });

  it("forwards events and closes on done", () => {
    const { source, events, lost } = open();
    source.emit("status", { message: "Working" });
    source.emit("done", {});
    source.emit("status", { message: "too late" });
    expect(events).toEqual([{ type: "status", message: "Working" }, { type: "done" }]);
    expect(source.closed).toBe(true);
    expect(lost()).toBe(0);
  });

  it("treats a server error event as an event, not a lost connection", () => {
    const { source, events, lost } = open();
    source.emit("error", { message: "No credit left" });
    expect(events).toEqual([{ type: "error", message: "No credit left" }]);
    expect(source.closed).toBe(true);
    expect(lost()).toBe(0);
  });

  it("closes and reports a connection failure so the browser does not retry", () => {
    const { source, events, lost } = open();
    source.fail();
    expect(source.closed).toBe(true);
    expect(lost()).toBe(1);
    expect(events).toEqual([]);
  });
});
