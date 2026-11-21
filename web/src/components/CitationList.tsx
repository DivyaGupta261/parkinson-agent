import { citationAnchorId, citationLabel, citationUrl, type CitationEntry } from "../lib/citations";

function CitationCard({ entry }: { entry: CitationEntry }) {
  const { citation } = entry;
  const isTrial = entry.id.startsWith("NCT");
  const unverified = citation !== null && !citation.exists;
  const url = citation?.url || citationUrl(entry.id);
  const meta = [citation?.year, citation?.source].filter(Boolean).join(" · ");

  return (
    <li
      id={citationAnchorId(entry.id)}
      tabIndex={-1}
      className={`cite-card${unverified ? " cite-card--unverified" : ""}`}
    >
      <span className="cite-card__number" aria-hidden="true">
        {entry.number}
      </span>
      <div className="cite-card__body">
        <p className="cite-card__kind">
          <span className="visually-hidden">Source {entry.number}, </span>
          {isTrial ? "Clinical trial" : "PubMed"} · {citationLabel(entry.id)}
        </p>
        <p className="cite-card__title">
          {citation?.title ?? (unverified ? "Source not found" : citationLabel(entry.id))}
        </p>
        {meta && <p className="cite-card__meta">{meta}</p>}
        {unverified && (
          <p className="cite-card__warning" role="note">
            <strong>Could not be verified.</strong> This {isTrial ? "trial" : "paper"} was not
            found, so the claim it supports may not be reliable.
          </p>
        )}
        {citation === null && <p className="cite-card__meta">Not checked yet.</p>}
        <a className="cite-card__link" href={url} target="_blank" rel="noreferrer">
          {isTrial ? "Open on ClinicalTrials.gov" : "Open on PubMed"}
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </div>
    </li>
  );
}

export function CitationList({ entries }: { entries: CitationEntry[] }) {
  if (entries.length === 0) return null;
  const unverified = entries.filter((e) => e.citation && !e.citation.exists).length;
  return (
    <section className="citations" aria-labelledby="sources-heading">
      <h3 id="sources-heading">Sources</h3>
      {unverified > 0 && (
        <p className="banner banner--danger">
          {unverified === 1
            ? "1 source could not be verified."
            : `${unverified} sources could not be verified.`}{" "}
          Treat the claims that cite {unverified === 1 ? "it" : "them"} with caution.
        </p>
      )}
      <ol className="cite-list">
        {entries.map((entry) => (
          <CitationCard key={entry.id} entry={entry} />
        ))}
      </ol>
    </section>
  );
}
