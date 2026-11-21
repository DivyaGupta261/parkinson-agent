# Lesson 5: Memory, a notebook the agent can search

**Goal:** give the agent long-term memory, and understand retrieval (the "R" in RAG).
**Code:** `src/pd_agent/memory.py`, the `recall`/`remember` tools in `agent.py`, `pd notes`, `pd chat`.

```bash
uv run pd research "What is REM sleep behaviour disorder?"   # answer saved as a note
uv run pd notes sleep                                       # search your notes
uv run pd chat                                              # multi-turn; it can recall earlier answers
```

## 1. Two kinds of memory
| | Short-term | Long-term |
|---|---|---|
| What | The `messages` list | A database |
| Lasts | One conversation | Forever |
| Limit | The context window | Disk space |
| Here | `history` in `pd chat` | `data/notes.db` |

The model has no memory at all. "Memory" is always **your code** storing text and putting the relevant bits back into the prompt later.

## 2. How `memory.py` works
SQLite (a database in one file, built into Python) with **FTS5**, its full-text search engine:
- `add_note(title, content, tags, sources)` stores a note.
- `search(query)` finds notes containing any of the words, ranked by **BM25** (the classic relevance formula: rare words count more, title matches are weighted ×5).
- `seen` table: which papers the digest has already shown you (Lesson 6).

The agent gets two tools: `recall` (search) and `remember` (save). The prompt tells it to `recall` first, so a repeat question builds on the earlier answer instead of starting over. Every `pd research` answer is also saved automatically.

One safety detail: user text becomes an FTS query. `search()` extracts plain words and quotes each one, so text like `"; DROP TABLE` can't become query syntax. The test `test_memory_search_ranks_and_handles_punctuation` checks it. That's the same idea as escaping user input in front-end code.

## 3. Keyword search vs embeddings (RAG)
Our search matches **words**. "Tremor" won't find a note that only says "shaking". The common alternative is **embeddings**: each text becomes a vector of numbers that captures meaning, and search finds the nearest vectors. That's "semantic search", and it's what most RAG systems use.

| | Keyword (FTS5/BM25) | Embeddings |
|---|---|---|
| Finds synonyms | ✗ | ✓ |
| Exact terms (gene names like *LRRK2*, PMIDs) | ✓ great | sometimes weak |
| Infrastructure | none | embedding model + vector store |
| Explainable | ✓ | less |

Production systems often use **hybrid search** (both, merged). We started with keywords on purpose: biomedical questions are full of exact terms, and it's zero infrastructure. A good extension project: add embeddings and compare them using the eval suite.

## 4. Context-window budgeting
Why not paste *all* your notes into every prompt? Cost and attention: more tokens cost more, and burying the relevant note among 200 irrelevant ones makes answers worse. Retrieval means putting **only what's relevant** into the context. That's the central skill of RAG, and of "context engineering" generally.

## Try this
1. Ask two related questions with `pd research`, then `pd notes <topic>`. Did the second answer use `recall`?
2. In `pd chat`, ask a follow-up like "and for people under 45?" The chat history makes "and" make sense.
3. Ask the agent to "remember that I prefer cycling to running", then later ask for exercise ideas.
4. Search for `shaking` vs `tremor` and see keyword search's limitation for yourself.

## Interview questions you can now answer
- *How do LLM apps implement memory?*
- *What is RAG? Keyword vs semantic retrieval, and when would you use each?*
- *How do you decide what goes into the context window?*
