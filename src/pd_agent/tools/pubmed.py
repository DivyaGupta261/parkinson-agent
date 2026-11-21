"""PubMed search through NCBI's free E-utilities API.  (Lesson 2)

These are ordinary Python functions with no AI involved. The agent calls them
as tools, and you can call them yourself (`uv run pd pubmed "..."`) to see
exactly what the model sees.

API docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
"""

from __future__ import annotations

import os
import threading
import time
import xml.etree.ElementTree as ET

from pd_agent.tools import http

BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

# NCBI allows 3 requests/second without an API key (10 with one).
_MIN_INTERVAL = 0.34
_last_call = 0.0
_lock = threading.Lock()


def _get(endpoint: str, **params) -> httpx.Response:
    global _last_call
    params |= {"tool": "pd-agent"}
    if email := os.environ.get("NCBI_EMAIL"):
        params["email"] = email
    if key := os.environ.get("NCBI_API_KEY"):
        params["api_key"] = key
    with _lock:
        wait = _MIN_INTERVAL - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
    resp = http.get(f"{BASE}/{endpoint}", params=params)
    resp.raise_for_status()
    return resp


def search_pubmed(
    query: str,
    max_results: int = 10,
    min_year: int | None = None,
    sort: str = "relevance",
    days: int | None = None,
) -> list[dict]:
    """Search PubMed and return one short record per paper (no abstracts).

    `query` accepts PubMed syntax, e.g. `parkinson AND exercise AND
    randomized controlled trial[pt]`. `sort` is "relevance" or "date".
    `days` keeps only records added to PubMed in the last N days (Lesson 6).
    """
    term = query
    if min_year:
        term = f"({query}) AND {min_year}:3000[dp]"
    params = {}
    if days:
        params = {"reldate": days, "datetype": "edat"}
    ids = _get(
        "esearch.fcgi",
        db="pubmed",
        term=term,
        retmode="json",
        retmax=min(max_results, 50),
        sort="pub_date" if sort == "date" else "relevance",
        **params,
    ).json()["esearchresult"]["idlist"]
    if not ids:
        return []

    summary = _get("esummary.fcgi", db="pubmed", id=",".join(ids), retmode="json").json()["result"]
    results = []
    for uid in summary["uids"]:
        r = summary[uid]
        authors = [a["name"] for a in r.get("authors", [])]
        results.append(
            {
                "pmid": uid,
                "title": r.get("title", ""),
                "journal": r.get("fulljournalname", ""),
                "year": r.get("pubdate", "")[:4],
                "publication_types": r.get("pubtype", []),
                "first_author": authors[0] if authors else "",
            }
        )
    return results


def fetch_abstracts(pmids: list[str]) -> list[dict]:
    """Fetch full records (title, abstract, publication types, DOI) for PMIDs."""
    if not pmids:
        return []
    xml = _get("efetch.fcgi", db="pubmed", id=",".join(pmids[:20]), retmode="xml").text
    return parse_efetch_xml(xml)


def parse_efetch_xml(xml: str) -> list[dict]:
    """Turn PubMed's efetch XML into simple dicts. Kept separate so tests can
    feed it a saved response instead of calling the network."""
    records = []
    for art in ET.fromstring(xml).iter("PubmedArticle"):
        citation = art.find("MedlineCitation")
        article = citation.find("Article")

        # Structured abstracts come in labelled parts (BACKGROUND, METHODS, ...).
        parts = []
        for node in article.findall("Abstract/AbstractText"):
            text = "".join(node.itertext()).strip()
            label = node.get("Label")
            parts.append(f"{label}: {text}" if label else text)

        pub_date = article.find("Journal/JournalIssue/PubDate")
        year = ""
        if pub_date is not None:
            year = pub_date.findtext("Year") or (pub_date.findtext("MedlineDate") or "")[:4]

        # Only the paper's own IDs (the reference list has ArticleIds too).
        ids = {
            node.get("IdType"): node.text
            for node in art.findall("PubmedData/ArticleIdList/ArticleId")
        }

        records.append(
            {
                "pmid": citation.findtext("PMID"),
                "title": "".join(article.find("ArticleTitle").itertext()).strip(),
                "journal": article.findtext("Journal/Title", ""),
                "year": year,
                "publication_types": [n.text for n in article.findall("PublicationTypeList/PublicationType")],
                "doi": ids.get("doi"),
                "abstract": "\n".join(parts) or "(no abstract available)",
            }
        )
    return records
