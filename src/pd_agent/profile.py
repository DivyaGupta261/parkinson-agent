"""The person the agent is helping.  (Lesson 4)

Your real profile lives in data/profile.md (git-ignored). Without one, the
fictional demo profile in examples/ is used, so the public repo works for
anyone and contains no real health data.
"""

from __future__ import annotations

from importlib import resources

from pd_agent.llm import PROJECT_ROOT

PERSONAL = PROJECT_ROOT / "data" / "profile.md"
DEMO = PROJECT_ROOT / "examples" / "demo_profile.md"


def load_profile(demo: bool = False) -> str:
    path = PERSONAL if PERSONAL.exists() and not demo else DEMO
    return path.read_text() if path.exists() else "(no profile provided)"


def system_blocks(prompt_file: str = "research_agent.md", demo: bool = False) -> list[dict]:
    """The system prompt as content blocks: fixed rules first, profile second.

    Order matters for prompt caching. The cache matches from the start of
    the request, so the most stable text goes first. Nothing here changes
    between requests. (Today's date changes, so it goes in the user
    message instead; see agent.py.)
    """
    rules = resources.files("pd_agent").joinpath(f"prompts/{prompt_file}").read_text()
    return [
        {"type": "text", "text": rules},
        {"type": "text", "text": f"# Profile of the person you are helping\n\n{load_profile(demo)}"},
    ]
