# Lesson 8: A web app, with the agent behind an API and React in front

**Goal:** put the agent behind an HTTP API, stream its progress to a React UI, and make it deployable for your portfolio.
**Code:** `src/pd_agent/server.py`, `src/pd_agent/demo.py`, `web/` (React), `Dockerfile`. See `web/README.md` for the front-end details.

```bash
# development: two terminals
uv run pd serve                    # API on http://127.0.0.1:8000
cd web && npm install && npm run dev   # UI on http://localhost:5173 (proxies /api to :8000)

# production-style: one process
cd web && npm run build && cd ..
uv run pd serve                    # API + built UI on http://127.0.0.1:8000
```

## 1. The architecture
```
Browser (React) ──EventSource──▶ GET /api/research?q=…  (FastAPI)
      ▲                                │ runs agent.run() on a thread
      │                                │ on_event → queue → generator
      └──── text/event-stream ◀────────┘ tool / thinking / answer / citations / usage / done
```
The agent is the **same `agent.run()`** the CLI uses. That's why Lesson 3 added the `on_event` callback: the CLI prints events and the server streams them. Keep the core independent of the interface.

## 2. Server-Sent Events, from the server side
You've used `EventSource` in browsers. Here's the other end: the response is plain text that never "finishes" until the agent does:

```
event: tool
data: {"name": "search_pubmed", "input": {"query": "..."}}

event: answer
data: {"markdown": "**Short answer:** ..."}
```
(`sse()` in `server.py` formats one event.) Three practical details:
- The agent is synchronous and slow, so it runs on a **thread** and pushes events into a **queue**; a generator reads the queue and yields events, which FastAPI streams.
- A `: keep-alive` comment every 15s stops proxies and browsers closing an idle connection while the model thinks.
- `X-Accel-Buffering: no` stops nginx-style proxies from holding events back.

Why SSE rather than WebSockets? Data flows one way (server → browser), SSE is plain HTTP, and the browser reconnects automatically. WebSockets earn their complexity when both sides talk continuously.

## 3. Demo mode
A portfolio link that needs your API key, or that lets strangers spend your money, is a problem. With no `ANTHROPIC_API_KEY` (or `PD_DEMO=1`), the server **replays a recorded run** (`demo.py`) with realistic timing, and the UI shows a "Demo mode" banner. The recorded answer cites only papers and a trial whose records were actually read, and a test checks that its citations and answer match.

## 4. Small security habits
- `/api/digests/{day}` accepts only `YYYY-MM-DD`, so `../../etc/passwd` gets a 404 (tested).
- Question length is limited (3–2000 characters) and `effort` is whitelisted.
- The server binds to `127.0.0.1` by default: only your machine can reach it.
- For a public deployment, use demo mode or add authentication and rate limiting. Never expose a key-backed agent openly.

## 5. Deploying
The `Dockerfile` builds the React app, installs the Python package with uv, and runs `pd serve` on port 8000 in demo mode by default. It runs on any container host (Fly.io, Render, Railway, Google Cloud Run):
```bash
docker build -t pd-agent .
docker run -p 8000:8000 pd-agent                      # demo mode
docker run -p 8000:8000 -e ANTHROPIC_API_KEY=... -e PD_DEMO=0 pd-agent   # live (keep it private!)
```

## Try this
1. Open http://127.0.0.1:8000/api/health, then `curl -N "http://127.0.0.1:8000/api/research?q=exercise"` to watch raw SSE.
2. Open the browser's Network tab, click the research request, and look at the EventStream view.
3. Add an `effort` value `xhigh` end to end (server whitelist plus UI selector).

## Interview questions you can now answer
- *How do you stream LLM output to a browser? SSE vs WebSockets?*
- *How do you run a slow synchronous job behind an async web server?*
- *How would you deploy an LLM app safely?* (Secrets via env, demo/auth, rate limits, input validation.)
