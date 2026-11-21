// Display formatting. Times are shown in India Standard Time; change
// DISPLAY_TIME_ZONE to use a different zone everywhere.

export const DISPLAY_TIME_ZONE = "Asia/Kolkata";
export const DISPLAY_TIME_ZONE_LABEL = "IST";

/**
 * Parse a UTC timestamp from the server. Python's isoformat() leaves off the
 * "Z" for naive datetimes, and JavaScript would then read it as local time,
 * so a timestamp with no offset is treated as UTC.
 */
export function parseUtc(iso: string): Date | null {
  const text = iso.trim().replace(" ", "T");
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasOffset ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "19 Nov 2026, 1:32 pm IST" */
export function formatDateTime(iso: string): string {
  const date = parseUtc(iso);
  if (!date) return iso;
  const text = new Intl.DateTimeFormat("en-IN", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${text} ${DISPLAY_TIME_ZONE_LABEL}`;
}

/** "2026-11-19" -> "19 November 2026" (a calendar date, so no time zone shift). */
export function formatDigestDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, y, m, d] = match;
  const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(utc);
}

/** Costs under a dollar keep four decimals: $0.0462 rather than $0.05. */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return "";
  const digits = usd !== 0 && Math.abs(usd) < 1 ? 4 : 2;
  return `$${usd.toFixed(digits)}`;
}

const TOOL_LABELS: Record<string, string> = {
  search_pubmed: "Searching PubMed",
  fetch_abstracts: "Reading abstracts",
  search_trials: "Searching ClinicalTrials.gov",
  get_trial: "Reading a trial record",
  search_europepmc: "Searching Europe PMC",
  read_full_text: "Reading a full-text paper",
  web_search: "Searching the web",
  recall: "Checking saved notes",
  remember: "Saving a note",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Using ${name.replace(/_/g, " ")}`;
}

/** A one-line summary of a tool's input, such as the search query. */
export function toolInputSummary(input: Record<string, unknown>): string {
  const preferred = ["query", "pmids", "nct_id", "pmcid", "pmid", "q", "term", "id", "title"];
  for (const key of preferred) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    return Array.isArray(value) ? value.join(", ") : String(value);
  }
  const parts = Object.entries(input)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.join(" · ");
}
