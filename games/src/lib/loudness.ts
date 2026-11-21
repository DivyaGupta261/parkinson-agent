// Turning raw microphone samples into a loudness number.
//
// The Web Audio AnalyserNode hands us a block of samples between -1 and 1.
// RMS (root mean square) is the standard "how much energy is in this block"
// measure. Converting to decibels relative to full scale (dBFS) gives a
// log scale that matches how we hear: 0 dBFS is the loudest the mic can
// record, quieter sounds are negative numbers.
//
// dBFS is NOT the same as the dB SPL a sound-level meter shows. It depends on
// the microphone, its gain, and the distance to your mouth, which is why the
// app calibrates against your own normal speaking voice.

export const SILENCE_DB = -100;

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function rmsToDbfs(value: number): number {
  if (value <= 0) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(value));
}

export interface Band {
  low: number;
  high: number;
}

export type Zone = "quiet" | "target" | "over";

export function zoneOf(db: number, band: Band): Zone {
  if (db < band.low) return "quiet";
  if (db > band.high) return "over";
  return "target";
}

/** Meter position from 0 to 1 over a display range (default -70…0 dBFS). */
export function meterFraction(db: number, floor = -70, ceil = 0): number {
  return Math.min(1, Math.max(0, (db - floor) / (ceil - floor)));
}

/**
 * A target band from a short sample of your normal speaking voice:
 * aim a little louder than usual. Only frames above the noise floor count,
 * so pauses between words don't drag the average down.
 */
export function bandFromCalibration(frameDbs: number[], noiseFloorDb = -55): Band | null {
  const voiced = frameDbs.filter((d) => d > noiseFloorDb);
  if (voiced.length < 5) return null;
  const avg = voiced.reduce((a, b) => a + b, 0) / voiced.length;
  const low = Math.min(-12, Math.round(avg + 4));
  return { low, high: Math.min(-2, low + 12) };
}

export interface ExerciseSummary {
  /** Seconds the exercise ran. */
  seconds: number;
  /** Mean level of voiced frames, dBFS. */
  meanDb: number;
  /** Share of voiced frames inside the target band, 0..1. */
  inBandShare: number;
  /** Longest unbroken stretch inside the band, seconds. */
  longestHoldSec: number;
}

/**
 * Summarise an exercise from frame levels sampled at a fixed interval.
 * frameMs is the time between frames (about 16 ms at 60 fps).
 */
export function summariseFrames(
  frameDbs: number[],
  band: Band,
  frameMs: number,
  noiseFloorDb = -55,
): ExerciseSummary {
  const voiced = frameDbs.filter((d) => d > noiseFloorDb);
  const inBand = voiced.filter((d) => zoneOf(d, band) === "target").length;
  let run = 0;
  let longest = 0;
  for (const d of frameDbs) {
    run = zoneOf(d, band) === "target" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return {
    seconds: (frameDbs.length * frameMs) / 1000,
    meanDb: voiced.length ? voiced.reduce((a, b) => a + b, 0) / voiced.length : SILENCE_DB,
    inBandShare: voiced.length ? inBand / voiced.length : 0,
    longestHoldSec: (longest * frameMs) / 1000,
  };
}
