import { describe, expect, it } from "vitest";
import { acceptTap, asymmetryPercent, computeTapStats, intervals, sampleSd, slowerHand } from "./tapStats";

describe("tap statistics", () => {
  it("computes intervals between taps", () => {
    expect(intervals([0, 200, 450, 600])).toEqual([200, 250, 150]);
    expect(intervals([100])).toEqual([]);
  });

  it("gives zero variability for a perfectly steady rhythm", () => {
    const taps = Array.from({ length: 21 }, (_, i) => i * 200); // 5 taps/sec
    const s = computeTapStats(taps, 4200);
    expect(s.taps).toBe(21);
    expect(s.tapsPerSec).toBeCloseTo(5, 5);
    expect(s.meanIntervalMs).toBe(200);
    expect(s.cvPercent).toBe(0);
  });

  it("uses the sample standard deviation for CV", () => {
    // intervals 100, 300 → mean 200, sample SD √20000 ≈ 141.42 → CV ≈ 70.7%
    const s = computeTapStats([0, 100, 400], 1000);
    expect(s.sdIntervalMs).toBeCloseTo(141.42, 1);
    expect(s.cvPercent).toBeCloseTo(70.71, 1);
    expect(sampleSd([5])).toBe(0);
  });

  it("handles no taps without dividing by zero", () => {
    const s = computeTapStats([], 10000);
    expect(s).toEqual({ taps: 0, tapsPerSec: 0, meanIntervalMs: 0, sdIntervalMs: 0, cvPercent: 0 });
  });

  it("compares hands as a percentage of the faster one", () => {
    expect(asymmetryPercent(4, 5)).toBeCloseTo(20);
    expect(asymmetryPercent(5, 5)).toBe(0);
    expect(asymmetryPercent(0, 0)).toBe(0);
    expect(slowerHand(4, 5)).toBe("left");
    expect(slowerHand(5, 5)).toBeNull();
  });

  it("only counts alternating taps", () => {
    expect(acceptTap(null, "A")).toBe(true);
    expect(acceptTap("A", "B")).toBe(true);
    expect(acceptTap("A", "A")).toBe(false);
  });
});
