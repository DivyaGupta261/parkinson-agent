# Lesson 1: Your first LLM call

**Goal:** understand what actually goes over the wire when you "talk to an AI".
**Code:** `src/pd_agent/llm.py`, and the `hello` and `explain` commands in `src/pd_agent/cli.py`.

```bash
uv run pd hello
uv run pd explain "what dopamine does and why Parkinson's affects movement"
uv run pd explain "the difference between young-onset and late-onset Parkinson's" --effort low
```

## 1. It's just an HTTP API

As a front-end dev you've called hundreds of JSON APIs. This is one more:

```
POST https://api.anthropic.com/v1/messages
{
  "model": "claude-opus-5-5",
  "max_tokens": 1000,
  "system": "You explain Parkinson's topics to ...",
  "messages": [ {"role": "user", "content": "Explain: dopamine"} ]
}
```

The `anthropic` Python package is a typed client around that endpoint, like `axios` with types and automatic retries. `llm.create()` in our code is a thin wrapper that fills in project defaults.

## 2. The parts of a request

| Field | What it does |
|---|---|
| `model` | Which model answers. We use `claude-opus-5-5`. Cheaper, faster models exist (Sonnet, Haiku); Lesson 7 shows how to measure whether a cheaper one is good enough. |
| `system` | Instructions that frame the whole conversation: role, rules, format. The model weights them heavily. Our research rules live in `src/pd_agent/prompts/system.md`. |
| `messages` | The conversation so far: alternating `user` and `assistant` turns. |
| `max_tokens` | Upper limit on the reply length. If it's hit, the reply is cut off mid-sentence and `stop_reason` is `"max_tokens"`. |
| `output_config.effort` | How hard the model thinks: `low` → `max`. More effort means better answers on hard questions, but slower and more tokens. |

### The API is stateless
The server remembers nothing between calls. To have a conversation you send the **entire history every time**. That's the same mental model as a React reducer: `messages` is your state, and each call is `render(state)`. It also explains why long conversations get more expensive: every call re-sends everything (Lesson 4's prompt caching makes the repeated part about 95% cheaper).

## 3. Tokens and cost
Models read and write **tokens**, chunks of roughly ¾ of a word. You pay per token, with output costing more than input:

| Opus 5.5 | per 1M tokens |
|---|---|
| input | $4 |
| output | $20 |

Every response carries `usage` (`input_tokens`, `output_tokens`). The `Usage` class in `llm.py` adds them up and converts to dollars, so every command prints its cost. Making cost visible from day one is a habit that impresses interviewers: "what does a request cost, and how would you cut it?" is a standard question.

## 4. What comes back
A response is not just a string. `response.content` is a **list of blocks**: `text`, `thinking`, `tool_use` (Lesson 2), and more. That's why `llm.text_of()` filters for `type == "text"` instead of reading `content[0]`. The response also tells you:
- `stop_reason`: why it stopped. `end_turn` means it finished; `max_tokens` means it was cut off; `tool_use` means it wants a tool; `refusal` means a safety classifier declined.
- `model`: who actually answered (see fallbacks below).
- `_request_id`: quote this if you ever report a problem to Anthropic.

## 5. Thinking
Opus 5.5 always reasons privately before answering ("adaptive thinking"); `effort` controls how much. By default you don't see the reasoning. Lesson 2's `--show-thinking` flag asks for readable summaries of it, which is useful for learning how the agent decides what to search.

## 6. Streaming
`explain` uses `llm.stream()` so words appear as they're generated, the typing effect from chat apps. It's the same data as a normal response, delivered as server-sent events. You know SSE from the browser (`EventSource`); the SDK hides it behind `stream.text_stream`. Streaming also avoids HTTP timeouts on long answers. Lesson 8 streams to a React UI.

## 7. Refusals and fallbacks
Opus 5.5 runs safety classifiers. Rarely, a legitimate biomedical question gets flagged. `llm.py` sends `fallbacks="default"` (a beta feature, which is why it uses `client.beta.messages`), so the API retries the request on another model inside the same call. If that happens, `Usage.summary()` shows "answered by ...".

## Try this
1. Run `explain` on the same topic with `--effort low` and `--effort high`. Compare quality, length, time and cost.
2. Edit the `system` string in `explain` to "explain it to a 10-year-old", then to "explain it to a neuroscientist". The system prompt is the strongest control you have.
3. Ask `explain` something very recent, like "the latest alpha-synuclein trial results". Notice it can only use what it learned in training, can't cite anything, and may be out of date. **That gap is why Lesson 2 gives it tools.**

## Interview questions you can now answer
- *Why is an LLM API stateless, and what does that mean for cost?*
- *What's the difference between the system prompt and a user message?*
- *What are tokens, and why does output cost more than input?*
- *When would you stream a response?*
- *What does `stop_reason: max_tokens` mean, and how do you handle it?*
