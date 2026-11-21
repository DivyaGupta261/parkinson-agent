import { useEffect, useState } from "react";
import { STATES, formatHours, startOfDay, toSegments, totals, type DiaryEntry, type DiaryState } from "../lib/diary";
import { load, save } from "../lib/storage";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The diary entries, kept in localStorage. Shared by the diary and the summary. */
export function useDiaryEntries() {
  const [entries, setEntries] = useState<DiaryEntry[]>(() => load("diary", []));
  useEffect(() => {
    save("diary", entries);
  }, [entries]);
  return [entries, setEntries] as const;
}

export const stateShort = (s: DiaryState) => STATES.find((x) => x.value === s)?.short ?? s;

/**
 * One day as a horizontal bar from midnight to midnight, built from plain
 * divs positioned with percentages, so it stretches to any screen width.
 * Each state has its own colour AND its own pattern (see .state-* in
 * styles.css), so it still reads in black-and-white print and for people who
 * can't tell the colours apart.
 */
export function DayTimeline({
  entries,
  dayStart,
  now = Date.now(),
  compact = false,
}: {
  entries: DiaryEntry[];
  dayStart: number;
  now?: number;
  compact?: boolean;
}) {
  const dayEnd = startOfDay(dayStart + DAY_MS * 1.5); // safe across daylight-saving changes
  const segs = toSegments(entries, dayStart, dayEnd, now);
  const t = totals(segs);
  const pct = (ms: number) => ((ms - dayStart) / (dayEnd - dayStart)) * 100;
  const label = segs.length
    ? `Timeline: ${STATES.filter((s) => t[s.value] > 0)
        .map((s) => `${s.short} ${formatHours(t[s.value])}`)
        .join(", ")}.`
    : "Timeline: nothing recorded.";

  return (
    <div className={`timeline${compact ? " compact" : ""}`}>
      <div className="timeline-bar" role="img" aria-label={label}>
        {segs.map((s, i) => (
          <div
            key={i}
            className={`timeline-seg state-${s.state}`}
            style={{ left: `${pct(s.start)}%`, width: `${pct(s.end) - pct(s.start)}%` }}
          />
        ))}
        {[25, 50, 75].map((p) => (
          <div key={p} className="timeline-tick" style={{ left: `${p}%` }} />
        ))}
      </div>
      {!compact && (
        <div className="timeline-labels" aria-hidden="true">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      )}
    </div>
  );
}

export function StateLegend() {
  return (
    <ul className="legend state-legend">
      {STATES.map((s) => (
        <li key={s.value} className="legend-item">
          <span className={`swatch state-${s.value}`} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
