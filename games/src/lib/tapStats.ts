// Pure statistics for the finger-tapping tracker. No DOM, no React,
// so it is easy to unit-test (see tapStats.test.ts).

export type Hand = "left" | "right";

export interface TapStats {
  taps: number;
  tapsPerSec: number;
  /** Mean time between taps, in milliseconds. */
  meanIntervalMs: number;
  /** Standard deviation of the intervals, in milliseconds. */
  sdIntervalMs: number;
  /**
   * Coefficient of variation of the inter-tap intervals, as a percentage:
   * SD / mean × 100. Lower means a steadier rhythm. It is scale-free, so a
   * slow steady tapper and a fast steady tapper can be compared.
   */
  cvPercent: number;
}

/** Intervals between consecutive timestamps (ms). Needs at least 2 taps. */
export function intervals(timestamps: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < timestamps.length; i++) out.push(timestamps[i] - timestamps[i - 1]);
  return out;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n − 1), the usual choice for a small sample. */
export function sampleSd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

export function computeTapStats(timestamps: number[], durationMs: number): TapStats {
  const taps = timestamps.length;
  const ivs = intervals(timestamps);
  const meanIntervalMs = mean(ivs);
  const sdIntervalMs = sampleSd(ivs);
  return {
    taps,
    tapsPerSec: durationMs > 0 ? taps / (durationMs / 1000) : 0,
    meanIntervalMs,
    sdIntervalMs,
    cvPercent: meanIntervalMs > 0 ? (sdIntervalMs / meanIntervalMs) * 100 : 0,
  };
}

/**
 * Left/right difference as a percentage of the faster hand:
 * 0 means equal; 25 means the slower hand tapped 25% less.
 */
export function asymmetryPercent(leftRate: number, rightRate: number): number {
  const faster = Math.max(leftRate, rightRate);
  if (faster <= 0) return 0;
  return (Math.abs(leftRate - rightRate) / faster) * 100;
}

export function slowerHand(leftRate: number, rightRate: number): Hand | null {
  if (leftRate === rightRate) return null;
  return leftRate < rightRate ? "left" : "right";
}

export type Target = "A" | "B";

/**
 * The test asks for alternating taps (A, B, A, B…). A tap on the same target
 * twice in a row is not counted: it is usually a bounce or a tremor double-hit,
 * and counting it would inflate the rate.
 */
export function acceptTap(lastTarget: Target | null, target: Target): boolean {
  return lastTarget !== target;
}
