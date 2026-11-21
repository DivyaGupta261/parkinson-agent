// Pure logic for the ON/OFF diary: the entry type, turning a list of
// point-in-time entries into time spent in each state, the 7-day summary,
// and validating imported JSON.

export type DiaryState = "on" | "off" | "dyskinesia" | "asleep";
export type Level = "" | "none" | "mild" | "moderate" | "severe";
export type Mood = "" | "good" | "okay" | "low";

export const STATES: { value: DiaryState; label: string; short: string }[] = [
  { value: "on", label: "ON (moving well)", short: "ON" },
  { value: "off", label: "OFF (slow, stiff or shaky)", short: "OFF" },
  { value: "dyskinesia", label: "ON with troublesome dyskinesia", short: "ON + dyskinesia" },
  { value: "asleep", label: "Asleep", short: "Asleep" },
];

export interface DiaryEntry {
  id: string;
  /** When the state started, as epoch milliseconds. */
  time: number;
  state: DiaryState;
  medication: string;
  tremor: Level;
  stiffness: Level;
  mood: Mood;
  sleep: string;
  notes: string;
}

/**
 * Each entry marks the state from its time until the next entry, but for at
 * most this long. A gap longer than this is "not recorded" rather than
 * silently stretched, so forgetting to log for a day doesn't skew the numbers.
 */
export const MAX_SPAN_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Segment {
  start: number;
  end: number;
  state: DiaryState;
}

/** Convert entries into time segments, clipped to [from, to). */
export function toSegments(entries: DiaryEntry[], from: number, to: number, now = Date.now()): Segment[] {
  const sorted = [...entries].sort((a, b) => a.time - b.time);
  const segs: Segment[] = [];
  sorted.forEach((e, i) => {
    const next = sorted[i + 1]?.time ?? Infinity;
    const rawEnd = Math.min(next, e.time + MAX_SPAN_MS, now);
    const start = Math.max(e.time, from);
    const end = Math.min(rawEnd, to);
    if (end > start) segs.push({ start, end, state: e.state });
  });
  return segs;
}

export type Totals = Record<DiaryState, number>;

export function emptyTotals(): Totals {
  return { on: 0, off: 0, dyskinesia: 0, asleep: 0 };
}

export function totals(segs: Segment[]): Totals {
  const t = emptyTotals();
  for (const s of segs) t[s.state] += s.end - s.start;
  return t;
}

export interface Percentages {
  /** Recorded awake time in ms (ON + OFF + dyskinesia). */
  awakeMs: number;
  on: number;
  off: number;
  dyskinesia: number;
}

/**
 * Percentages of recorded AWAKE time, which is how ON/OFF diaries are usually
 * reported: sleep is shown separately, not as part of the split.
 */
export function awakePercentages(t: Totals): Percentages {
  const awakeMs = t.on + t.off + t.dyskinesia;
  const pct = (ms: number) => (awakeMs > 0 ? Math.round((ms / awakeMs) * 1000) / 10 : 0);
  return { awakeMs, on: pct(t.on), off: pct(t.off), dyskinesia: pct(t.dyskinesia) };
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DaySummary {
  dayStart: number;
  totals: Totals;
  entries: DiaryEntry[];
}

export interface WeekSummary {
  from: number;
  to: number;
  days: DaySummary[];
  totals: Totals;
  percentages: Percentages;
  entryCount: number;
  /** Entries where a medication was noted, oldest first. */
  medications: { time: number; medication: string }[];
  /** How many entries noted each symptom at moderate or severe. */
  moderateOrWorse: { tremor: number; stiffness: number };
  lowMoodCount: number;
}

/** Summary of the last `days` calendar days, including today. */
export function summariseDays(entries: DiaryEntry[], now = Date.now(), days = 7): WeekSummary {
  const todayStart = startOfDay(now);
  const from = startOfDay(todayStart - (days - 1) * DAY_MS + DAY_MS / 2);
  const daySummaries: DaySummary[] = [];
  for (let i = 0; i < days; i++) {
    // Step by midday so daylight-saving changes don't skip or repeat a day.
    const dayStart = startOfDay(from + i * DAY_MS + DAY_MS / 2);
    const dayEnd = startOfDay(dayStart + DAY_MS + DAY_MS / 2);
    daySummaries.push({
      dayStart,
      totals: totals(toSegments(entries, dayStart, dayEnd, now)),
      entries: entries.filter((e) => e.time >= dayStart && e.time < dayEnd).sort((a, b) => a.time - b.time),
    });
  }
  const t = totals(toSegments(entries, from, now, now));
  const inRange = entries.filter((e) => e.time >= from && e.time <= now).sort((a, b) => a.time - b.time);
  const serious = (l: Level) => l === "moderate" || l === "severe";
  return {
    from,
    to: now,
    days: daySummaries,
    totals: t,
    percentages: awakePercentages(t),
    entryCount: inRange.length,
    medications: inRange.filter((e) => e.medication.trim()).map((e) => ({ time: e.time, medication: e.medication.trim() })),
    moderateOrWorse: {
      tremor: inRange.filter((e) => serious(e.tremor)).length,
      stiffness: inRange.filter((e) => serious(e.stiffness)).length,
    },
    lowMoodCount: inRange.filter((e) => e.mood === "low").length,
  };
}

export function formatHours(ms: number): string {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ---- Import / export ----

export const EXPORT_FORMAT = "pd-games-diary";

export interface DiaryExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  entries: DiaryEntry[];
}

export function makeExport(entries: DiaryEntry[], now = new Date()): DiaryExport {
  return { format: EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(), entries };
}

const STATE_VALUES = new Set<string>(STATES.map((s) => s.value));
const LEVELS = new Set<string>(["", "none", "mild", "moderate", "severe"]);
const MOODS = new Set<string>(["", "good", "okay", "low"]);

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * Parse and validate an imported file. Never trust a file just because it is
 * JSON: check every field, drop entries that don't make sense, and report how
 * many were skipped instead of failing the whole import.
 */
export function parseImport(text: string): { entries: DiaryEntry[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const list = Array.isArray(data) ? data : (data as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) throw new Error("That file doesn't contain diary entries.");
  const entries: DiaryEntry[] = [];
  let skipped = 0;
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    const time = typeof r?.time === "number" ? r.time : Date.parse(str(r?.time));
    if (!r || typeof r !== "object" || !Number.isFinite(time) || !STATE_VALUES.has(str(r.state))) {
      skipped++;
      continue;
    }
    entries.push({
      id: str(r.id, 100) || `import-${time}-${entries.length}`,
      time,
      state: r.state as DiaryState,
      medication: str(r.medication),
      tremor: (LEVELS.has(str(r.tremor)) ? str(r.tremor) : "") as Level,
      stiffness: (LEVELS.has(str(r.stiffness)) ? str(r.stiffness) : "") as Level,
      mood: (MOODS.has(str(r.mood)) ? str(r.mood) : "") as Mood,
      sleep: str(r.sleep),
      notes: str(r.notes, 2000),
    });
  }
  return { entries, skipped };
}

/** Merge imported entries into existing ones; an entry with the same id is replaced. */
export function mergeEntries(existing: DiaryEntry[], incoming: DiaryEntry[]): DiaryEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.time - b.time);
}
