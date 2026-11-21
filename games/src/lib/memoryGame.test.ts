import { describe, expect, it } from "vitest";
import {
  GRID_SIZE,
  MAX_LENGTH,
  MIN_LENGTH,
  beatAccuracy,
  generateSequence,
  isPrefixCorrect,
  nextDifficulty,
  roundScore,
  scoreBeats,
} from "./memoryGame";

/** A tiny seeded random generator, so tests are repeatable. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("memory game", () => {
  it("generates in-range routes with no immediate repeats", () => {
    const seq = generateSequence(50, seeded(42));
    expect(seq).toHaveLength(50);
    seq.forEach((t, i) => {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(GRID_SIZE);
      if (i > 0) expect(t).not.toBe(seq[i - 1]);
    });
  });

  it("checks partial answers", () => {
    expect(isPrefixCorrect([1, 4, 7], [1, 4])).toBe(true);
    expect(isPrefixCorrect([1, 4, 7], [1, 5])).toBe(false);
    expect(isPrefixCorrect([1, 4], [1, 4, 7])).toBe(false);
  });

  it("goes up after two correct rounds and down after one miss", () => {
    let d = { length: 3, streak: 0 };
    d = nextDifficulty(d, true);
    expect(d).toEqual({ length: 3, streak: 1 });
    d = nextDifficulty(d, true);
    expect(d).toEqual({ length: 4, streak: 0 });
    d = nextDifficulty(d, false);
    expect(d).toEqual({ length: 3, streak: 0 });
  });

  it("stays within the length limits", () => {
    expect(nextDifficulty({ length: MIN_LENGTH, streak: 0 }, false).length).toBe(MIN_LENGTH);
    expect(nextDifficulty({ length: MAX_LENGTH, streak: 1 }, true).length).toBe(MAX_LENGTH);
  });

  it("matches each beat to at most one tap", () => {
    const beats = [0, 1000, 2000];
    const r = scoreBeats(beats, [50, 80, 1950, 5000], 300);
    expect(r).toEqual({ beats: 3, hits: 2, extras: 2 });
    expect(beatAccuracy(r)).toBeCloseTo(1 / 3);
    expect(beatAccuracy({ beats: 3, hits: 0, extras: 9 })).toBe(0);
  });

  it("scores rounds, with a beat bonus in dual-task mode", () => {
    expect(roundScore(4, false)).toBe(0);
    expect(roundScore(4, true)).toBe(40);
    expect(roundScore(4, true, { beats: 4, hits: 4, extras: 0 })).toBe(60);
  });
});
