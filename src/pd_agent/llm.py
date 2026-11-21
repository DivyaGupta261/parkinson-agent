"""Everything about talking to Claude lives here, so the rest of the code never
repeats model names, beta flags, or pricing.  (Lesson 1)
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import anthropic
from dotenv import load_dotenv

# The model we build with. Claude Opus 5.5 is the current default Opus model.
MODEL = "claude-opus-5-5"

# Opus 5.5 runs safety classifiers that can occasionally decline a benign
# request (biomedical questions sometimes look like "bio" topics to them).
# `fallbacks="default"` asks the API to quietly retry a declined request on
# the model Anthropic recommends for that case, inside the same call.
# It is a beta feature, so it needs this beta flag and the `client.beta` API.
BETAS = ["server-side-fallback-2026-07-01"]

# USD per million tokens for MODEL (cache writes cost 1.25x input, reads 0.05x).
PRICE_INPUT = 4.00
PRICE_OUTPUT = 20.00
PRICE_CACHE_WRITE = 5.00
PRICE_CACHE_READ = 0.20

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    """Build one shared client. It reads ANTHROPIC_API_KEY from .env."""
    load_dotenv(PROJECT_ROOT / ".env")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit(
            "No ANTHROPIC_API_KEY found.\n"
            "Create one at https://console.anthropic.com (Settings -> API Keys),\n"
            "then put it in .env. See docs/lessons/00-setup.md."
        )
    return anthropic.Anthropic()


def create(**kwargs):
    """`messages.create` with this project's defaults filled in.

    Any argument you pass (system, messages, tools, max_tokens, ...) overrides
    or extends the defaults.
    """
    params = {"model": MODEL, "max_tokens": 16000, "betas": BETAS, "fallbacks": "default"}
    params.update(kwargs)
    return get_client().beta.messages.create(**params)


def stream(**kwargs):
    """Same as `create`, but returns a stream so text appears as it is written.

    Use it as a context manager:  `with llm.stream(...) as s: ...`
    """
    params = {"model": MODEL, "max_tokens": 64000, "betas": BETAS, "fallbacks": "default"}
    params.update(kwargs)
    return get_client().beta.messages.stream(**params)


def tool_runner(**kwargs):
    """The SDK's Tool Runner with project defaults: it runs the agent loop
    from Lesson 2 for us. (Lesson 3)

    `cache_control` turns on automatic prompt caching (Lesson 4): each request
    re-sends the whole conversation, and the cache makes the repeated part
    ~95% cheaper.
    """
    params = {
        "model": MODEL,
        "max_tokens": 16000,
        "betas": BETAS,
        "fallbacks": "default",
        "cache_control": {"type": "ephemeral"},
    }
    params.update(kwargs)
    return get_client().beta.messages.tool_runner(**params)


def parse(**kwargs):
    """Structured output: pass `output_format=SomePydanticModel` and read the
    validated object from `response.parsed_output`. (Lesson 4)"""
    params = {"model": MODEL, "max_tokens": 16000, "betas": BETAS, "fallbacks": "default"}
    params.update(kwargs)
    return get_client().beta.messages.parse(**params)


def text_of(message) -> str:
    """Join the text blocks of a response. (A response can also hold thinking
    and tool_use blocks, so never assume content[0] is the text.)"""
    return "".join(b.text for b in message.content if b.type == "text")


@dataclass
class Usage:
    """Running token count across one or many API calls, with a cost estimate."""

    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    models: set[str] = field(default_factory=set)

    def add(self, message) -> None:
        u = message.usage
        self.calls += 1
        self.input_tokens += u.input_tokens
        self.output_tokens += u.output_tokens
        self.cache_write_tokens += u.cache_creation_input_tokens or 0
        self.cache_read_tokens += u.cache_read_input_tokens or 0
        self.models.add(message.model)

    @property
    def cost_usd(self) -> float:
        # An estimate at MODEL's prices. If a fallback model answered, its
        # real price may differ slightly; the Console shows exact billing.
        return (
            self.input_tokens * PRICE_INPUT
            + self.output_tokens * PRICE_OUTPUT
            + self.cache_write_tokens * PRICE_CACHE_WRITE
            + self.cache_read_tokens * PRICE_CACHE_READ
        ) / 1_000_000

    def summary(self) -> str:
        s = (
            f"{self.calls} call(s) · {self.input_tokens:,} in / {self.output_tokens:,} out tokens"
            f" · ≈ ${self.cost_usd:.4f}"
        )
        if self.models - {MODEL}:
            s += f" · answered by {', '.join(sorted(self.models))}"
        return s
