"""The weekly research digest: a workflow, not an agent.  (Lesson 6)

An agent decides its own steps. That's powerful, but it's slower, costs more,
and does something slightly different every run. When you already know the
steps, write them in code and use the model only where judgement is
needed. That's a workflow:

    collect (code) → drop already-seen (code) → read & rank (model) → write (code)

It runs unattended once a week (see `pd schedule`), so predictability matters
more than flexibility.
"""

from __future__ import annotations

import json
import time
from datetime import date, timedelta
from typing import Callable

from pydantic import BaseModel, Field

from pd_agent import llm, profile
from pd_agent.memory import Memory
from pd_agent.tools import pubmed, trials

DIGEST_DIR = llm.PROJECT_ROOT / "data" / "digests"

DEFAULT_TOPICS = [
    '"young onset" OR "early onset" parkinson*',
    "parkinson* AND (exercise OR physical activity)",
    "parkinson* AND (sleep OR REM sleep behavior disorder)",
    "parkinson* AND (cognition OR memory OR cognitive training)",
    "parkinson* AND (LRRK2 OR GBA1 OR GBA OR PRKN OR parkin)",
    "parkinson* AND (disease-modifying OR neuroprotect* OR alpha-synuclein) AND clinical trial[pt]",
]


class ItemScore(BaseModel):
    id: str = Field(description="The item's id exactly as given, e.g. 'PMID:123' or 'NCT01234567'.")
    relevance: int = Field(description="0 = not relevant, 1 = minor, 2 = worth knowing, 3 = important for this person.")
    plain_summary: str = Field(description="One or two plain-language sentences: what was found or what is being tested.")
    why_it_matters: str = Field(description="Why this might matter to this person, or why not.")
    evidence_level: str = Field(description="e.g. 'RCT, 120 people', 'mouse study', 'phase 2 trial, recruiting'.")


class DigestScores(BaseModel):
    headline: str = Field(description="One sentence: the most interesting development this week, or 'a quiet week'.")
    items: list[ItemScore]


RANK_SYSTEM = (
    "You review this week's new Parkinson's research for one person (profile below) and rate how relevant each item "
    "is to them. Be honest about weak evidence: mouse studies and tiny pilots are 'worth knowing' at most. Use only "
    "the information given."
)


def collect(days: int = 7, topics: list[str] | None = None, per_topic: int = 15) -> tuple[list[dict], list[dict]]:
    """Step 1, code only: new PubMed records and recently updated trials."""
    pmids: list[str] = []
    for topic in topics or DEFAULT_TOPICS:
        pmids += [h["pmid"] for h in pubmed.search_pubmed(topic, max_results=per_topic, sort="date", days=days)]
    pmids = list(dict.fromkeys(pmids))
    papers = []
    for i in range(0, len(pmids), 20):  # efetch takes up to 20 at a time here
        papers += pubmed.fetch_abstracts(pmids[i : i + 20])
    since = (date.today() - timedelta(days=days)).isoformat()
    new_trials = trials.search_trials(status="recruiting", updated_since=since, max_results=25)
    new_trials += trials.search_trials(status="not_yet_recruiting", updated_since=since, max_results=10)
    return papers, new_trials


def to_items(papers: list[dict], new_trials: list[dict]) -> list[dict]:
    items = [
        {"id": f"PMID:{p['pmid']}", "kind": "paper", "title": p["title"], "year": p["year"],
         "types": p["publication_types"], "abstract": p["abstract"][:3000]}
        for p in papers
    ]
    items += [
        {"id": t["nct_id"], "kind": "trial", "title": t["title"], "status": t["status"], "phases": t["phases"],
         "interventions": t["interventions"], "ages": t["age_range"], "sites": t["sites"][:3]}
        for t in new_trials
    ]
    return items


def rank(items: list[dict], *, effort: str = "medium", parse: Callable = llm.parse) -> tuple[DigestScores, llm.Usage]:
    """Step 3, the model: one call that reads every item and scores it."""
    response = parse(
        system=[{"type": "text", "text": RANK_SYSTEM}, *profile.system_blocks()[1:]],
        output_format=DigestScores,
        output_config={"effort": effort},
        max_tokens=32000,
        messages=[{"role": "user", "content": json.dumps(items, ensure_ascii=False)}],
    )
    usage = llm.Usage()
    usage.add(response)
    if response.parsed_output is None:
        raise RuntimeError(f"No structured output (stop_reason={response.stop_reason}).")
    return response.parsed_output, usage


# --- Batch API version of step 3 ------------------------------------------------
# One request per item, sent as a batch: 50% cheaper, but asynchronous (minutes
# up to 24h). Fine for a weekly job nobody is waiting on.
ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "relevance": {"type": "integer"},
        "plain_summary": {"type": "string"},
        "why_it_matters": {"type": "string"},
        "evidence_level": {"type": "string"},
    },
    "required": ["id", "relevance", "plain_summary", "why_it_matters", "evidence_level"],
    "additionalProperties": False,
}


def rank_with_batch(items: list[dict], *, poll_seconds: int = 30, log: Callable[[str], None] = print) -> DigestScores:
    client = llm.get_client()
    system = [{"type": "text", "text": RANK_SYSTEM}, *profile.system_blocks()[1:]]
    batch = client.messages.batches.create(
        requests=[
            {
                "custom_id": f"item-{i}",  # custom_id allows only letters, digits, - and _
                "params": {
                    "model": llm.MODEL,
                    "max_tokens": 4000,
                    "system": system,
                    "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": ITEM_SCHEMA}},
                    "messages": [{"role": "user", "content": json.dumps(item, ensure_ascii=False)}],
                },
            }
            for i, item in enumerate(items)
        ]
    )
    log(f"Submitted batch {batch.id} with {len(items)} requests.")
    while (batch := client.messages.batches.retrieve(batch.id)).processing_status != "ended":
        log(f"  {batch.processing_status}: {batch.request_counts.processing} still processing…")
        time.sleep(poll_seconds)

    scores = []
    for entry in client.messages.batches.results(batch.id):  # results arrive in any order
        if entry.result.type == "succeeded":
            text = next(b.text for b in entry.result.message.content if b.type == "text")
            scores.append(ItemScore.model_validate_json(text))
        else:
            log(f"  {entry.custom_id}: {entry.result.type}")
    return DigestScores(headline="(batch mode: see the top items below)", items=scores)


# --- Step 4, code: write it up ---------------------------------------------------
def render(scores: DigestScores, items: list[dict], days: int, min_relevance: int = 2) -> str:
    by_id = {i["id"]: i for i in items}
    keep = sorted((s for s in scores.items if s.relevance >= min_relevance and s.id in by_id), key=lambda s: -s.relevance)
    lines = [
        f"# Parkinson's research digest: {date.today():%d %B %Y}",
        "",
        f"*{len(items)} new items from the last {days} days; {len(keep)} look relevant to you.*",
        "",
        f"**{scores.headline}**",
        "",
    ]
    for kind, heading in (("paper", "New papers"), ("trial", "Trials (new or updated)")):
        chosen = [s for s in keep if by_id[s.id]["kind"] == kind]
        if not chosen:
            continue
        lines += [f"## {heading}", ""]
        for s in chosen:
            item = by_id[s.id]
            stars = "★" * s.relevance
            lines += [
                f"### {stars} {item['title']} [{s.id}]",
                f"*{s.evidence_level}*",
                "",
                s.plain_summary,
                "",
                f"**Why it might matter:** {s.why_it_matters}",
                "",
            ]
    lines += ["---", "*Education, not medical advice. Bring anything that looks relevant to your neurologist.*"]
    return "\n".join(lines)


def run(
    days: int = 7, *, batch: bool = False, effort: str = "medium", memory: Memory | None = None,
    log: Callable[[str], None] = print,
) -> tuple[str, llm.Usage | None]:
    memory = memory or Memory()
    log("Collecting new papers and trials…")
    papers, new_trials = collect(days)
    items = to_items(papers, new_trials)
    fresh = set(memory.filter_unseen([i["id"] for i in items]))
    items = [i for i in items if i["id"] in fresh]
    log(f"{len(items)} items not seen before.")
    if not items:
        return "Nothing new since the last digest.", None

    usage = None
    if batch:
        scores = rank_with_batch(items, log=log)
    else:
        log("Ranking with the model…")
        scores, usage = rank(items, effort=effort)

    markdown = render(scores, items, days)
    DIGEST_DIR.mkdir(parents=True, exist_ok=True)
    (DIGEST_DIR / f"{date.today():%Y-%m-%d}.md").write_text(markdown)
    memory.mark_seen([i["id"] for i in items])
    memory.add_note(f"Research digest {date.today():%Y-%m-%d}", markdown, tags=["digest"])
    return markdown, usage
