"""The research agent, built on the SDK's Tool Runner.  (Lessons 3-5)

Compare with agent_manual.py: the loop is gone. The Tool Runner sends the
request, runs whichever tools the model asks for, appends the results, and
repeats. What's left for us is the part that's actually ours: the tools,
the prompt, the guardrails, and checking the result.
"""

from __future__ import annotations

import functools
import json
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Literal

from anthropic import beta_tool

from pd_agent import llm, profile
from pd_agent.memory import Memory
from pd_agent.tools import europepmc, pubmed, trials, verify

# Server-side tool: runs on Anthropic's servers, so there's no Python function
# for it. Capped at 3 searches per question.
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}

EventHandler = Callable[[str, dict], None]


class Session:
    """State for one question: what was retrieved, how much budget is left,
    and who to tell about progress (the CLI prints events, the web server
    streams them to the browser)."""

    def __init__(self, memory: Memory, on_event: EventHandler, tool_budget: int = 20):
        self.memory = memory
        self.on_event = on_event
        self.tool_budget = tool_budget
        self.tool_calls = 0
        self.retrieved: set[str] = set()

    def track(self, fn: Callable) -> Callable:
        """Wrap a tool: announce the call, enforce the budget, remember which
        IDs it returned, and serialise the result for the model."""

        @functools.wraps(fn)
        def wrapper(**kwargs: Any) -> str:
            self.on_event("tool", {"name": fn.__name__, "input": kwargs})
            if self.tool_calls >= self.tool_budget:
                return "Tool budget used up. Answer now with the evidence you already have."
            self.tool_calls += 1
            result = fn(**kwargs)
            self._collect_ids(result)
            return json.dumps(result, ensure_ascii=False)

        return wrapper

    def _collect_ids(self, value: Any) -> None:
        if isinstance(value, list):
            for v in value:
                self._collect_ids(v)
        elif isinstance(value, dict):
            for key in ("pmid", "nct_id"):
                if value.get(key):
                    self.retrieved.add(str(value[key]))
            for v in value.values():
                if isinstance(v, (list, dict)):
                    self._collect_ids(v)


def build_tools(s: Session) -> list:
    """Each tool is a plain function. `@beta_tool` turns its signature and
    docstring into the JSON schema the model sees, which is the hand-written
    TOOLS list from Lesson 2, generated for us."""

    @beta_tool
    @s.track
    def search_pubmed(
        query: str, max_results: int = 10, min_year: int | None = None, sort: Literal["relevance", "date"] = "relevance"
    ):
        """Search PubMed for biomedical papers; returns PMID, title, journal, year and publication types but no abstract. Use PubMed syntax to narrow results, e.g. 'parkinson disease AND exercise AND meta-analysis[pt]'. Run several focused searches rather than one broad one.

        Args:
            query: PubMed search query.
            max_results: Number of results, 1-50.
            min_year: Only papers published in or after this year.
            sort: "relevance" or "date" (newest first).
        """
        return pubmed.search_pubmed(query, max_results=max_results, min_year=min_year, sort=sort)

    @beta_tool
    @s.track
    def fetch_abstracts(pmids: list[str]):
        """Fetch abstract, publication types and DOI for up to 20 PMIDs. Read the abstract before citing a paper.

        Args:
            pmids: PubMed IDs.
        """
        return pubmed.fetch_abstracts(pmids)

    @beta_tool
    @s.track
    def search_europepmc(query: str, max_results: int = 10):
        """Search Europe PMC for open-access papers whose full text can be read with read_full_text. Results include PMID and PMCID.

        Args:
            query: Search terms.
            max_results: Number of results, 1-50.
        """
        return europepmc.search_europepmc(query, max_results=max_results)

    @beta_tool
    @s.track
    def read_full_text(pmcid: str, section: str | None = None):
        """Read an open-access paper's full text (from its PMCID). Use only when the abstract lacks a detail that matters, such as exercise dose or who was included. Pass section (e.g. "methods") to read just part of it.

        Args:
            pmcid: PubMed Central ID, e.g. PMC1234567.
            section: Optional heading to filter on, e.g. "methods" or "results".
        """
        return europepmc.read_full_text(pmcid, section)

    @beta_tool
    @s.track
    def search_trials(
        query: str = "",
        status: Literal["recruiting", "not_yet_recruiting", "active", "completed"] = "recruiting",
        age: int | None = None,
        location: str | None = None,
        max_results: int = 10,
    ):
        """Search ClinicalTrials.gov for Parkinson's disease studies. Returns NCT ID, title, status, phase, interventions, age range and sites.

        Args:
            query: Extra terms, e.g. "exercise" or "LRRK2". Leave empty for all Parkinson's trials.
            status: Recruitment status.
            age: Keep only trials whose age range includes this age.
            location: Country or city, e.g. "India".
            max_results: Number of results, 1-50.
        """
        return trials.search_trials(query, status=status, age=age, location=location, max_results=max_results)

    @beta_tool
    @s.track
    def get_trial(nct_id: str):
        """Full details of one trial, including eligibility criteria. Use before describing who can join.

        Args:
            nct_id: The trial's NCT ID, e.g. NCT01234567.
        """
        return trials.get_trial(nct_id)

    @beta_tool
    @s.track
    def recall(query: str, limit: int = 5):
        """Search the person's saved notes and earlier research answers. Check this first: they may have asked something similar before.

        Args:
            query: Words to search for.
            limit: Number of notes to return.
        """
        return s.memory.search(query, limit=limit)

    @beta_tool
    @s.track
    def remember(title: str, content: str, tags: list[str] | None = None, sources: list[str] | None = None):
        """Save a note for the future: something the person asked you to remember, or a short summary of a substantial finding with its citations.

        Args:
            title: Short title.
            content: The note, in markdown, with citations.
            tags: A few lowercase topic tags, e.g. ["exercise", "sleep"].
            sources: IDs cited, e.g. ["PMID:123", "NCT01234567"].
        """
        note_id = s.memory.add_note(title, content, tags=tags, sources=sources)
        return {"saved": True, "note_id": note_id}

    return [search_pubmed, fetch_abstracts, search_europepmc, read_full_text, search_trials, get_trial, recall, remember]


@dataclass
class Result:
    answer: str
    stop_reason: str
    usage: llm.Usage
    citations: list[dict] = field(default_factory=list)
    retrieved: set[str] = field(default_factory=set)
    tool_calls: int = 0

    @property
    def failed_citations(self) -> list[str]:
        """IDs that don't exist at the source: hallucinated or mistyped."""
        return [c["id"] for c in self.citations if not c["exists"]]

    @property
    def unretrieved_citations(self) -> list[str]:
        """IDs that exist but that no tool returned in this conversation, so
        the model cited them from memory rather than from something it read."""
        return [
            c["id"] for c in self.citations if c["exists"] and c["id"].removeprefix("PMID:") not in self.retrieved
        ]


def run(
    question: str,
    *,
    effort: str = "high",
    history: list[tuple[str, str]] | None = None,
    show_thinking: bool = False,
    on_event: EventHandler | None = None,
    memory: Memory | None = None,
    tool_budget: int = 20,
    use_web: bool = True,
    verify_citations: bool = True,
    demo_profile: bool = False,
    tool_runner: Callable = llm.tool_runner,  # tests pass a fake
) -> Result:
    emit = on_event or (lambda kind, data: None)
    session = Session(memory or Memory(), emit, tool_budget)

    # Earlier turns of a chat, as plain text. The API is stateless (Lesson 1).
    messages: list = []
    for q, a in history or []:
        messages += [{"role": "user", "content": q}, {"role": "assistant", "content": a}]
    # The date goes here, not in the system prompt: a value that changes
    # daily at the top of the prompt would invalidate the cache (Lesson 4).
    messages.append({"role": "user", "content": f"(Today is {date.today():%d %B %Y}.)\n\n{question}"})

    tools = build_tools(session) + ([WEB_SEARCH] if use_web else [])
    runner = tool_runner(
        system=profile.system_blocks(demo=demo_profile),
        tools=tools,
        messages=messages,
        thinking={"type": "adaptive", "display": "summarized" if show_thinking else "omitted"},
        output_config={"effort": effort},
        max_iterations=30,
    )

    usage = llm.Usage()
    final = None
    for message in runner:  # one assistant message per loop turn
        usage.add(message)
        final = message
        for block in message.content:
            if block.type == "thinking" and block.thinking:
                emit("thinking", {"text": block.thinking.strip()})
            elif block.type == "server_tool_use":
                emit("tool", {"name": block.name, "input": block.input})

    if final.stop_reason == "refusal":
        answer = "The model declined this request. Try rephrasing the question."
    else:
        answer = llm.text_of(final)
        if final.stop_reason == "max_tokens":
            answer += "\n\n*[Answer cut off: it hit the length limit.]*"
        elif final.stop_reason == "tool_use":
            answer += "\n\n*[Stopped: reached the maximum number of steps.]*"

    citations: list[dict] = []
    if verify_citations:
        emit("status", {"message": "Checking citations against PubMed and ClinicalTrials.gov…"})
        try:
            citations = verify.verify_citations(answer)
        except Exception as e:  # noqa: BLE001  (an outage shouldn't lose the answer)
            emit("status", {"message": f"Citation check unavailable: {e}"})

    return Result(answer, final.stop_reason, usage, citations, session.retrieved, session.tool_calls)
