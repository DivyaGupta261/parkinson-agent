# Lesson 3: The Tool Runner, more tools, and real citation checks

**Goal:** stop hand-writing the loop, give the agent more sources, and verify every citation at its source.
**Code:** `src/pd_agent/agent.py`, `src/pd_agent/tools/{trials,europepmc,verify,http}.py`, `tests/test_agent.py`, `tests/test_tools.py`.

```bash
uv run pd trials exercise --age 42                     # no AI: ClinicalTrials.gov directly
uv run pd research "Are there recruiting trials a 42-year-old with Parkinson's could join?"
uv run pd research "How much exercise, at what intensity, did the SPARX trial use?" --show-thinking
```

## 1. The Tool Runner: the loop you wrote, done for you
Lesson 2's `agent_manual.py` has about 40 lines of loop: call, check `stop_reason`, run tools, match `tool_use_id`s, append, repeat. The SDK's **Tool Runner** does exactly that:

```python
runner = client.beta.messages.tool_runner(model=..., tools=[search_pubmed, ...], messages=[...])
for message in runner:      # one assistant message per turn of the loop
    ...                     # we just watch: log tool calls, add up usage
```

And the hand-written JSON schemas are gone too. `@beta_tool` reads a normal Python function and generates the schema from its **type hints** and **docstring**:

```python
@beta_tool
def search_trials(query: str = "", status: Literal["recruiting", ...] = "recruiting", age: int | None = None, ...):
    """Search ClinicalTrials.gov for Parkinson's disease studies. ...

    Args:
        age: Keep only trials whose age range includes this age.
    """
```
`Literal[...]` becomes an `enum`, `int | None` becomes an optional integer, and the docstring becomes the descriptions. This is the same idea as Zod or TypeScript types generating validation for you. If a tool raises an exception, the runner returns it to the model with `is_error: true`, just like our manual loop did.

**Why learn the manual loop first?** Because when something goes wrong in the runner, you'll know what it's doing underneath. Interviewers like asking candidates to "implement a tool loop without a framework".

## 2. Cross-cutting concerns: `Session.track`
Every tool is wrapped by `Session.track`, which:
1. emits a `tool` event (the CLI prints it; Lesson 8's web server streams it to the browser);
2. enforces a **tool budget** (20 calls). Past it, the tool returns *"budget used up, answer now"*, a gentle stop the model understands;
3. records every PMID/NCT ID the tools return (`session.retrieved`);
4. serialises the result to JSON.

This is the decorator pattern, and it keeps the tools themselves free of plumbing.

## 3. The new tools

| Tool | Source | Why |
|---|---|---|
| `search_trials`, `get_trial` | ClinicalTrials.gov API v2 | Studies you might join, with age range and sites. |
| `search_europepmc`, `read_full_text` | Europe PMC | Full text of open-access papers, for details abstracts leave out (dose, intensity). Capped at 30k characters, and the model can ask for one section only. |
| `recall`, `remember` | Your notebook (Lesson 5) | Builds on earlier answers. |
| `web_search` | **Server tool**, run by Anthropic | News and organisations. No Python needed: it's a dict in the tools list (`WEB_SEARCH` in `agent.py`), capped at 3 uses. |

Server tools vs client tools is a common interview question. **Client tools** (ours) run in our process; the model asks and we execute. **Server tools** run on Anthropic's side and their results come back inside the same response (as `server_tool_use` / `web_search_tool_result` blocks).

## 4. Two real bugs caught by checking live data
Every tool function was tested against real API responses, and that caught two **silent** bugs in `search_trials`. Neither raised an error; both just returned wrong results:

1. **The age filter dropped most trials.** `RANGE[...]` on `MaximumAge` excludes trials that set *no* maximum age, which is most of them. For one test age: 184 trials instead of 428. Fix: treat a missing limit as a match (`... OR AREA[MaximumAge]MISSING`).
2. **"Parkinson Disease" matched cancer trials.** ClinicalTrials.gov expands the condition search to synonyms, including "PD", which also matches **PD-1** immunotherapy trials. A search for trials in India returned four cancer studies. Fix: match the listed condition exactly (`AREA[Condition]Parkinson*`).

Both now have regression tests in `tests/test_tools.py`. The lesson: **an agent is only as good as its tools, and a tool can be confidently wrong.** The model can't tell that a cervical-cancer trial shouldn't be in a Parkinson's search result; it trusts what tools return. Test tools against real responses, and read the output yourself.

## 5. Retries: `tools/http.py`
Europe PMC returned `503 Service Unavailable` during development. Public APIs do that. `http.get` retries 429/5xx errors and timeouts with exponential backoff (1.5s, 3s, 6s). 404s are returned rather than retried: "not found" is an answer, not a failure.

## 6. Citation verification, for real
Lesson 2 checked "did a tool return this PMID?". `tools/verify.py` now looks every cited ID up at its source after the answer is written:

| Status | Meaning |
|---|---|
| ✅ verified | Exists, and a tool returned it in this conversation. |
| 🟡 real, but not retrieved | Exists, but the model cited it from memory. It might be right, but it wasn't read. |
| 🔴 NOT FOUND | Doesn't exist. A hallucinated or mistyped ID. |

The check runs in **code, after the model**, so no prompt or model behaviour can get around it. It's a strong portfolio point: *"I don't trust the model's citations; I verify them deterministically."*

## Try this
1. Run `pd trials --age 42` and then the same question through `pd research`. Does the agent use `get_trial` before describing eligibility?
2. Remove the docstring's first line from `search_trials` and print `tool.to_dict()` to see what the model loses.
3. Set `tool_budget=3` in `agent.run` and ask a broad question. How does the answer change?
4. In a Python shell, run `verify.verify_citations("see [PMID:12345678901]")`.

## Interview questions you can now answer
- *What does a tool-runner abstraction do, and when would you write the loop yourself?*
- *Client tools vs server tools?*
- *How do you keep a tool's output from blowing up the context window?* (Return summaries, cap full text, read one section on demand.)
- *How do you verify LLM citations?*
- *Describe a bug where a tool returned plausible but wrong data.* (You now have two.)
