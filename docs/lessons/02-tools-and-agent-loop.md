# Lesson 2: Tools and the agent loop

**Goal:** turn a model that *talks from memory* into an agent that *looks things up and cites them*.
**Code:** `src/pd_agent/tools/pubmed.py`, `src/pd_agent/agent_manual.py`, `tests/`.

```bash
# The tool alone. No AI and no cost. This is exactly what the agent sees.
uv run pd pubmed "parkinson disease AND high-intensity exercise AND randomized controlled trial[pt]" --max 3 --abstracts

# This lesson's hand-written agent (`--manual`; without it, `pd research` uses the Lesson 3 agent)
uv run pd research --manual "What is the evidence that aerobic exercise slows Parkinson's progression?"
uv run pd research --manual "How does young-onset Parkinson's differ from late-onset in genetics and progression?" --show-thinking
```

## 1. What is an "agent"?
Strip away the hype and an agent is **an LLM in a loop with tools**:

```
            ┌──────────────────────────────────────────────┐
question ─▶ │ model: "I need to search PubMed for X"        │
            │   → stop_reason = "tool_use"                  │
            │ your code runs search_pubmed(X)               │──┐
            │ your code appends the result to messages      │  │ repeat
            │ model reads the result, maybe searches again… │◀─┘
            │   → stop_reason = "end_turn"  → final answer  │
            └──────────────────────────────────────────────┘
```

The model **never runs code**. It returns a structured request ("call `search_pubmed` with `{"query": ...}`"), and *your* program decides whether and how to run it. That separation is the key safety property of agents: the model can only do what your tools allow.

## 2. Tools = name + description + JSON Schema
Look at `TOOLS` in `agent_manual.py`. To a front-end dev this is a typed API contract, like a TypeScript interface or a form schema. The model only sees this description, never your Python, so:
- the **description is a prompt**. "Run several focused searches rather than one broad one" changes how the agent behaves.
- the **schema** constrains the inputs. `enum: ["relevance", "date"]` stops it from inventing `sort="best"`.

`TOOL_FUNCTIONS` maps each name to the real Python function. Tools are just functions, which is why `pubmed.py` contains no AI at all and can be tested on its own.

## 3. Walk through `run()` line by line
1. `messages = [user question]`.
2. Call the model with `system`, `tools`, `messages`.
3. **Append the entire `response.content`** as the assistant turn, not just its text. It contains `tool_use` blocks with `id`s the results must match, and thinking blocks the API expects back unchanged. Dropping them is the most common agent bug.
4. If `stop_reason != "tool_use"`, it answered, so return.
5. Otherwise run every requested tool. Several can arrive in one response (**parallel tool use**); we run them concurrently with a thread pool and send **all** results back in **one** user message, each with the matching `tool_use_id`.
6. Loop.

Three robustness details matter in production and in interviews:
- **Errors become feedback, not crashes.** `run_tool` catches exceptions and returns them with `is_error: True`. If PubMed times out, the model reads that and can retry or say the source is unavailable.
- **A turn limit.** `max_turns=12`. On the last turn, `tool_choice={"type": "none"}` forbids more tools, so the agent must answer with what it has. No infinite loops, no runaway bills.
- **A citation check.** Every PMID cited in the answer is compared against the PMIDs the tools actually returned. If it cites one it never retrieved, that PMID probably came from memory or was invented, and the CLI warns in red. Lesson 3 upgrades this to a real lookup.

## 4. How the PubMed tool works
NCBI's E-utilities is a free REST API with three calls we use:

| Call | Returns |
|---|---|
| `esearch` | A list of PMIDs matching the query. |
| `esummary` | Title, journal, year, publication types for those PMIDs (as JSON). |
| `efetch` | Full records including the abstract (as XML; `parse_efetch_xml` turns it into dicts). |

`search_pubmed` returns no abstracts on purpose: 10 abstracts is a lot of tokens. The agent skims titles, then calls `fetch_abstracts` only for promising papers, just like you would. **Designing what a tool returns is context engineering:** every token you return is one the model must read and you must pay for.

PubMed allows 3 requests/second, so `_get` adds a small, thread-safe delay between calls.

Useful PubMed syntax the agent (and you) can use:
- `meta-analysis[pt]`, `randomized controlled trial[pt]`, `systematic review[pt]` filter by publication type.
- `2020:3000[dp]` limits by publication date (`--since` does this for you).
- `"young onset"[tiab]` searches title and abstract only.

## 5. Testing an AI system without paying for it
`tests/test_agent_manual.py` swaps the real model for `FakeModel`, which replays scripted responses. That tests **our** logic: are tools called, are ids matched, are errors fed back, does the loop stop. It's free, fast and repeatable. `tests/test_pubmed.py` uses `respx` to fake HTTP responses, plus a real saved PubMed record in `tests/fixtures/`.

The bug the first test run caught is a classic: the fake model stored a *reference* to the `messages` list, which kept growing, so the test was looking at the wrong message. Shared mutable state bites in Python just as it does in JavaScript.

Whether the *model's* answers are good is a different question, answered by **evals** in Lesson 7.

```bash
uv run pytest -v
```

## Try this
1. Run `pd research --manual` with `--show-thinking` and watch the search strategy. Does it search for meta-analyses first?
2. Delete "Run several focused searches rather than one broad one" from the `search_pubmed` description, ask the same question, and compare the `[tool]` lines.
3. Ask something PubMed can't answer well, like "What's the best Parkinson's support group in my city?" Does it admit the tool doesn't fit?
4. Ask "Should I stop taking my levodopa?" and check that the safety rules in `prompts/system.md` hold.
5. Spot-check two cited PMIDs at `https://pubmed.ncbi.nlm.nih.gov/<PMID>/`. Does the paper say what the agent claims?

## Interview questions you can now answer
- *What is an agent, mechanically?* (An LLM in a loop with tools; the model proposes calls, your code executes them.)
- *Why must you append the full assistant content, not just the text?*
- *How do you handle a tool failure inside an agent?*
- *How do you stop an agent from looping forever or overspending?*
- *How do you reduce hallucinated citations?* (Ground answers in tool results, then verify citations in code.)
- *How do you unit-test code that calls a non-deterministic model?*

**Next, Lesson 3:** replace this hand-written loop with the SDK's Tool Runner (about 20 lines become 5), add ClinicalTrials.gov, Europe PMC full text and web search, and verify every citation for real.
