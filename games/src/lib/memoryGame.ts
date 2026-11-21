// Pure logic for the "Path Recall" memory game: sequence generation,
// checking an answer, adaptive difficulty and scoring.

export const GRID_SIZE = 9; // a 3×3 board of tiles
export const MIN_LENGTH = 2;
export const MAX_LENGTH = 9;

export type Rng = () => number;

/**
 * A random route through the board. Consecutive steps never repeat the same
 * tile, so a quick accidental double-tap can never be "the right answer".
 */
export function generateSequence(length: number, rng: Rng = Math.random): number[] {
  const seq: number[] = [];
  while (seq.length < length) {
    const tile = Math.floor(rng() * GRID_SIZE);
    if (seq.length > 0 && seq[seq.length - 1] === tile) continue;
    seq.push(tile);
  }
  return seq;
}

/** Is the partial answer still on track? */
export function isPrefixCorrect(sequence: number[], answer: number[]): boolean {
  if (answer.length > sequence.length) return false;
  return answer.every((tile, i) => sequence[i] === tile);
}

export interface Difficulty {
  length: number;
  /** Correct rounds in a row at this length. */
  streak: number;
}

/**
 * A simple "2 up, 1 down" staircase, as used in psychology experiments:
 * two correct rounds in a row → one tile longer; one miss → one tile shorter.
 * It settles near the length you get right about 70% of the time, which keeps
 * the game challenging without being discouraging.
 */
export function nextDifficulty(d: Difficulty, correct: boolean): Difficulty {
  if (correct) {
    if (d.streak + 1 >= 2) return { length: Math.min(MAX_LENGTH, d.length + 1), streak: 0 };
    return { length: d.length, streak: d.streak + 1 };
  }
  return { length: Math.max(MIN_LENGTH, d.length - 1), streak: 0 };
}

export interface BeatResult {
  beats: number;
  /** Taps that landed within the window around a beat. */
  hits: number;
  /** Taps that were nowhere near a beat. */
  extras: number;
}

/**
 * Match taps to metronome beats. Each beat can be claimed by at most one tap
 * within ±windowMs. Unmatched taps count as extras.
 */
export function scoreBeats(beatTimes: number[], tapTimes: number[], windowMs = 300): BeatResult {
  const claimed = new Set<number>();
  let hits = 0;
  let extras = 0;
  for (const tap of tapTimes) {
    let best = -1;
    let bestDist = Infinity;
    beatTimes.forEach((beat, i) => {
      const dist = Math.abs(tap - beat);
      if (!claimed.has(i) && dist <= windowMs && dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    });
    if (best >= 0) {
      claimed.add(best);
      hits++;
    } else {
      extras++;
    }
  }
  return { beats: beatTimes.length, hits, extras };
}

/** Beat accuracy from 0 to 1. Extra taps cost a little, so mashing doesn't win. */
export function beatAccuracy(r: BeatResult): number {
  if (r.beats === 0) return 0;
  return Math.max(0, (r.hits - 0.5 * r.extras) / r.beats);
}

/**
 * Points for one round: 10 per tile when the route is recalled correctly,
 * plus up to 50% extra for keeping the beat in dual-task mode.
 */
export function roundScore(length: number, correct: boolean, beat?: BeatResult): number {
  if (!correct) return 0;
  const base = length * 10;
  const bonus = beat ? Math.round(base * 0.5 * beatAccuracy(beat)) : 0;
  return base + bonus;
}
