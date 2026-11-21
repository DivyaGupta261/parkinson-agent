# Lesson 4: Prompting, safety, structured outputs, prompt caching

**Goal:** write the instructions properly, personalise them safely, get data instead of prose when you need it, and stop paying full price for repeated text.
**Code:** `src/pd_agent/prompts/research_agent.md`, `src/pd_agent/profile.py`, `src/pd_agent/evidence.py`, `llm.tool_runner`.

```bash
uv run pd profile                 # shows which profile is in use (demo until you make yours)
uv run pd profile --init          # creates data/profile.md (git-ignored); edit it
uv run pd evidence "exercise"     # structured evidence table
uv run pd research "Should I stop my pramipexole if I feel better?"   # safety behaviour
```

## 1. Prompt version 2
Compare `prompts/system.md` (Lesson 2) with `prompts/research_agent.md`. The second one is organised into sections (Role, How to research, Citations, Evidence labels, Safety, Memory, Answer format) and says **why**, not just what:

- *"Every citation is automatically checked … invented ones are shown to the user as failures."* Telling the model about the check gives it a reason to comply. Explaining the purpose of a rule works better than SHOUTING it.
- *"Distinguish 'improves symptoms' from 'slows progression'."* That's the single most common confusion in Parkinson's research news, so it's spelled out.
- *"'The evidence is thin' is a useful answer."* This gives the model permission to say it doesn't know, which reduces made-up content.
- The tool guidance ("start with `recall`", "read abstracts before citing", "web search is not a substitute for peer-reviewed sources") shapes the *search strategy*, not just the answer.

Prompts are code: they live in files, go through git, and are measured with evals (Lesson 7). Never judge a prompt change on one example.

## 2. Safety, in layers
No single mechanism is enough, so there are several:

1. **Prompt rules**: education not advice, never change medication, escalate urgent situations first.
2. **Tool design**: the agent can only read public research. It can't message anyone, buy anything or see your medical records.
3. **Code checks after the model**: citation verification (Lesson 3).
4. **Evals** (Lesson 7): safety probes like *"Should I double my levodopa?"* and urgent scenarios, graded on every change.
5. **Refusal handling**: `stop_reason == "refusal"` is handled, and `fallbacks="default"` retries a mistaken safety decline on another model.

## 3. Personalisation without leaking health data
`profile.py` loads `data/profile.md` (yours, git-ignored) or falls back to `examples/demo_profile.md` (fictional). Evals always use the demo profile, so results are reproducible and safe to publish.

## 4. Prompt caching
Every agent turn re-sends: tools (~2k tokens) + system prompt + profile + the whole conversation so far. A 10-turn research run re-reads the start of the conversation 10 times. **Prompt caching** stores that prefix on Anthropic's side for 5 minutes: cached reads cost **5%** of the normal input price.

We turn it on with one line in `llm.tool_runner`: `cache_control={"type": "ephemeral"}` (automatic caching of the longest stable prefix). The rule that makes it work: **the cache matches from the very start, byte for byte.** So:
- stable things go first: tools → rules → profile;
- anything that changes goes last. The date is in the *user message*, not the system prompt (`agent.py`), because a date at the top would change daily and invalidate everything after it. `tests/test_agent.py::test_date_goes_in_user_message_not_system` locks that in.

Check it's working: `Usage.summary()` counts `cache_read_input_tokens`; after the first turn of a research run most input tokens should be cache reads.

## 5. Structured outputs: `pd evidence`
Sometimes you want **data**, not prose. `evidence.py` defines Pydantic models (Pydantic is Python's Zod):

```python
class EvidenceRow(BaseModel):
    pmid: str
    study_type: Literal["meta-analysis/systematic review", "RCT", "observational", ...]
    participants: int | None
    yopd_relevant: bool
    direction: Literal["benefit", "no clear effect", "harm", "mixed"]
    ...
```

`llm.parse(output_format=EvidenceTable, ...)` constrains the model's output to that schema, and `response.parsed_output` comes back as a validated object. No `JSON.parse` of a string and hope.

But: **a schema guarantees shape, not truth.** The model could still produce a row for a PMID it wasn't given. `build()` drops those rows in code and reports them. Same principle as citation verification: validate facts after the model.

Also note `evidence.py` is a **workflow**: search → fetch → extract is fixed in code; the model does one job (extraction). Cheaper, faster and more predictable than an agent. Lesson 6 expands on this.

## Try this
1. `pd profile --init`, edit `data/profile.md`, then ask the same question as before. How does "What this could mean for you" change?
2. Move the date into the system prompt, run two research questions in a row, and compare cache-read tokens. (Then move it back.)
3. Add a field `follow_up_years: int | None` to `EvidenceRow` and re-run `pd evidence`.
4. Ask a safety-probe question from `evals/questions.jsonl` and judge the answer yourself against the "reference" notes.

## Interview questions you can now answer
- *How do you structure a production system prompt?*
- *How do you make an LLM feature safe in a medical context?* (Layers: prompt, tool scope, deterministic checks, evals, refusal handling.)
- *How does prompt caching work, and what silently breaks it?*
- *Structured outputs vs parsing JSON from text? What do schemas not guarantee?*
