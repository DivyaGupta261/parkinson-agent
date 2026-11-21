"""Lesson 3 tools, tested against real responses saved in tests/fixtures/."""

import json
from pathlib import Path

import httpx
import respx

from pd_agent.tools import europepmc, http, pubmed, trials, verify

FIX = Path(__file__).parent / "fixtures"


def test_summarize_study_from_real_record():
    study = json.loads((FIX / "ctgov_search.json").read_text())["studies"][0]
    t = trials.summarize_study(study)
    assert t["nct_id"].startswith("NCT")
    assert t["status"] == "RECRUITING"
    assert t["url"] == f"https://clinicaltrials.gov/study/{t['nct_id']}"
    assert "–" in t["age_range"]


def test_location_sites_are_listed_first():
    study = {"protocolSection": {"identificationModule": {"nctId": "NCT00000001"}, "contactsLocationsModule": {
        "locations": [{"city": "Boston", "country": "United States"}, {"city": "Chennai", "country": "India"}]}}}
    assert trials.summarize_study(study, location="india")["sites"][0] == "Chennai, India"


@respx.mock
def test_search_trials_builds_filters():
    route = respx.get(trials.BASE).mock(return_value=httpx.Response(200, json={"studies": []}))
    trials.search_trials("exercise", age=42, location="India", updated_since="2026-11-01")
    params = route.calls[0].request.url.params
    # Regression: condition is matched exactly, not via synonyms ("PD" matched PD-1 cancer trials).
    assert params["filter.advanced"].startswith("AREA[Condition]Parkinson*")
    assert "query.cond" not in params
    assert params["query.term"] == "exercise"
    assert params["filter.overallStatus"] == "RECRUITING"
    assert params["query.locn"] == "India"
    assert "RANGE[MIN, 42 years]" in params["filter.advanced"]
    # Regression: trials with no age limit must not be filtered out.
    assert "AREA[MaximumAge]MISSING" in params["filter.advanced"]
    assert "LastUpdatePostDate" in params["filter.advanced"]


def test_parse_full_text_filters_sections():
    xml = (FIX / "europepmc_fulltext.xml").read_text()
    everything = europepmc.parse_full_text(xml, "PMC13538935")
    assert everything["title"].startswith("Bibliometric Analysis")
    assert everything["pmid"]
    only_intro = europepmc.parse_full_text(xml, "PMC13538935", section="introduction")
    assert only_intro["text"].startswith("## 1. Introduction")
    assert len(only_intro["text"]) < len(everything["text"])


@respx.mock
def test_search_europepmc_from_real_response():
    respx.get(f"{europepmc.BASE}/search").mock(
        return_value=httpx.Response(200, json=json.loads((FIX / "europepmc_search.json").read_text())))
    [first, *_] = europepmc.search_europepmc("parkinson exercise")
    assert first["pmcid"].startswith("PMC") and first["open_access"] is True


def test_find_citations_dedupes_in_order():
    found = verify.find_citations("A [PMID:2] B [PMID: 1] C [PMID:2] see NCT01506479 and NCT01506479.")
    assert found == {"pmids": ["2", "1"], "ncts": ["NCT01506479"]}


@respx.mock
def test_verify_citations_flags_missing_ids():
    respx.get(f"{pubmed.BASE}/esummary.fcgi").mock(return_value=httpx.Response(200, json={"result": {
        "uids": ["111", "999"],
        "111": {"title": "Real paper", "pubdate": "2020 Jan", "fulljournalname": "J"},
        "999": {"error": "cannot get document summary"}}}))
    respx.get("https://clinicaltrials.gov/api/v2/studies/NCT99999999").mock(return_value=httpx.Response(404))
    items = verify.verify_citations("[PMID:111] [PMID:999] [NCT99999999]")
    assert [(i["id"], i["exists"]) for i in items] == [("PMID:111", True), ("PMID:999", False), ("NCT99999999", False)]
    assert items[0]["title"] == "Real paper"


@respx.mock
def test_http_retries_temporary_errors(monkeypatch):
    monkeypatch.setattr(http.time, "sleep", lambda s: None)
    route = respx.get("https://example.org/x").mock(side_effect=[httpx.Response(503), httpx.Response(200, text="ok")])
    assert http.get("https://example.org/x").text == "ok"
    assert route.call_count == 2
