"""Web API for the React front end.  (Lesson 8)

The agent is the same `agent.run()` the CLI uses. The server only:
1. turns the agent's progress events into Server-Sent Events (SSE), so the
   browser can show tool calls as they happen;
2. serves notes and digests as JSON;
3. serves the built React app (web/dist) at `/`.

Run with `uv run pd serve`, then open http://127.0.0.1:8000
"""

from __future__ import annotations

import json
import os
import queue
import threading
import time
from typing import Iterator

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from pd_agent import agent, demo, digest, llm
from pd_agent.memory import Memory

load_dotenv(llm.PROJECT_ROOT / ".env")
app = FastAPI(title="Parkinson's Research Agent")
memory = Memory()


def demo_mode() -> bool:
    return not os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("PD_DEMO") == "1"


def sse(event: str, data: dict) -> str:
    """One Server-Sent Event. The format is plain text: `event:` and `data:`
    lines, then a blank line. The browser's EventSource parses it."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "demo": demo_mode()}


@app.get("/api/research")
def research(q: str = Query(..., min_length=3, max_length=2000), effort: str = "high") -> StreamingResponse:
    if effort not in {"low", "medium", "high"}:
        raise HTTPException(400, "effort must be low, medium or high")
    stream = replay_demo() if demo_mode() else run_agent(q, effort)
    # X-Accel-Buffering stops proxies (e.g. nginx) from holding events back.
    return StreamingResponse(stream, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def run_agent(question: str, effort: str) -> Iterator[str]:
    """The agent is synchronous and slow (tens of seconds). Run it on a
    thread and pass its events through a queue to this generator, which
    FastAPI streams to the browser as they arrive."""
    events: queue.Queue = queue.Queue()

    def work():
        try:
            result = agent.run(question, effort=effort, memory=memory,
                               on_event=lambda kind, data: events.put((kind, data)))
            events.put(("answer", {"markdown": result.answer}))
            events.put(("citations", {"items": result.citations}))
            events.put(("usage", {"summary": result.usage.summary(), "cost_usd": round(result.usage.cost_usd, 4)}))
            memory.add_note(question, result.answer, tags=["research"], sources=[c["id"] for c in result.citations])
        except Exception as e:  # noqa: BLE001  (report to the browser instead of dropping the connection)
            events.put(("error", {"message": f"{type(e).__name__}: {e}"}))
        finally:
            events.put(("done", {}))

    threading.Thread(target=work, daemon=True).start()
    while True:
        try:
            kind, data = events.get(timeout=15)
        except queue.Empty:
            yield ": keep-alive\n\n"  # an SSE comment, which stops idle connections timing out
            continue
        yield sse(kind, data)
        if kind == "done":
            return


def replay_demo() -> Iterator[str]:
    for delay, kind, data in demo.EVENTS:
        time.sleep(delay)
        yield sse(kind, data)


@app.get("/api/notes")
def notes(q: str = "") -> list[dict]:
    return memory.search(q, limit=30) if q.strip() else memory.recent(50)


@app.get("/api/digests")
def digests() -> list[dict]:
    files = sorted(digest.DIGEST_DIR.glob("*.md"), reverse=True) if digest.DIGEST_DIR.exists() else []
    return [{"date": f.stem, "title": f"Research digest {f.stem}"} for f in files]


@app.get("/api/digests/{day}")
def digest_detail(day: str) -> dict:
    path = digest.DIGEST_DIR / f"{day}.md"
    # Only plain YYYY-MM-DD names, so nobody can request ../../something
    if not (len(day) == 10 and day.replace("-", "").isdigit()) or not path.exists():
        raise HTTPException(404, "No digest for that date")
    return {"date": day, "markdown": path.read_text()}


# The built React app. Mounted last so /api/* routes win.
WEB_DIST = llm.PROJECT_ROOT / "web" / "dist"
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
