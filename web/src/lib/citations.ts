// Pure helpers for the inline citations the agent writes, such as
// [PMID:12345678], [NCT01234567] or a group like [PMID:1; PMID:2].
// No React here, so everything is easy to unit test (see citations.test.ts).

import type { Citation } from "./types";

const ID_PATTERN = String.raw`PMID:\s*\d{1,9}|NCT\d{8}`;

// A bracketed group of one or more ids separated by commas or semicolons,
// not already followed by "(" (which would make it a markdown link).
const GROUP_RE = new RegExp(
  String.raw`\[\s*((?:${ID_PATTERN})(?:\s*[,;]\s*(?:${ID_PATTERN}))*)\s*\](?!\()`,
  "gi",
);
const ID_RE = new RegExp(ID_PATTERN, "gi");

// Fenced code blocks and inline code spans: citations inside them are left alone.
const CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/;

const ANCHOR_PREFIX = "cite-";

/** "pmid: 123" -> "PMID:123", "nct01234567" -> "NCT01234567", anything else -> null */
export function normalizeCitationId(raw: string): string | null {
  const text = raw.trim();
  const pmid = /^PMID:\s*(\d{1,9})$/i.exec(text);
  if (pmid) return `PMID:${pmid[1]}`;
  if (/^NCT\d{8}$/i.test(text)) return text.toUpperCase();
  return null;
}

export function citationKind(id: string): Citation["kind"] {
  return id.startsWith("NCT") ? "trial" : "pubmed";
}

/** The public page for a citation id. */
export function citationUrl(id: string): string {
  if (id.startsWith("PMID:")) {
    return `https://pubmed.ncbi.nlm.nih.gov/${id.slice(5)}/`;
  }
  return `https://clinicaltrials.gov/study/${id}`;
}

/** A short human label: "PMID 12345678" or "NCT01234567". */
export function citationLabel(id: string): string {
  return id.replace(":", " ");
}

/** The HTML id of a citation card, used as the target of the inline chips. */
export function citationAnchorId(id: string): string {
  return ANCHOR_PREFIX + id.replace(":", "-");
}

/** Reverse of citationAnchorId, taking a link href like "#cite-PMID-123". */
export function citationIdFromHref(href: string | undefined): string | null {
  if (!href?.startsWith("#" + ANCHOR_PREFIX)) return null;
  const rest = href.slice(1 + ANCHOR_PREFIX.length);
  return normalizeCitationId(rest.replace(/^PMID-/i, "PMID:"));
}

function splitIds(group: string): string[] {
  const ids: string[] = [];
  for (const match of group.matchAll(ID_RE)) {
    const id = normalizeCitationId(match[0]);
    if (id) ids.push(id);
  }
  return ids;
}

/** Apply `fn` to the parts of the markdown that are not code. */
function mapOutsideCode(markdown: string, fn: (text: string) => string): string {
  return markdown
    .split(CODE_RE)
    .map((part, i) => (i % 2 === 0 ? fn(part) : part))
    .join("");
}

/**
 * Turn each inline citation into a markdown link to its card, so a markdown
 * renderer can draw it as a chip: "[PMID:1; NCT01234567]" becomes
 * "[PMID:1](#cite-PMID-1)[NCT01234567](#cite-NCT01234567)".
 */
export function linkifyCitations(markdown: string): string {
  return mapOutsideCode(markdown, (text) =>
    text.replace(GROUP_RE, (_whole, group: string) =>
      splitIds(group)
        .map((id) => `[${id}](#${citationAnchorId(id)})`)
        .join(""),
    ),
  );
}

/** Every cited id, in order of first appearance, without duplicates. */
export function extractCitationIds(markdown: string): string[] {
  const seen = new Set<string>();
  const proseParts = markdown.split(CODE_RE).filter((_part, i) => i % 2 === 0);
  for (const text of proseParts) {
    for (const match of text.matchAll(GROUP_RE)) {
      for (const id of splitIds(match[1] ?? "")) seen.add(id);
    }
  }
  return [...seen];
}

export interface CitationEntry {
  /** 1-based number shown on the chip and the card. */
  number: number;
  id: string;
  /** null until the server's citation check has reported on this id. */
  citation: Citation | null;
}

/**
 * Number the citations for display: first everything cited in the answer,
 * in reading order, then any extra items the server reported.
 */
export function buildCitationEntries(markdown: string, items: Citation[]): CitationEntry[] {
  const byId = new Map<string, Citation>();
  for (const item of items) {
    const id = normalizeCitationId(item.id) ?? item.id;
    byId.set(id, item);
  }
  const ids = extractCitationIds(markdown);
  for (const id of byId.keys()) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.map((id, i) => ({ number: i + 1, id, citation: byId.get(id) ?? null }));
}
