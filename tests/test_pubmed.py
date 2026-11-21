"""PubMed tool tests. `respx` intercepts HTTP calls, so nothing touches the
network and the tests run the same every time."""

from pathlib import Path

import httpx
import respx

from pd_agent.tools import pubmed

FIXTURE = (Path(__file__).parent / "fixtures" / "efetch_32353174.xml").read_text()


def test_parse_efetch_real_record():
    [rec] = pubmed.parse_efetch_xml(FIXTURE)
    assert rec["pmid"] == "32353174"
    assert rec["title"] == "Physical activity and cognition in young-onset Parkinson's disease."
    assert rec["year"] == "2020"
    assert rec["doi"] == "10.1111/ane.13256"
    assert "Randomized Controlled Trial" in rec["publication_types"]
    # Structured abstract sections keep their labels.
    assert rec["abstract"].startswith("BACKGROUND:")
    assert "CONCLUSIONS:" in rec["abstract"]


@respx.mock
def test_search_pubmed_combines_esearch_and_esummary():
    respx.get(f"{pubmed.BASE}/esearch.fcgi").mock(
        return_value=httpx.Response(200, json={"esearchresult": {"idlist": ["32353174"]}})
    )
    respx.get(f"{pubmed.BASE}/esummary.fcgi").mock(
        return_value=httpx.Response(
            200,
            json={
                "result": {
                    "uids": ["32353174"],
                    "32353174": {
                        "title": "Physical activity and cognition in young-onset Parkinson's disease.",
                        "fulljournalname": "Acta neurologica Scandinavica",
                        "pubdate": "2020 Aug",
                        "pubtype": ["Journal Article", "Randomized Controlled Trial"],
                        "authors": [{"name": "Biddiscombe KJ"}],
                    },
                }
            },
        )
    )
    [hit] = pubmed.search_pubmed("young-onset parkinson exercise", min_year=2015)
    assert hit == {
        "pmid": "32353174",
        "title": "Physical activity and cognition in young-onset Parkinson's disease.",
        "journal": "Acta neurologica Scandinavica",
        "year": "2020",
        "publication_types": ["Journal Article", "Randomized Controlled Trial"],
        "first_author": "Biddiscombe KJ",
    }
    term = respx.calls[0].request.url.params["term"]
    assert term == "(young-onset parkinson exercise) AND 2015:3000[dp]"


@respx.mock
def test_search_pubmed_no_hits_skips_summary_call():
    respx.get(f"{pubmed.BASE}/esearch.fcgi").mock(
        return_value=httpx.Response(200, json={"esearchresult": {"idlist": []}})
    )
    assert pubmed.search_pubmed("nonsense query xyzzy") == []
    assert len(respx.calls) == 1
