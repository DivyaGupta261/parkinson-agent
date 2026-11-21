"""Europe PMC: search plus open-access full text.  (Lesson 3)

PubMed gives abstracts. Europe PMC also serves the full text of open-access
papers, which matters when the abstract leaves out the detail you need
(e.g. how much exercise, at what intensity, for how long).

API docs: https://europepmc.org/RestfulWebService
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

from pd_agent.tools import http

BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest"

# A full paper can be 20k+ tokens. Cap what we hand the model.
MAX_FULLTEXT_CHARS = 30_000


def search_europepmc(query: str, open_access_only: bool = True, max_results: int = 10) -> list[dict]:
    """Search Europe PMC. Results include a PMCID when full text is available."""
    q = f"({query}) AND OPEN_ACCESS:y" if open_access_only else query
    resp = http.get(
        f"{BASE}/search",
        params={"query": q, "format": "json", "resultType": "lite", "pageSize": min(max_results, 50)},
        timeout=30,
    )
    resp.raise_for_status()
    return [
        {
            "pmid": r.get("pmid"),
            "pmcid": r.get("pmcid"),
            "title": r.get("title", ""),
            "journal": r.get("journalTitle", ""),
            "year": r.get("pubYear", ""),
            "publication_types": r.get("pubType", ""),
            "open_access": r.get("isOpenAccess") == "Y",
        }
        for r in resp.json().get("resultList", {}).get("result", [])
    ]


def read_full_text(pmcid: str, section: str | None = None) -> dict:
    """Fetch an open-access paper's full text, optionally only the sections
    whose heading contains `section` (e.g. "methods", "results")."""
    pmcid = pmcid.strip().upper()
    if not pmcid.startswith("PMC"):
        pmcid = f"PMC{pmcid}"
    resp = http.get(f"{BASE}/{pmcid}/fullTextXML")
    if resp.status_code == 404:
        raise ValueError(f"No open-access full text for {pmcid}. Use fetch_abstracts instead.")
    resp.raise_for_status()
    return parse_full_text(resp.text, pmcid, section)


def parse_full_text(xml: str, pmcid: str, section: str | None = None) -> dict:
    root = ET.fromstring(xml)
    meta = root.find("front/article-meta")
    title = "".join(meta.find("title-group/article-title").itertext()).strip() if meta is not None else ""
    pmid = None
    if meta is not None:
        for node in meta.findall("article-id"):
            if node.get("pub-id-type") == "pmid":
                pmid = node.text

    parts = []
    body = root.find("body")
    for sec in body.findall("sec") if body is not None else []:
        heading = (sec.findtext("title") or "").strip()
        if section and section.lower() not in heading.lower():
            continue
        text = " ".join(" ".join(sec.itertext()).split())
        parts.append(f"## {heading}\n{text}" if heading else text)

    text = "\n\n".join(parts)
    truncated = len(text) > MAX_FULLTEXT_CHARS
    return {
        "pmcid": pmcid,
        "pmid": pmid,
        "title": title,
        "text": text[:MAX_FULLTEXT_CHARS] or "(no matching sections)",
        "truncated": truncated,
    }
