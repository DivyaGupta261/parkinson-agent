"""Long-term memory: a searchable notebook in SQLite.  (Lesson 5)

A model forgets everything between API calls. "Memory" for an agent just
means storing text somewhere and searching it later, then putting what you
find back into the prompt. That's the core idea behind RAG (retrieval-
augmented generation).

We use SQLite's built-in full-text search (FTS5): no server, no vector
database, one file in data/ (which git ignores).
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from pd_agent.llm import PROJECT_ROOT

DB_PATH = PROJECT_ROOT / "data" / "notes.db"

SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(
    title, content, tags,
    sources UNINDEXED, created_at UNINDEXED,
    tokenize = 'porter unicode61'
);
CREATE TABLE IF NOT EXISTS seen (
    item_id TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL
);
"""


class Memory:
    def __init__(self, path: Path | str = DB_PATH):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    # --- notes -------------------------------------------------------------
    def add_note(self, title: str, content: str, tags: list[str] | None = None, sources: list[str] | None = None) -> int:
        cur = self.db.execute(
            "INSERT INTO notes (title, content, tags, sources, created_at) VALUES (?, ?, ?, ?, ?)",
            (title, content, " ".join(tags or []), json.dumps(sources or []), datetime.now(timezone.utc).isoformat()),
        )
        self.db.commit()
        return cur.lastrowid

    def search(self, query: str, limit: int = 5) -> list[dict]:
        """Best matches first (bm25 ranking). Plain words are OR-ed together,
        so "GBA exercise" finds notes mentioning either."""
        words = re.findall(r"\w+", query.lower())
        if not words:
            return self.recent(limit)
        fts_query = " OR ".join(f'"{w}"' for w in words)
        rows = self.db.execute(
            "SELECT rowid, * FROM notes WHERE notes MATCH ? ORDER BY bm25(notes, 5.0, 1.0, 2.0) LIMIT ?",
            (fts_query, limit),
        ).fetchall()
        return [self._row(r) for r in rows]

    def recent(self, limit: int = 20) -> list[dict]:
        rows = self.db.execute("SELECT rowid, * FROM notes ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [self._row(r) for r in rows]

    def delete(self, note_id: int) -> None:
        self.db.execute("DELETE FROM notes WHERE rowid = ?", (note_id,))
        self.db.commit()

    @staticmethod
    def _row(r: sqlite3.Row) -> dict:
        return {
            "id": r["rowid"],
            "created_at": r["created_at"],
            "title": r["title"],
            "content": r["content"],
            "tags": r["tags"].split(),
            "sources": json.loads(r["sources"]),
        }

    # --- "have I seen this paper before?" (used by the weekly digest) -----
    def filter_unseen(self, item_ids: list[str]) -> list[str]:
        if not item_ids:
            return []
        marks = ",".join("?" * len(item_ids))
        seen = {r[0] for r in self.db.execute(f"SELECT item_id FROM seen WHERE item_id IN ({marks})", item_ids)}
        return [i for i in item_ids if i not in seen]

    def mark_seen(self, item_ids: list[str]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.db.executemany("INSERT OR IGNORE INTO seen VALUES (?, ?)", [(i, now) for i in item_ids])
        self.db.commit()
