"""Agent-loop tests with a scripted fake model.

The real model is non-deterministic and costs money, so to test the *loop*
(does it run tools, send results back with matching ids, stop when done?)
we swap `create` for a fake that replays canned responses.
"""

import json
from types import SimpleNamespace as NS

from pd_agent import agent_manual


def fake_message(stop_reason, *blocks):
    return NS(
        content=list(blocks),
        stop_reason=stop_reason,
        model="claude-opus-5-5",
        usage=NS(input_tokens=100, output_tokens=50, cache_creation_input_tokens=0, cache_read_input_tokens=0),
    )


def text(t):
    return NS(type="text", text=t)


def tool_use(id_, name, input_):
    return NS(type="tool_use", id=id_, name=name, input=input_)


class FakeModel:
    """Returns the scripted responses in order and records every request."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, **kwargs):
        # Copy the list: the agent keeps appending to the same `messages`
        # object, so storing it directly would show its *final* state.
        self.requests.append(kwargs | {"messages": list(kwargs["messages"])})
        return self.responses.pop(0)


def test_loop_runs_tool_and_returns_answer(monkeypatch):
    monkeypatch.setitem(
        agent_manual.TOOL_FUNCTIONS,
        "search_pubmed",
        lambda query, **_: [{"pmid": "111", "title": f"Paper about {query}"}],
    )
    model = FakeModel(
        fake_message("tool_use", text("Let me search."), tool_use("t1", "search_pubmed", {"query": "exercise"})),
        fake_message("end_turn", text("Exercise helps [PMID:111].")),
    )

    result = agent_manual.run("Does exercise help?", create=model, log=lambda _: None)

    assert result.answer == "Exercise helps [PMID:111]."
    assert result.usage.calls == 2
    assert result.unverified_citations == []

    # The second request must carry the tool result, matched by tool_use_id.
    tool_result_msg = model.requests[1]["messages"][-1]
    assert tool_result_msg["role"] == "user"
    [block] = tool_result_msg["content"]
    assert block["tool_use_id"] == "t1"
    assert block["is_error"] is False
    assert json.loads(block["content"])[0]["pmid"] == "111"


def test_parallel_tool_calls_go_back_in_one_message(monkeypatch):
    monkeypatch.setitem(agent_manual.TOOL_FUNCTIONS, "search_pubmed", lambda query, **_: [])
    model = FakeModel(
        fake_message(
            "tool_use",
            tool_use("a", "search_pubmed", {"query": "sleep"}),
            tool_use("b", "search_pubmed", {"query": "REM behaviour disorder"}),
        ),
        fake_message("end_turn", text("Done.")),
    )
    agent_manual.run("q", create=model, log=lambda _: None)
    results = model.requests[1]["messages"][-1]["content"]
    assert [r["tool_use_id"] for r in results] == ["a", "b"]


def test_tool_errors_are_reported_to_the_model_not_raised(monkeypatch):
    def broken(**_):
        raise TimeoutError("PubMed timed out")

    monkeypatch.setitem(agent_manual.TOOL_FUNCTIONS, "search_pubmed", broken)
    model = FakeModel(
        fake_message("tool_use", tool_use("t1", "search_pubmed", {"query": "x"})),
        fake_message("end_turn", text("PubMed is unavailable right now.")),
    )
    result = agent_manual.run("q", create=model, log=lambda _: None)
    [block] = model.requests[1]["messages"][-1]["content"]
    assert block["is_error"] is True
    assert "timed out" in block["content"]
    assert result.answer == "PubMed is unavailable right now."


def test_flags_citations_that_no_tool_returned():
    model = FakeModel(fake_message("end_turn", text("Studies show X [PMID:99999999].")))
    result = agent_manual.run("q", create=model, log=lambda _: None)
    assert result.unverified_citations == ["99999999"]


def test_last_turn_disables_tools(monkeypatch):
    monkeypatch.setitem(agent_manual.TOOL_FUNCTIONS, "search_pubmed", lambda **_: [])
    model = FakeModel(
        fake_message("tool_use", tool_use("t1", "search_pubmed", {"query": "x"})),
        fake_message("end_turn", text("Best answer with what I found.")),
    )
    agent_manual.run("q", create=model, max_turns=2, log=lambda _: None)
    assert model.requests[0]["tool_choice"] == {"type": "auto"}
    assert model.requests[1]["tool_choice"] == {"type": "none"}
