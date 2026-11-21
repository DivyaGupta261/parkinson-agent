"""A recorded example run, replayed by the web server when no API key is set.  (Lesson 8)

Demo mode lets people try the UI from your portfolio without you paying for
their questions. The answer below was written only from the abstracts of the
three cited papers and the cited trial record, so the citations are real and
the claims match them. The UI labels it as a recorded example.
"""

QUESTION = "What is the evidence that aerobic exercise slows Parkinson's progression?"

ANSWER = """**Short answer:** Exercise clearly helps people with Parkinson's feel and move better, and one trial suggests high-intensity aerobic exercise may keep motor symptoms from worsening over six months. Whether it truly *slows the disease itself* hasn't been proven yet; a larger trial is testing exactly that.

### What the evidence says
- **High-intensity treadmill exercise held motor scores steady.** In the SPARX phase 2 randomised trial, 128 people within 5 years of diagnosis and not yet on medication exercised 4 days a week for 6 months. Motor scores barely changed in the high-intensity group (80–85% of max heart rate) but worsened in the control group; moderate intensity didn't reach the same threshold [PMID:29228079]. *RCT, but phase 2: designed to decide whether a bigger trial is worthwhile, and ages 40–80, so no one under 40.*
- **The definitive test is underway.** The follow-up phase 3 trial (SPARX3, 370 participants, ages 40–80) is comparing high- and moderate-intensity treadmill exercise, with its main result measured at 12 months [NCT04284436]. *Trial, results not yet available.*
- **Interval training vs steady training.** In a 10-week randomised trial with 29 people, both high-intensity interval training and moderate continuous cycling improved fitness, motor scores and fatigue, with no clear difference between them for motor symptoms [PMID:39008618]. *Small RCT, short duration.*
- **Young-onset evidence is thin but encouraging.** The first study of physical activity and cognition in young-onset Parkinson's randomised 38 people to a 6-week activity programme. Participants reported better concentration, attention and processing speed, though objective improvements didn't reach statistical significance [PMID:32353174]. *Small RCT; the authors call for larger, longer studies.*

### What this could mean for you
Your walking and yoga are a good base. The strongest signal so far is for *sustained aerobic exercise at a fairly high heart rate*, several days a week. "Improves symptoms" is well supported; "slows progression" is a promising hypothesis being tested.

### Questions to bring to your neurologist
- Is high-intensity aerobic exercise safe for me, and what heart-rate range should I aim for?
- Could a physiotherapist experienced in Parkinson's help me build a programme?
- Am I eligible for any exercise trials for people my age?"""

CITATIONS = [
    {"id": "PMID:29228079", "kind": "pubmed", "exists": True, "year": "2018", "source": "JAMA neurology",
     "url": "https://pubmed.ncbi.nlm.nih.gov/29228079/",
     "title": "Effect of High-Intensity Treadmill Exercise on Motor Symptoms in Patients With De Novo Parkinson "
              "Disease: A Phase 2 Randomized Clinical Trial."},
    {"id": "NCT04284436", "kind": "trial", "exists": True, "year": "2021", "source": "ClinicalTrials.gov",
     "url": "https://clinicaltrials.gov/study/NCT04284436", "title": "Study in Parkinson Disease of Exercise"},
    {"id": "PMID:39008618", "kind": "pubmed", "exists": True, "year": "2024",
     "source": "Journal of applied physiology (Bethesda, Md. : 1985)", "url": "https://pubmed.ncbi.nlm.nih.gov/39008618/",
     "title": "High-intensity interval versus moderate-intensity continuous cycling training in Parkinson's disease: "
              "a randomized trial."},
    {"id": "PMID:32353174", "kind": "pubmed", "exists": True, "year": "2020", "source": "Acta neurologica Scandinavica",
     "url": "https://pubmed.ncbi.nlm.nih.gov/32353174/",
     "title": "Physical activity and cognition in young-onset Parkinson's disease."},
]

# (delay_seconds, event, data): replayed in order to imitate a live run.
EVENTS = [
    (0.3, "status", {"message": "Demo mode: replaying a recorded example (no API key on this server)."}),
    (0.6, "tool", {"name": "recall", "input": {"query": "aerobic exercise progression"}}),
    (0.8, "thinking", {"text": "Nothing saved yet on this. I'll look for RCTs of aerobic exercise, especially high-intensity work, and anything specific to young-onset PD."}),
    (0.8, "tool", {"name": "search_pubmed", "input": {"query": "parkinson disease AND aerobic exercise AND randomized controlled trial[pt]", "max_results": 10}}),
    (0.8, "tool", {"name": "search_pubmed", "input": {"query": "\"young onset\" parkinson AND physical activity", "max_results": 10}}),
    (1.0, "tool", {"name": "fetch_abstracts", "input": {"pmids": ["29228079", "39008618", "32353174"]}}),
    (0.8, "tool", {"name": "search_trials", "input": {"query": "high intensity exercise", "status": "active"}}),
    (0.8, "thinking", {"text": "SPARX phase 2 is the key result; SPARX3 is testing progression directly. The YOPD study is small. I'll keep 'improves symptoms' separate from 'slows progression'."}),
    (1.2, "answer", {"markdown": ANSWER}),
    (0.6, "status", {"message": "Checking citations against PubMed and ClinicalTrials.gov…"}),
    (0.6, "citations", {"items": CITATIONS}),
    (0.1, "usage", {"summary": "recorded example: no tokens used", "cost_usd": 0}),
    (0.0, "done", {}),
]
