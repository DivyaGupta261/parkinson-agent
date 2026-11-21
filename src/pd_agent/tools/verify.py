"""Check that every citation in an answer points at a real record.  (Lesson 3)

The model is told to cite only what it retrieved, and Lesson 2 checked that
against tool results. This goes further: look each ID up at the source, so a
citation counts as verified only if PubMed or ClinicalTrials.gov confirms it.
That check runs in code, not in the model, and the model cannot talk its way
past it.
"""

from __future__ import annotations

import re

from pd_agent.tools import http, pubmed

PMID_RE = re.compile(r"PMID:\s*(\d+)")
NCT_RE = re.compile(r"\b(NCT\d{8})\b")


def find_citations(text: str) -> dict[str, list[str]]:
    return {
        "pmids": list(dict.fromkeys(PMID_RE.findall(text))),
        "ncts": list(dict.fromkeys(NCT_RE.findall(text))),
    }


def verify_pmids(pmids: list[str]) -> dict[str, dict]:
    if not pmids:
        return {}
    result = pubmed._get("esummary.fcgi", db="pubmed", id=",".join(pmids), retmode="json").json()["result"]
    out = {}
    for pmid in pmids:
        rec = result.get(pmid, {})
        ok = bool(rec) and "error" not in rec
        out[pmid] = {
            "exists": ok,
            "title": rec.get("title") if ok else None,
            "year": rec.get("pubdate", "")[:4] if ok else None,
            "source": rec.get("fulljournalname") if ok else None,
        }
    return out


def verify_nct(nct: str) -> dict:
    resp = http.get(f"https://clinicaltrials.gov/api/v2/studies/{nct}", params={"fields": "BriefTitle,StartDate"})
    if resp.status_code == 404:
        return {"exists": False, "title": None, "year": None, "source": None}
    resp.raise_for_status()
    p = resp.json().get("protocolSection", {})
    return {
        "exists": True,
        "title": p.get("identificationModule", {}).get("briefTitle"),
        "year": p.get("statusModule", {}).get("startDateStruct", {}).get("date", "")[:4] or None,
        "source": "ClinicalTrials.gov",
    }


def verify_citations(text: str) -> list[dict]:
    """Return one record per cited ID, in order of appearance."""
    found = find_citations(text)
    items = []
    for pmid, info in verify_pmids(found["pmids"]).items():
        items.append({"id": f"PMID:{pmid}", "kind": "pubmed", "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", **info})
    for nct in found["ncts"]:
        items.append({"id": nct, "kind": "trial", "url": f"https://clinicaltrials.gov/study/{nct}", **verify_nct(nct)})
    return items
