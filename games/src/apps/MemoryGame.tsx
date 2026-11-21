import { useEffect, useRef, useState } from "react";
import { Page } from "../components/Page";
import { TremorButton } from "../components/TremorButton";
import {
  GRID_SIZE,
  generateSequence,
  isPrefixCorrect,
  nextDifficulty,
  roundScore,
  scoreBeats,
  type BeatResult,
  type Difficulty,
} from "../lib/memoryGame";
import { load, save } from "../lib/storage";
import { useSettings } from "../lib/settings";
import { tick } from "../lib/sound";

const TILES = [
  { symbol: "★", name: "Star" },
  { symbol: "●", name: "Circle" },
  { symbol: "▲", name: "Triangle" },
  { symbol: "■", name: "Square" },
  { symbol: "◆", name: "Diamond" },
  { symbol: "♥", name: "Heart" },
  { symbol: "☀", name: "Sun" },
  { symbol: "☾", name: "Moon" },
  { symbol: "✿", name: "Flower" },
];

const LEAD_MS = 900; // pause before the first tile lights
const BEAT_MS = 800; // metronome period in dual-task mode
const BEAT_WINDOW_MS = 350; // generous: the press registers on release

type Phase = "intro" | "showing" | "recall" | "result";

interface Best {
  bestLength: number;
  bestSession: number;
  rounds: number;
}

export function MemoryGame() {
  const { sound } = useSettings();
  const [dualTask, setDualTask] = useState(false);
  const [phase, setPhase] = useState<Phase>("intro");
  const [difficulty, setDifficulty] = useState<Difficulty>(() => ({ length: load("memory-length", 3), streak: 0 }));
  const [sequence, setSequence] = useState<number[]>([]);
  const [answer, setAnswer] = useState<number[]>([]);
  const [lit, setLit] = useState<number | null>(null);
  const [beatOn, setBeatOn] = useState(false);
  const [lastRound, setLastRound] = useState<{ correct: boolean; points: number; beat?: BeatResult } | null>(null);
  const [sessionScore, setSessionScore] = useState(0);
  const [best, setBest] = useState<Best>(() => load("memory-best", { bestLength: 0, bestSession: 0, rounds: 0 }));
  const [announce, setAnnounce] = useState("");

  const timers = useRef<number[]>([]);
  const beatTimes = useRef<number[]>([]);
  const tapTimes = useRef<number[]>([]);
  const beatButton = useRef<HTMLButtonElement>(null);
  const firstTile = useRef<HTMLDivElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

  const startRound = () => {
    clearTimers();
    const seq = generateSequence(difficulty.length);
    const stepMs = dualTask ? 1100 : 900;
    setSequence(seq);
    setAnswer([]);
    setLastRound(null);
    setPhase("showing");
    setAnnounce(`Watch the route: ${seq.length} tiles.`);
    beatTimes.current = [];
    tapTimes.current = [];

    seq.forEach((tile, i) => {
      at(LEAD_MS + i * stepMs, () => {
        setLit(tile);
        setAnnounce(TILES[tile].name);
      });
      at(LEAD_MS + i * stepMs + stepMs * 0.65, () => setLit(null));
    });
    const showEnd = LEAD_MS + seq.length * stepMs;

    if (dualTask) {
      const t0 = performance.now();
      for (let t = LEAD_MS; t < showEnd; t += BEAT_MS) {
        beatTimes.current.push(t0 + t);
        at(t, () => {
          setBeatOn(true);
          if (sound) tick();
        });
        at(t + 200, () => setBeatOn(false));
      }
      requestAnimationFrame(() => beatButton.current?.focus());
    }

    at(showEnd, () => {
      setLit(null);
      setBeatOn(false);
      setPhase("recall");
      setAnnounce("Your turn. Tap the tiles in the same order.");
      requestAnimationFrame(() => firstTile.current?.querySelector("button")?.focus());
    });
  };

  const finishRound = (correct: boolean, seq: number[]) => {
    const beat = dualTask ? scoreBeats(beatTimes.current, tapTimes.current, BEAT_WINDOW_MS) : undefined;
    const points = roundScore(seq.length, correct, beat);
    const nextScore = sessionScore + points;
    setSessionScore(nextScore);
    setLastRound({ correct, points, beat });
    const next = nextDifficulty(difficulty, correct);
    setDifficulty(next);
    save("memory-length", next.length);
    const updated: Best = {
      bestLength: correct ? Math.max(best.bestLength, seq.length) : best.bestLength,
      bestSession: Math.max(best.bestSession, nextScore),
      rounds: best.rounds + 1,
    };
    setBest(updated);
    save("memory-best", updated);
    setPhase("result");
    requestAnimationFrame(() => resultHeading.current?.focus());
  };

  const pressTile = (tile: number) => {
    if (phase !== "recall") return;
    const next = [...answer, tile];
    setAnswer(next);
    if (!isPrefixCorrect(sequence, next)) finishRound(false, sequence);
    else if (next.length === sequence.length) finishRound(true, sequence);
  };

  // Number keys 1–9 press the tiles; handy for keyboard users.
  useEffect(() => {
    if (phase !== "recall") return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= GRID_SIZE) pressTile(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Page
      title="Path Recall"
      intro={
        <p>
          Nine tiles. A route lights up one tile at a time; then you tap the same tiles in the same order. Get two rounds right
          and the route grows by one; miss one and it gets shorter, so it stays challenging without being frustrating.
        </p>
      }
    >
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      <div className="status-row" aria-label="Game status">
        <span>Route length: <strong>{difficulty.length}</strong></span>
        <span>Score: <strong>{sessionScore}</strong></span>
        <span>Best route: <strong>{best.bestLength || "–"}</strong></span>
      </div>

      {phase === "intro" && (
        <div className="card stack">
          <label className="toggle-row">
            <input type="checkbox" checked={dualTask} onChange={(e) => setDualTask(e.target.checked)} />
            <span>
              Dual-task mode: tap a steady beat while you watch the route
            </span>
          </label>
          <p className="muted">
            Doing two things at once is harder for everyone, and many people with Parkinson's notice it more. Practising it
            in a safe, seated game is one way to explore it.
          </p>
          <TremorButton onPress={startRound}>Start</TremorButton>
        </div>
      )}

      {dualTask && phase === "showing" && (
        <div className="beat-area">
          <div className={`beat-light${beatOn ? " on" : ""}`} aria-hidden="true" />
          <TremorButton
            ref={beatButton}
            onPress={() => tapTimes.current.push(performance.now())}
            guardMs={150}
            className="beat-button"
            variant="secondary"
          >
            Tap the beat
          </TremorButton>
        </div>
      )}

      <div ref={firstTile} className={`tile-grid${phase === "recall" ? " active" : ""}`} role="group" aria-label="Tiles">
        {TILES.map((t, i) => (
          <TremorButton
            key={t.name}
            variant="plain"
            className={`tile${lit === i ? " lit" : ""}${phase === "recall" && answer[answer.length - 1] === i ? " chosen" : ""}`}
            aria-label={`${t.name}, key ${i + 1}`}
            aria-disabled={phase !== "recall"}
            onPress={() => pressTile(i)}
          >
            <span className="tile-symbol" aria-hidden="true">{t.symbol}</span>
            <span className="tile-key" aria-hidden="true">{i + 1}</span>
          </TremorButton>
        ))}
      </div>

      {phase === "recall" && (
        <p className="prompt">
          Your turn: {answer.length} of {sequence.length} tapped.
        </p>
      )}
      {phase === "showing" && <p className="prompt">Watch the route…</p>}

      {phase === "result" && lastRound && (
        <div className="card stack" role="status">
          <h2 ref={resultHeading} tabIndex={-1}>
            {lastRound.correct ? `Correct! +${lastRound.points} points` : "Not this time"}
          </h2>
          {!lastRound.correct && (
            <p>The route was: {sequence.map((t) => TILES[t].name).join(", ")}.</p>
          )}
          {lastRound.beat && (
            <p>
              Beat: {lastRound.beat.hits} of {lastRound.beat.beats} beats tapped
              {lastRound.beat.extras > 0 ? `, ${lastRound.beat.extras} extra taps` : ""}.
            </p>
          )}
          <p>Next route: {difficulty.length} tiles.</p>
          <div className="button-row">
            <TremorButton onPress={startRound}>Next round</TremorButton>
            <TremorButton
              variant="secondary"
              onPress={() => {
                setPhase("intro");
                setSessionScore(0);
              }}
            >
              Finish
            </TremorButton>
          </div>
        </div>
      )}
      <p className="muted">Rounds played on this device: {best.rounds}. Best session score: {best.bestSession}.</p>
    </Page>
  );
}
