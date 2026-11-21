"""Evidence tables with structured outputs.  (Lesson 4)

The research agent answers in prose. Sometimes you want data: rows you can
sort, filter, render as a table or feed into another program. Structured
outputs make the model's reply conform to a schema (here a Pydantic model),
so `response.parsed_output` is a validated Python object, not text you
have to parse and hope.

This is a *workflow*, not an agent: the steps are fixed in code (search →
fetch → extract), and the model does one job. Lesson 6 says more about when
to choose which.
"""

from __future__ import annotations

import json
from typing import Callable, Literal

from pydantic import BaseModel, Field

from pd_agent import llm
from pd_agent.tools import pubmed


class EvidenceRow(BaseModel):
    pmid: str = Field(description="PMID of the paper this row summarises. Must be one of the papers provided.")
    finding: str = Field(description="The main result, in one plain-language sentence.")
    study_type: Literal[
        "meta-analysis/systematic review", "RCT", "observational", "case report/series", "preclinical", "review/opinion"
    ]
    participants: int | None = Field(description="Number of people studied, or null if not stated / not applicable.")
    population: str = Field(description="Who was studied, e.g. 'early PD, age 40-80, unmedicated'.")
    yopd_relevant: bool = Field(description="True only if the study included or focused on people under ~50.")
    direction: Literal["benefit", "no clear effect", "harm", "mixed"]
    limitations: str = Field(description="The most important caveat, e.g. 'small sample', 'only 6 weeks'.")


class EvidenceTable(BaseModel):
    topic: str
    bottom_line: str = Field(description="2-3 plain-language sentences summarising the overall evidence and its strength.")
    rows: list[EvidenceRow]
    gaps: list[str] = Field(description="What the evidence doesn't tell us yet, especially for young-onset PD.")
    questions_for_neurologist: list[str]


SYSTEM = (
    "You extract evidence from research abstracts for a person living with Parkinson's disease. "
    "Use ONLY the abstracts provided; one row per relevant paper; skip papers that don't address the topic. "
    "Be precise about study type and sample size, and conservative about effects."
)


def build(
    topic: str,
    *,
    max_papers: int = 12,
    effort: str = "medium",
    parse: Callable = llm.parse,
    search: Callable = pubmed.search_pubmed,
    fetch: Callable = pubmed.fetch_abstracts,
) -> tuple[EvidenceTable, list[str], llm.Usage]:
    """Returns (table, dropped_pmids, usage). `dropped_pmids` lists rows the
    model produced for papers it wasn't given, which we remove in code."""
    strong = f"({topic}) AND parkinson* AND (meta-analysis[pt] OR systematic review[pt] OR randomized controlled trial[pt])"
    hits = search(strong, max_results=max_papers)
    if len(hits) < 4:  # not much high-level evidence: widen the net
        hits += search(f"({topic}) AND parkinson*", max_results=max_papers - len(hits))
    pmids = list(dict.fromkeys(h["pmid"] for h in hits))
    papers = fetch(pmids) if pmids else []

    response = parse(
        system=SYSTEM,
        output_format=EvidenceTable,
        output_config={"effort": effort},
        messages=[
            {
                "role": "user",
                "content": f"Topic: {topic}\n\nAbstracts (JSON):\n{json.dumps(papers, ensure_ascii=False)}",
            }
        ],
    )
    usage = llm.Usage()
    usage.add(response)
    table: EvidenceTable | None = response.parsed_output
    if table is None:
        raise RuntimeError(f"No structured output (stop_reason={response.stop_reason}).")

    # Schemas guarantee the *shape*, not the *truth*. Check facts in code.
    given = {p["pmid"] for p in papers}
    dropped = [r.pmid for r in table.rows if r.pmid not in given]
    table.rows = [r for r in table.rows if r.pmid in given]
    return table, dropped, usage


def to_markdown(table: EvidenceTable) -> str:
    lines = [f"# Evidence: {table.topic}", "", f"**Bottom line:** {table.bottom_line}", ""]
    lines += ["| Finding | Study | N | YOPD? | Effect | Caveat |", "|---|---|---|---|---|---|"]
    for r in table.rows:
        lines.append(
            f"| {r.finding} [PMID:{r.pmid}] | {r.study_type} | {r.participants or '–'} | "
            f"{'yes' if r.yopd_relevant else 'no'} | {r.direction} | {r.limitations} |"
        )
    if table.gaps:
        lines += ["", "**Gaps in the evidence**", *[f"- {g}" for g in table.gaps]]
    if table.questions_for_neurologist:
        lines += ["", "**Questions to bring to your neurologist**", *[f"- {q}" for q in table.questions_for_neurologist]]
    return "\n".join(lines)
