"""Clinical trial search through the ClinicalTrials.gov API v2.  (Lesson 3)

API docs: https://clinicaltrials.gov/data-api/api
"""

from __future__ import annotations

from pd_agent.tools import http

BASE = "https://clinicaltrials.gov/api/v2/studies"

STATUSES = {
    "recruiting": "RECRUITING",
    "not_yet_recruiting": "NOT_YET_RECRUITING",
    "active": "ACTIVE_NOT_RECRUITING",
    "completed": "COMPLETED",
}


def search_trials(
    query: str = "",
    status: str = "recruiting",
    age: int | None = None,
    location: str | None = None,
    max_results: int = 10,
    updated_since: str | None = None,
) -> list[dict]:
    """Search Parkinson's trials. `age` keeps only trials whose age range
    includes that age; `location` is free text such as "India" or "Boston";
    `updated_since` (YYYY-MM-DD) keeps trials posted or changed since then."""
    params = {"pageSize": min(max_results, 50), "countTotal": "true"}
    if query:
        params["query.term"] = query
    if status in STATUSES:
        params["filter.overallStatus"] = STATUSES[status]
    if location:
        params["query.locn"] = location
    # Match the trial's listed condition directly. The friendlier
    # `query.cond=Parkinson Disease` expands to synonyms including "PD",
    # which also matches cancer trials of PD-1 drugs.
    advanced = ["AREA[Condition]Parkinson*"]
    if age is not None:
        # Many trials set no upper (or lower) age limit. A plain RANGE filter
        # silently drops them, so a missing limit has to count as a match.
        advanced.append(
            f"(AREA[MinimumAge]RANGE[MIN, {age} years] OR AREA[MinimumAge]MISSING) AND "
            f"(AREA[MaximumAge]RANGE[{age} years, MAX] OR AREA[MaximumAge]MISSING)"
        )
    if updated_since:
        advanced.append(f"AREA[LastUpdatePostDate]RANGE[{updated_since}, MAX]")
    params["filter.advanced"] = " AND ".join(advanced)
    resp = http.get(BASE, params=params)
    resp.raise_for_status()
    return [summarize_study(s, location) for s in resp.json().get("studies", [])]


def get_trial(nct_id: str) -> dict:
    """Full details for one trial, including eligibility criteria."""
    resp = http.get(f"{BASE}/{nct_id.strip().upper()}")
    resp.raise_for_status()
    study = resp.json()
    info = summarize_study(study)
    elig = study["protocolSection"].get("eligibilityModule", {})
    info["eligibility_criteria"] = elig.get("eligibilityCriteria", "")[:6000]
    info["summary"] = study["protocolSection"].get("descriptionModule", {}).get("briefSummary", "")
    return info


def summarize_study(study: dict, location: str | None = None) -> dict:
    """Pick the fields a patient cares about out of the very large study record."""
    p = study["protocolSection"]
    ident = p.get("identificationModule", {})
    status = p.get("statusModule", {})
    design = p.get("designModule", {})
    elig = p.get("eligibilityModule", {})
    sites = p.get("contactsLocationsModule", {}).get("locations", [])
    interventions = p.get("armsInterventionsModule", {}).get("interventions", [])

    # Show matching sites first when a location was asked for.
    def matches(site):
        return location and location.lower() in " ".join(
            str(site.get(k, "")) for k in ("city", "state", "country")
        ).lower()

    sites = sorted(sites, key=lambda s: not matches(s))
    nct = ident.get("nctId", "")
    return {
        "nct_id": nct,
        "title": ident.get("briefTitle", ""),
        "status": status.get("overallStatus", ""),
        "study_type": design.get("studyType", ""),
        "phases": design.get("phases") or [],
        "interventions": [f"{i.get('type', '')}: {i.get('name', '')}" for i in interventions][:5],
        "age_range": f"{elig.get('minimumAge', 'any')} – {elig.get('maximumAge', 'any')}",
        "sex": elig.get("sex", ""),
        "start_date": status.get("startDateStruct", {}).get("date", ""),
        "sites": [
            ", ".join(x for x in (s.get("facility"), s.get("city"), s.get("country")) if x) for s in sites[:5]
        ],
        "site_count": len(sites),
        "url": f"https://clinicaltrials.gov/study/{nct}",
    }
