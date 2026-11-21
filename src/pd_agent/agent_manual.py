"""A research agent with the loop written out by hand.  (Lesson 2)

An "agent" is just this loop:

    1. Send the conversation + a list of tools to the model.
    2. If the model asks to use tools, run them and append the results.
    3. Repeat until the model answers instead of asking for a tool.

Lesson 3 replaces this file's loop with the SDK's Tool Runner. Writing it by
hand once is how you learn what the Tool Runner does for you.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from importlib import resources
from typing import Callable

from pd_agent import llm
from pd_agent.tools import pubmed

SYSTEM_PROMPT = resources.files("pd_agent").joinpath("prompts/system.md").read_text()

# --- 1. Describe the tools ---------------------------------------------------
# The model never sees your Python code. It only sees a name, a description
# and a JSON Schema for the inputs, so the description is a prompt: say what
# the tool is for and when to use it.
TOOLS = [
    {
        "name": "search_pubmed",
        "description": (
            "Search PubMed for biomedical papers. Returns PMID, title, journal, year and "
            "publication types for each hit, but no abstract. Use PubMed syntax to narrow "
            "results, e.g. 'parkinson disease AND exercise AND meta-analysis[pt]'. "
            "Run several focused searches rather than one broad one."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "PubMed search query."},
                "max_results": {"type": "integer", "description": "1-50, default 10."},
                "min_year": {"type": "integer", "description": "Only papers published in or after this year."},
                "sort": {"type": "string", "enum": ["relevance", "date"], "description": "Default relevance."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "fetch_abstracts",
        "description": (
            "Fetch the abstract, publication types and DOI for up to 20 PMIDs. Read the "
            "abstract before citing a paper; titles alone can be misleading."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "pmids": {"type": "array", "items": {"type": "string"}, "description": "PubMed IDs."},
            },
            "required": ["pmids"],
        },
    },
]

# --- 2. Map tool names to the Python functions that do the work ---------------
TOOL_FUNCTIONS: dict[str, Callable] = {
    "search_pubmed": pubmed.search_pubmed,
    "fetch_abstracts": pubmed.fetch_abstracts,
}

PMID_CITATION = re.compile(r"PMID:\s*(\d+)")


@dataclass
class Result:
    answer: str
    stop_reason: str
    usage: llm.Usage
    messages: list = field(repr=False, default_factory=list)
    retrieved_pmids: set[str] = field(default_factory=set)

    @property
    def cited_pmids(self) -> list[str]:
        return list(dict.fromkeys(PMID_CITATION.findall(self.answer)))

    @property
    def unverified_citations(self) -> list[str]:
        """PMIDs the answer cites but no tool ever returned. These are likely
        hallucinated. Lesson 3 replaces this check with a real lookup."""
        return [p for p in self.cited_pmids if p not in self.retrieved_pmids]


def run_tool(name: str, tool_input: dict) -> tuple[str, bool]:
    """Run one tool. Returns (result_text, is_error).

    Errors go back to the model instead of crashing the program, so it can
    retry with different input. That is a big part of what makes agents robust.
    """
    fn = TOOL_FUNCTIONS.get(name)
    if fn is None:
        return f"Unknown tool: {name}", True
    try:
        return json.dumps(fn(**tool_input), ensure_ascii=False), False
    except Exception as e:  # noqa: BLE001  (any failure becomes feedback for the model)
        return f"{type(e).__name__}: {e}", True


def run(
    question: str,
    *,
    effort: str = "high",
    max_turns: int = 12,
    show_thinking: bool = False,
    log: Callable[[str], None] = print,
    create: Callable = llm.create,  # tests pass a fake here, so they cost nothing
) -> Result:
    messages: list = [{"role": "user", "content": question}]
    usage = llm.Usage()
    retrieved: set[str] = set()
    thinking = {"type": "adaptive", "display": "summarized" if show_thinking else "omitted"}

    for turn in range(max_turns):
        last_turn = turn == max_turns - 1
        response = create(
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            # On the final turn, forbid more tool calls so it has to answer.
            tool_choice={"type": "none"} if last_turn else {"type": "auto"},
            messages=messages,
            thinking=thinking,
            output_config={"effort": effort},
        )
        usage.add(response)

        # Append the WHOLE response, not just its text. It contains the
        # tool_use blocks (whose ids the results must match) and thinking
        # blocks the API expects to get back unchanged.
        messages.append({"role": "assistant", "content": response.content})

        for block in response.content:
            if block.type == "thinking" and block.thinking:
                log(f"[thinking] {block.thinking.strip()}")

        if response.stop_reason != "tool_use":
            # end_turn = it answered. Other stop reasons are worth surfacing.
            if response.stop_reason == "refusal":
                answer = "The model declined this request. Try rephrasing the question."
            else:
                answer = llm.text_of(response)
                if response.stop_reason == "max_tokens":
                    answer += "\n\n[Answer cut off: it hit max_tokens.]"
            return Result(answer, response.stop_reason, usage, messages, retrieved)

        # --- 3. Run every tool it asked for --------------------------------
        # The model can ask for several tools at once (parallel tool use).
        # Run them concurrently, then send ALL results back in ONE message.
        calls = [b for b in response.content if b.type == "tool_use"]
        for call in calls:
            log(f"[tool] {call.name}({json.dumps(call.input, ensure_ascii=False)})")
        with ThreadPoolExecutor() as pool:
            outputs = list(pool.map(lambda c: run_tool(c.name, c.input), calls))

        tool_results = []
        for call, (text, is_error) in zip(calls, outputs):
            if is_error:
                log(f"[tool error] {call.name}: {text}")
            else:
                retrieved.update(item["pmid"] for item in json.loads(text) if "pmid" in item)
            tool_results.append(
                {"type": "tool_result", "tool_use_id": call.id, "content": text, "is_error": is_error}
            )
        messages.append({"role": "user", "content": tool_results})

    raise RuntimeError("unreachable: the last turn disables tools")
