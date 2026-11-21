import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  citationAnchorId,
  citationIdFromHref,
  citationLabel,
  citationUrl,
  linkifyCitations,
  type CitationEntry,
} from "../lib/citations";

interface MarkdownProps {
  children: string;
  /**
   * When given, inline citations become numbered chips that jump to the
   * matching card on the page. Without it they link straight to PubMed or
   * ClinicalTrials.gov.
   */
  citations?: Map<string, CitationEntry>;
  /** Extra class for the wrapper, e.g. to tune spacing. */
  className?: string;
}

function isExternal(href: string | undefined): boolean {
  return !!href && /^https?:\/\//i.test(href);
}

function jumpToCard(id: string) {
  const card = document.getElementById(citationAnchorId(id));
  if (!card) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  card.focus({ preventScroll: true });
}

function CitationChip({ entry }: { entry: CitationEntry }) {
  const unverified = entry.citation !== null && !entry.citation.exists;
  const title = entry.citation?.title ?? citationLabel(entry.id);
  const label = `Source ${entry.number}: ${citationLabel(entry.id)}${
    unverified ? ", could not be verified" : ""
  }`;
  return (
    <a
      href={`#${citationAnchorId(entry.id)}`}
      className={`cite-chip${unverified ? " cite-chip--unverified" : ""}`}
      aria-label={label}
      title={title}
      onClick={(event) => {
        // Scroll to the card ourselves so the URL hash (our router) is untouched.
        event.preventDefault();
        jumpToCard(entry.id);
      }}
    >
      {entry.number}
      {unverified && <span aria-hidden="true">!</span>}
    </a>
  );
}

export function Markdown({ children, citations, className }: MarkdownProps) {
  const components: Components = {
    a({ href, children: linkChildren }): ReactNode {
      const citeId = citationIdFromHref(href);
      if (citeId) {
        const entry = citations?.get(citeId);
        if (entry) return <CitationChip entry={entry} />;
        return (
          <a href={citationUrl(citeId)} target="_blank" rel="noreferrer" className="cite-link">
            {citationLabel(citeId)}
          </a>
        );
      }
      if (isExternal(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {linkChildren}
          </a>
        );
      }
      return <a href={href}>{linkChildren}</a>;
    },
  };

  return (
    <div className={`prose${className ? ` ${className}` : ""}`}>
      <ReactMarkdown components={components}>{linkifyCitations(children)}</ReactMarkdown>
    </div>
  );
}
