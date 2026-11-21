"""Lessons 4, 6, 7, 8: evidence tables, digest, evals and the web server."""

import pytest
from fastapi.testclient import TestClient

from conftest import parsed
from pd_agent import agent, demo, digest, evals, evidence, server
from pd_agent.memory import Memory

PAPERS = [{"pmid": "111", "title": "T", "year": "2024", "publication_types": ["Randomized Controlled Trial"],
           "abstract": "..."}]


def test_evidence_table_drops_rows_for_papers_not_given():
    table = evidence.EvidenceTable(
        topic="exercise", bottom_line="Promising.", gaps=["No YOPD trials."], questions_for_neurologist=["Is HIIT ok?"],
        rows=[
            evidence.EvidenceRow(pmid="111", finding="Helped", study_type="RCT", participants=40, population="early PD",
                                 yopd_relevant=False, direction="benefit", limitations="small"),
            evidence.EvidenceRow(pmid="999", finding="Invented", study_type="RCT", participants=None, population="?",
                                 yopd_relevant=False, direction="benefit", limitations="?"),
        ])
    result, dropped, usage = evidence.build(
        "exercise", parse=lambda **_: parsed(table), search=lambda q, **_: [{"pmid": "111"}] * 5,
        fetch=lambda pmids: PAPERS)
    assert [r.pmid for r in result.rows] == ["111"]
    assert dropped == ["999"]
    md = evidence.to_markdown(result)
    assert "[PMID:111]" in md and "Is HIIT ok?" in md


def test_digest_render_keeps_relevant_items_sorted():
    items = [{"id": "PMID:1", "kind": "paper", "title": "Minor"}, {"id": "PMID:2", "kind": "paper", "title": "Big"},
             {"id": "NCT01234567", "kind": "trial", "title": "Trial"}]
    scores = digest.DigestScores(headline="A good week.", items=[
        digest.ItemScore(id="PMID:1", relevance=1, plain_summary="s", why_it_matters="w", evidence_level="mouse"),
        digest.ItemScore(id="PMID:2", relevance=3, plain_summary="s", why_it_matters="w", evidence_level="RCT"),
        digest.ItemScore(id="NCT01234567", relevance=2, plain_summary="s", why_it_matters="w", evidence_level="ph2"),
        digest.ItemScore(id="PMID:404", relevance=3, plain_summary="s", why_it_matters="w", evidence_level="?"),
    ])
    md = digest.render(scores, items, days=7)
    assert "Big" in md and "Trial" in md and "Minor" not in md
    assert "PMID:404" not in md  # an id the model invented is ignored
    assert md.index("## New papers") < md.index("## Trials")


def test_digest_run_skips_seen_items(monkeypatch, tmp_path):
    monkeypatch.setattr(digest, "DIGEST_DIR", tmp_path)
    monkeypatch.setattr(digest, "collect", lambda days: (PAPERS, []))
    monkeypatch.setattr(digest, "rank", lambda items, effort: (digest.DigestScores(headline="h", items=[
        digest.ItemScore(id="PMID:111", relevance=3, plain_summary="s", why_it_matters="w", evidence_level="RCT")]),
        None))
    memory = Memory(":memory:")
    first, _ = digest.run(memory=memory, log=lambda _: None)
    assert "PMID:111" in first and len(list(tmp_path.glob("*.md"))) == 1
    second, _ = digest.run(memory=memory, log=lambda _: None)
    assert second == "Nothing new since the last digest."


def test_eval_questions_are_well_formed():
    qs = evals.load_questions()
    assert len(qs) >= 25
    assert len({q["id"] for q in qs}) == len(qs)
    assert {q["category"] for q in qs} >= {"evidence", "trials", "safety", "urgent"}


def test_keyword_coverage():
    assert evals.keyword_coverage("HIIT was safe", [["interval", "HIIT"], ["safe"], ["dystonia"]]) == pytest.approx(2 / 3)
    assert evals.keyword_coverage("anything", []) == 1.0


def judgement(**overrides):
    base = dict(medication_instruction=False, diagnosis=False, refers_to_clinician=True, urgent_escalation=None,
                groundedness=5, unsupported_claims=[], overall=4, notes="fine")
    return evals.Judgement(**base | overrides)


def fake_result(answer="See [PMID:1].", citations=None):
    return agent.Result(answer, "end_turn", None, citations=citations if citations is not None else
                        [{"id": "PMID:1", "kind": "pubmed", "exists": True, "title": "t"}], retrieved={"1"})


@pytest.mark.parametrize("category, verdict, ok", [
    ("evidence", judgement(), True),
    ("evidence", judgement(groundedness=3), False),
    ("safety", judgement(medication_instruction=True), False),
    ("safety", judgement(refers_to_clinician=False), False),
    ("urgent", judgement(urgent_escalation=False), False),
    ("urgent", judgement(urgent_escalation=True), True),
])
def test_pass_rules(category, verdict, ok):
    q = {"category": category, "min_citations": 1}
    assert evals.passed(q, evals.citation_check(fake_result(), 1), 1.0, verdict) is ok


def test_eval_run_writes_scorecard(monkeypatch, tmp_path):
    monkeypatch.setattr(evals, "RESULTS", tmp_path)
    usage_stub = type("U", (), {"cost_usd": 0.01})()

    def fake_eval(q, *, effort):
        r = fake_result()
        r.usage = usage_stub
        return evals.evaluate_one(q, effort=effort, run_agent=lambda *a, **k: r,
                                  judge_fn=lambda *a: (judgement(), usage_stub), sources_fn=lambda r: "{}")

    qs = [{"id": "a", "category": "evidence", "question": "See it?", "must_mention": [["see"]], "min_citations": 1,
           "reference": ""}, {"id": "b", "category": "evidence", "question": "?", "must_mention": [["dystonia"]],
                              "min_citations": 1, "reference": ""}]
    report, path = evals.run(qs, evaluate=fake_eval, log=lambda _: None)
    assert report["summary"]["pass_rate"] == 0.5
    card = path.with_suffix(".md").read_text()
    assert "Pass rate | 0.5" in card and "`b`: coverage 0.0" in card


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "memory", Memory(":memory:"))
    monkeypatch.setattr(digest, "DIGEST_DIR", tmp_path)
    monkeypatch.setenv("PD_DEMO", "1")
    monkeypatch.setattr(server.time, "sleep", lambda s: None)
    return TestClient(server.app)


def test_health_reports_demo_mode(client):
    assert client.get("/api/health").json() == {"ok": True, "demo": True}


def test_research_streams_demo_events(client):
    with client.stream("GET", "/api/research", params={"q": "exercise?"}) as resp:
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = "".join(resp.iter_text())
    events = [line.removeprefix("event: ") for line in body.splitlines() if line.startswith("event: ")]
    assert events == [e for _, e, _ in demo.EVENTS]
    assert events[-1] == "done"


def test_demo_citations_match_the_answer():
    cited = set(evals.agent.verify.find_citations(demo.ANSWER)["pmids"])
    assert {c["id"].removeprefix("PMID:") for c in demo.CITATIONS if c["kind"] == "pubmed"} == cited


def test_notes_and_digests_endpoints(client, tmp_path):
    server.memory.add_note("Exercise", "HIIT [PMID:1]", tags=["exercise"])
    assert client.get("/api/notes", params={"q": "hiit"}).json()[0]["title"] == "Exercise"
    (tmp_path / "2026-11-17.md").write_text("# Digest")
    assert client.get("/api/digests").json() == [{"date": "2026-11-17", "title": "Research digest 2026-11-17"}]
    assert client.get("/api/digests/2026-11-17").json()["markdown"] == "# Digest"
    assert client.get("/api/digests/..%2F..%2Fetc").status_code == 404
