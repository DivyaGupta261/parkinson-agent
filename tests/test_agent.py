"""Lessons 3-5: the Tool Runner agent and memory, with a fake runner."""

import pytest

from conftest import fake_message, text, tool_use
from pd_agent import agent
from pd_agent.memory import Memory


class FakeRunner:
    """Imitates `tool_runner`: yields scripted assistant messages and actually
    calls the tools they ask for, the same way the SDK does."""

    def __init__(self, *messages):
        self.messages = messages
        self.kwargs = None
        self.tool_outputs = []

    def __call__(self, **kwargs):
        self.kwargs = kwargs
        tools = {t.name: t for t in kwargs["tools"] if hasattr(t, "call")}
        for message in self.messages:
            yield message
            for block in message.content:
                if block.type == "tool_use":
                    self.tool_outputs.append(tools[block.name].call(block.input))


@pytest.fixture
def memory():
    return Memory(":memory:")


def test_agent_runs_tools_and_tracks_retrieved_ids(monkeypatch, memory):
    monkeypatch.setattr(agent.pubmed, "search_pubmed", lambda q, **_: [{"pmid": "111", "title": "T"}])
    events = []
    runner = FakeRunner(
        fake_message("tool_use", tool_use("t1", "search_pubmed", {"query": "exercise"})),
        fake_message("end_turn", text("Exercise helps [PMID:111].")),
    )
    result = agent.run("q", memory=memory, tool_runner=runner, verify_citations=False,
                       on_event=lambda k, d: events.append((k, d)))
    assert result.answer == "Exercise helps [PMID:111]."
    assert result.retrieved == {"111"}
    assert result.tool_calls == 1
    assert result.usage.calls == 2
    assert events == [("tool", {"name": "search_pubmed", "input": {"query": "exercise", "max_results": 10,
                                                                    "min_year": None, "sort": "relevance"}})]


def test_date_goes_in_user_message_not_system(memory):
    runner = FakeRunner(fake_message("end_turn", text("hi")))
    agent.run("q", memory=memory, tool_runner=runner, verify_citations=False)
    system_text = " ".join(b["text"] for b in runner.kwargs["system"])
    assert "Today is" not in system_text
    assert runner.kwargs["messages"][-1]["content"].startswith("(Today is ")


def test_web_search_server_tool_is_optional(memory):
    runner = FakeRunner(fake_message("end_turn", text("hi")))
    agent.run("q", memory=memory, tool_runner=runner, verify_citations=False, use_web=False)
    assert agent.WEB_SEARCH not in runner.kwargs["tools"]


def test_tool_budget(monkeypatch, memory):
    monkeypatch.setattr(agent.pubmed, "search_pubmed", lambda q, **_: [])
    runner = FakeRunner(
        fake_message("tool_use", tool_use("a", "search_pubmed", {"query": "x"})),
        fake_message("tool_use", tool_use("b", "search_pubmed", {"query": "y"})),
        fake_message("end_turn", text("done")),
    )
    agent.run("q", memory=memory, tool_runner=runner, verify_citations=False, tool_budget=1)
    assert runner.tool_outputs[0] == "[]"
    assert "budget used up" in runner.tool_outputs[1]


def test_remember_then_recall(memory):
    runner = FakeRunner(
        fake_message("tool_use", tool_use("a", "remember", {"title": "Sleep", "content": "RBD can precede PD [PMID:5]",
                                                              "tags": ["sleep"], "sources": ["PMID:5"]})),
        fake_message("tool_use", tool_use("b", "recall", {"query": "sleep RBD"})),
        fake_message("end_turn", text("ok")),
    )
    agent.run("q", memory=memory, tool_runner=runner, verify_citations=False)
    assert '"title": "Sleep"' in runner.tool_outputs[1]
    assert memory.search("sleep")[0]["sources"] == ["PMID:5"]


def test_history_is_replayed_as_turns(memory):
    runner = FakeRunner(fake_message("end_turn", text("hi")))
    agent.run("follow-up", history=[("first q", "first a")], memory=memory, tool_runner=runner, verify_citations=False)
    roles = [m["role"] for m in runner.kwargs["messages"]]
    assert roles == ["user", "assistant", "user"]


def test_citation_classification():
    r = agent.Result("a", "end_turn", None, citations=[
        {"id": "PMID:1", "exists": True}, {"id": "PMID:2", "exists": True}, {"id": "PMID:3", "exists": False},
        {"id": "NCT01234567", "exists": True}], retrieved={"1", "NCT01234567"})
    assert r.failed_citations == ["PMID:3"]
    assert r.unretrieved_citations == ["PMID:2"]


def test_refusal_is_reported(memory):
    runner = FakeRunner(fake_message("refusal"))
    result = agent.run("q", memory=memory, tool_runner=runner, verify_citations=False)
    assert "declined" in result.answer


def test_memory_search_ranks_and_handles_punctuation(memory):
    memory.add_note("Exercise and progression", "High-intensity treadmill exercise ...", tags=["exercise"])
    memory.add_note("Sleep", "REM sleep behaviour disorder ...", tags=["sleep"])
    assert memory.search("exercise?")[0]["title"] == "Exercise and progression"
    assert memory.search('"; DROP TABLE notes; --') == []  # FTS syntax can't be injected
    assert len(memory.recent()) == 2


def test_memory_seen_tracking(memory):
    memory.mark_seen(["PMID:1"])
    assert memory.filter_unseen(["PMID:1", "PMID:2"]) == ["PMID:2"]
