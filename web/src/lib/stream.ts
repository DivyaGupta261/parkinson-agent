// Opens the /api/research Server-Sent Events stream and hands each parsed
// event to a callback. See web/README.md for how EventSource works.

import { parseResearchEvent } from "./research";
import { RESEARCH_EVENT_NAMES, type Effort, type ResearchEvent } from "./types";

/** The parts of the browser's EventSource we use, so tests can pass a fake. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

const browserEventSource: EventSourceFactory = (url) => new EventSource(url);

export function researchUrl(question: string, effort: Effort): string {
  const params = new URLSearchParams({ q: question, effort });
  return `/api/research?${params.toString()}`;
}

/**
 * Start a research run. Returns a function that stops it.
 *
 * - onEvent gets every well-formed event, in order.
 * - onConnectionLost fires if the connection fails or drops before "done".
 *
 * The stream is closed after "done" or "error". That matters: when a
 * connection ends, EventSource normally reconnects by itself, which here
 * would start the whole (paid) research run again.
 */
export function openResearchStream(
  question: string,
  effort: Effort,
  onEvent: (event: ResearchEvent) => void,
  onConnectionLost: () => void,
  createEventSource: EventSourceFactory = browserEventSource,
): () => void {
  const source = createEventSource(researchUrl(question, effort));
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };

  for (const name of RESEARCH_EVENT_NAMES) {
    source.addEventListener(name, (raw) => {
      if (closed) return;

      // "error" is both the server's named event (a MessageEvent with data)
      // and the browser's own connection-failure event (a plain Event with
      // no data). Tell them apart by the presence of a data string.
      const data = (raw as MessageEvent).data;
      if (typeof data !== "string") {
        if (name === "error") {
          close();
          onConnectionLost();
        }
        return;
      }

      const event = parseResearchEvent(name, data);
      if (!event) return;
      if (event.type === "done" || event.type === "error") close();
      onEvent(event);
    });
  }

  return close;
}
