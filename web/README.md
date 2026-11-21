# Web app (Lesson 8)

A React front end for the research agent: ask a question, watch the agent work, and read a cited answer. It also browses saved notes and weekly digests.

Built with Vite, React and TypeScript. The only runtime libraries are React and `react-markdown`; there is no UI framework, just one stylesheet (`src/styles.css`) with light and dark themes in CSS variables.

## Running it

You need two terminals in development: one for the Python API, one for the React dev server.

```bash
# terminal 1, at the repo root: the FastAPI server on http://127.0.0.1:8000
uv run pd serve

# terminal 2: the React dev server on http://localhost:5173
cd web
npm install      # first time only
npm run dev
```

Open http://localhost:5173. Vite forwards every `/api/...` request to port 8000 (see `vite.config.ts`), so the browser only ever talks to one origin and there is no CORS to configure. Edits to the React code reload instantly.

For production there is only one server:

```bash
cd web && npm run build    # type-checks, then writes the static site to web/dist
cd .. && uv run pd serve   # FastAPI serves web/dist at / and the API at /api
```

With no `ANTHROPIC_API_KEY` the server replays a recorded example, and the app shows a "Demo mode: recorded example" banner.

### Checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run: citation parsing, the SSE reducer, formatting
npm run build
```

## How the code is organised

```
src/
  main.tsx                 mounts <App />
  App.tsx                  header, tabs, disclaimer, health check, view switch
  hooks/useHashRoute.ts    a tiny router: #/ask, #/notes, #/digests/2026-11-19
  hooks/useResearch.ts     connects the stream to the reducer
  lib/types.ts             the API's JSON shapes
  lib/api.ts               fetch helpers for the JSON endpoints
  lib/stream.ts            opens the EventSource for /api/research
  lib/research.ts          parses events and folds them into state (a reducer)
  lib/citations.ts         finds [PMID:…] / [NCT…] and turns them into chips
  lib/format.ts            dates (shown in IST), costs, tool labels
  components/              AskView, ActivityTimeline, Markdown, CitationList, NotesView, DigestsView
```

The rule of thumb: anything that can be a plain function lives in `lib/` and has tests; components stay thin.

## Streaming: Server-Sent Events in five minutes

A research run takes a while: the agent searches, reads abstracts, thinks, and searches again. Rather than make you stare at a spinner, the server *streams* what it is doing as it goes. It uses **Server-Sent Events (SSE)**, the simplest way to push data from server to browser.

### What goes over the wire

SSE is an ordinary HTTP response with `Content-Type: text/event-stream` that the server keeps open and writes to bit by bit. Each message is a few `field: value` lines followed by a blank line:

```
event: tool
data: {"name": "search_pubmed", "input": {"query": "aerobic exercise parkinson"}}

event: answer
data: {"markdown": "Exercise probably helps a little [PMID:29228079]."}

event: done
data: {}

```

`event:` names the message and `data:` carries the payload. Our server always sends JSON in `data`.

### The contract for `GET /api/research?q=<question>&effort=<low|medium|high>`

| event | data | meaning |
|---|---|---|
| `status` | `{"message": str}` | a progress line ("Planning the searches…") |
| `tool` | `{"name": str, "input": object}` | the agent is calling a tool such as `search_pubmed` |
| `thinking` | `{"text": str}` | a summary of the model's reasoning |
| `answer` | `{"markdown": str}` | the final answer, with inline `[PMID:…]` and `[NCT…]` citations |
| `citations` | `{"items": [...]}` | the citation check: does each cited source really exist? Arrives after `answer` |
| `usage` | `{"summary": str, "cost_usd": number}` | tokens and cost |
| `error` | `{"message": str}` | something went wrong; `done` follows |
| `done` | `{}` | the run is over |

### Reading it in the browser with `EventSource`

Browsers have SSE built in. You give `EventSource` a URL and listen for each event name:

```ts
const source = new EventSource("/api/research?q=...&effort=medium");

source.addEventListener("tool", (e) => {
  const data = JSON.parse(e.data);   // e is a MessageEvent; e.data is the text after "data:"
  console.log("calling", data.name);
});

source.addEventListener("done", () => source.close());
```

Three things about `EventSource` that are easy to miss, all handled in `src/lib/stream.ts`:

1. **It reconnects by itself.** When the connection ends, the browser waits a few seconds and opens it again. That is great for a live news feed but wrong here: reconnecting would start a whole new (paid) research run. So we call `source.close()` as soon as `done` or `error` arrives, and also when the connection fails.
2. **`error` means two different things.** Our server sends a named `error` event, but the browser also fires an `error` event of its own when the connection fails. They arrive at the same listener. The server's one is a `MessageEvent` with a `data` string; the browser's one has no data. We tell them apart by checking for `data`.
3. **It only does GET.** You cannot send a JSON body or custom headers, which is why the question goes in the query string. (For POST you would use `fetch` and read the body stream yourself.)

### From events to screen: a reducer

Each parsed event is handed to `researchReducer` in `src/lib/research.ts`, a pure function `(state, event) => newState`. A `tool` event appends to the activity timeline, `answer` stores the markdown, `citations` stores the check results, and so on. React's `useReducer` re-renders whenever the state changes.

Because the reducer never touches the network, the tests can replay a whole run from a plain array of events (`src/lib/research.test.ts`), with no server and no browser. A fake `EventSource` covers the close-and-don't-reconnect behaviour.

### Citations

The answer arrives as markdown containing `[PMID:12345678]` and `[NCT01234567]`. Before rendering, `linkifyCitations` rewrites each one into a markdown link to its card (`[PMID:1](#cite-PMID-1)`), and the `Markdown` component draws those links as small numbered chips. When the `citations` event arrives, each card shows the paper's title, year and journal, or a red "could not be verified" warning when `exists` is false. That is the hallucination guard from Lesson 3, made visible.

## Accessibility

- Everything works from the keyboard; focus rings are always visible.
- The status line is an `aria-live` region, so screen readers announce progress without reading the whole timeline.
- Sizes are in `rem`, so the layout follows the browser's text-size setting. Buttons and links have a target of at least 44px.
- Light and dark themes follow the system setting (`prefers-color-scheme`), and animations stop when `prefers-reduced-motion` is on.
- The layout works down to 360px wide.
