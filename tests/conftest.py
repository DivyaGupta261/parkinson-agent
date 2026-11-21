"""Shared test helpers: fake model messages, so tests never call the API."""

from types import SimpleNamespace as NS

import pytest

from pd_agent.tools import pubmed


def fake_message(stop_reason, *blocks, model="claude-opus-5-5"):
    return NS(
        content=list(blocks),
        stop_reason=stop_reason,
        model=model,
        usage=NS(input_tokens=1000, output_tokens=200, cache_creation_input_tokens=0, cache_read_input_tokens=500),
    )


def text(t):
    return NS(type="text", text=t)


def tool_use(id_, name, input_):
    return NS(type="tool_use", id=id_, name=name, input=input_)


def parsed(obj, stop_reason="end_turn"):
    """A fake `parse()` response carrying a structured-output object."""
    msg = fake_message(stop_reason)
    msg.parsed_output = obj
    return msg


@pytest.fixture(autouse=True)
def no_rate_limit_sleep(monkeypatch):
    monkeypatch.setattr(pubmed, "_MIN_INTERVAL", 0)
