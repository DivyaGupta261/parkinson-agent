import { describe, expect, it } from "vitest";
import {
  type DiaryEntry,
  type DiaryState,
  MAX_SPAN_MS,
  awakePercentages,
  formatHours,
  makeExport,
  mergeEntries,
  parseImport,
  summariseDays,
  toSegments,
  totals,
} from "./diary";

const H = 60 * 60 * 1000;

function entry(id: string, time: number, state: DiaryState, extra: Partial<DiaryEntry> = {}): DiaryEntry {
  return { id, time, state, medication: "", tremor: "", stiffness: "", mood: "", sleep: "", notes: "", ...extra };
}

describe("diary", () => {
  // Local midnight, so the tests behave the same in any time zone.
  const day = new Date(2026, 10, 18, 0, 0, 0, 0).getTime();

  it("turns entries into segments that end at the next entry", () => {
    const entries = [entry("a", day + 8 * H, "on"), entry("b", day + 10 * H, "off")];
    const segs = toSegments(entries, day, day + 24 * H, day + 11 * H);
    expect(segs).toEqual([
      { start: day + 8 * H, end: day + 10 * H, state: "on" },
      { start: day + 10 * H, end: day + 11 * H, state: "off" },
    ]);
  });

  it("caps a state at MAX_SPAN_MS when nothing else was logged", () => {
    const segs = toSegments([entry("a", day + 8 * H, "on")], day, day + 24 * H, day + 23 * H);
    expect(segs[0].end - segs[0].start).toBe(MAX_SPAN_MS);
  });

  it("reports percentages of awake time, excluding sleep", () => {
    const t = { on: 6 * H, off: 2 * H, dyskinesia: 0, asleep: 8 * H };
    expect(awakePercentages(t)).toEqual({ awakeMs: 8 * H, on: 75, off: 25, dyskinesia: 0 });
    expect(awakePercentages({ on: 0, off: 0, dyskinesia: 0, asleep: 0 }).on).toBe(0);
  });

  it("summarises the last 7 days", () => {
    const now = day + 20 * H;
    const entries = [
      entry("old", day - 10 * 24 * H, "off"), // outside the window
      entry("1", day - 2 * 24 * H + 7 * H, "on", { medication: "levodopa 100mg" }),
      entry("2", day - 2 * 24 * H + 9 * H, "off", { tremor: "moderate" }),
      entry("3", day + 8 * H, "on", { mood: "low" }),
      entry("4", day + 9 * H, "dyskinesia"),
    ];
    const s = summariseDays(entries, now, 7);
    expect(s.days).toHaveLength(7);
    expect(s.days[6].dayStart).toBe(day);
    expect(s.entryCount).toBe(4);
    expect(s.totals.on).toBe(2 * H + 1 * H);
    expect(s.totals.off).toBe(3 * H);
    expect(s.totals.dyskinesia).toBe(3 * H);
    expect(s.percentages.on).toBeCloseTo(33.3);
    expect(s.medications).toEqual([{ time: day - 2 * 24 * H + 7 * H, medication: "levodopa 100mg" }]);
    expect(s.moderateOrWorse.tremor).toBe(1);
    expect(s.lowMoodCount).toBe(1);
    expect(totals(toSegments(entries, day, day + 24 * H, now)).on).toBe(H);
  });

  it("formats durations", () => {
    expect(formatHours(90 * 60000)).toBe("1h 30m");
    expect(formatHours(2 * H)).toBe("2h");
    expect(formatHours(5 * 60000)).toBe("5m");
  });

  it("round-trips an export and skips bad entries on import", () => {
    const entries = [entry("a", day, "on", { medication: "x" })];
    const text = JSON.stringify(makeExport(entries));
    expect(parseImport(text)).toEqual({ entries, skipped: 0 });

    const messy = JSON.stringify({ entries: [{ time: day, state: "flying" }, { time: "nope", state: "on" }, { time: day, state: "off", tremor: "huge" }] });
    const r = parseImport(messy);
    expect(r.skipped).toBe(2);
    expect(r.entries[0].state).toBe("off");
    expect(r.entries[0].tremor).toBe("");
    expect(() => parseImport("not json")).toThrow(/valid JSON/);
    expect(() => parseImport('{"foo":1}')).toThrow(/diary entries/);
  });

  it("merges imports by id", () => {
    const merged = mergeEntries([entry("a", 2, "on"), entry("b", 1, "off")], [entry("a", 3, "asleep")]);
    expect(merged.map((e) => [e.id, e.state])).toEqual([["b", "off"], ["a", "asleep"]]);
  });
});
