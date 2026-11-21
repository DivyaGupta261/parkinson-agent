import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Page } from "../components/Page";
import { TremorButton } from "../components/TremorButton";
import { TrendChart } from "../components/TrendChart";
import { acceptTap, asymmetryPercent, computeTapStats, slowerHand, type Hand, type Target } from "../lib/tapStats";
import { load, makeId, save } from "../lib/storage";

const TEST_MS = 10_000;
const COUNTDOWN = 3;

export interface TapSession {
  id: string;
  time: number;
  hand: Hand;
  taps: number;
  tapsPerSec: number;
  cvPercent: number;
  /** Same-target repeats that were not counted. */
  ignored: number;
  note: string;
}

type Phase = "choose" | "countdown" | "running" | "done";

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function TappingTracker() {
  const [history, setHistory] = useState<TapSession[]>(() => load("tapping-history", []));
  const [phase, setPhase] = useState<Phase>("choose");
  const [hand, setHand] = useState<Hand>("right");
  const [note, setNote] = useState("");
  const [count, setCount] = useState(COUNTDOWN);
  const [secondsLeft, setSecondsLeft] = useState(10);
  const [accepted, setAccepted] = useState(0);
  const [lastHit, setLastHit] = useState<Target | null>(null);
  const [result, setResult] = useState<TapSession | null>(null);

  const handRef = useRef<Hand>("right");
  const startAt = useRef(0);
  const taps = useRef<number[]>([]);
  const lastTarget = useRef<Target | null>(null);
  const ignored = useRef(0);
  const timers = useRef<number[]>([]);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const targetA = useRef<HTMLButtonElement>(null);

  // Persist whenever the history changes (state updaters must stay pure).
  useEffect(() => {
    save("tapping-history", history);
  }, [history]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const begin = (h: Hand) => {
    handRef.current = h;
    setHand(h);
    setPhase("countdown");
    setCount(COUNTDOWN);
    for (let i = 1; i <= COUNTDOWN; i++) {
      timers.current.push(window.setTimeout(() => setCount(COUNTDOWN - i), i * 1000));
    }
    timers.current.push(window.setTimeout(run, COUNTDOWN * 1000));
  };

  const run = () => {
    taps.current = [];
    lastTarget.current = null;
    ignored.current = 0;
    setAccepted(0);
    setLastHit(null);
    setSecondsLeft(10);
    startAt.current = performance.now();
    setPhase("running");
    requestAnimationFrame(() => targetA.current?.focus());
    for (let s = 1; s <= 10; s++) {
      timers.current.push(window.setTimeout(() => setSecondsLeft(10 - s), s * 1000));
    }
    timers.current.push(window.setTimeout(finish, TEST_MS));
  };

  const finish = () => {
    const stats = computeTapStats(taps.current, TEST_MS);
    const session: TapSession = {
      id: makeId(),
      time: Date.now(),
      hand: handRef.current,
      taps: stats.taps,
      tapsPerSec: Math.round(stats.tapsPerSec * 100) / 100,
      cvPercent: Math.round(stats.cvPercent * 10) / 10,
      ignored: ignored.current,
      note: note.trim(),
    };
    setResult(session);
    setHistory((prev) => [...prev, session]);
    setPhase("done");
    requestAnimationFrame(() => resultHeading.current?.focus());
  };

  // Timing matters here, so taps are timed on pointerDOWN (the moment the
  // finger lands). Bounces are handled by the alternation rule instead of a
  // time guard, because fast tappers can be under 200 ms per tap.
  const hit = (target: Target) => {
    if (phase !== "running") return;
    const now = performance.now();
    if (now - startAt.current > TEST_MS) return;
    if (!acceptTap(lastTarget.current, target)) {
      ignored.current++;
      return;
    }
    lastTarget.current = target;
    taps.current.push(now);
    setAccepted(taps.current.length);
    setLastHit(target);
  };

  const onPointerDown = (target: Target) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault(); // no focus shuffle, no text selection, no double-tap zoom
    hit(target);
  };

  // Keyboard: F / ← for the left target, J / → for the right one.
  useEffect(() => {
    if (phase !== "running") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "f" || k === "arrowleft") hit("A");
      else if (k === "j" || k === "arrowright") hit("B");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const latest = (h: Hand) => [...history].reverse().find((s) => s.hand === h);
  const latestLeft = latest("left");
  const latestRight = latest("right");

  const clearHistory = () => {
    if (!window.confirm("Delete all tapping results on this device?")) return;
    setHistory([]);
  };

  const chartSeries = (["left", "right"] as const).map((h, i) => ({
    key: h,
    label: h === "left" ? "Left hand" : "Right hand",
    color: `var(--series-${i + 1})`,
    marker: (h === "left" ? "circle" : "square") as "circle" | "square",
    points: history
      .filter((s) => s.hand === h)
      .map((s) => ({ x: s.time, y: s.tapsPerSec, title: `${h} hand, ${fmtDateTime(s.time)}: ${s.tapsPerSec} taps/s` })),
  }));

  return (
    <Page
      title="Tap Tracker"
      intro={
        <p>
          Rest your arm on a table. Using your index finger, tap the two targets <strong>in turn</strong> (left, right, left,
          right…) as quickly and evenly as you can for 10 seconds. Then do the other hand.
        </p>
      }
    >
      {phase === "choose" && (
        <div className="card stack">
          <label className="field">
            <span>Optional note (for example "1 hour after my dose")</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
          </label>
          <div className="button-row">
            <TremorButton onPress={() => begin("left")}>Test left hand</TremorButton>
            <TremorButton onPress={() => begin("right")}>Test right hand</TremorButton>
          </div>
          <p className="muted">Keyboard: press F and J (or ← and →) in turn.</p>
        </div>
      )}

      {phase === "countdown" && (
        <p className="countdown" role="status" aria-live="assertive">
          {hand === "left" ? "Left" : "Right"} hand. Starting in {count}…
        </p>
      )}

      {phase === "running" && (
        <div className="tap-test">
          <p className="prompt" aria-live="off">
            {secondsLeft} s left · {accepted} taps
          </p>
          <div className="progress" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${((10 - secondsLeft) / 10) * 100}%` }} />
          </div>
          <div className="tap-targets">
            <button
              ref={targetA}
              type="button"
              className={`tap-target${lastHit === "A" ? " hit" : ""}`}
              aria-label="Left target (F key)"
              onPointerDown={onPointerDown("A")}
            >
              A
            </button>
            <button
              type="button"
              className={`tap-target${lastHit === "B" ? " hit" : ""}`}
              aria-label="Right target (J key)"
              onPointerDown={onPointerDown("B")}
            >
              B
            </button>
          </div>
        </div>
      )}

      {phase === "done" && result && (
        <div className="card stack" role="status">
          <h2 ref={resultHeading} tabIndex={-1}>
            {result.hand === "left" ? "Left" : "Right"} hand: {result.tapsPerSec} taps per second
          </h2>
          <dl className="stats">
            <div><dt>Taps counted</dt><dd>{result.taps}</dd></div>
            <div><dt>Rhythm variability (CV)</dt><dd>{result.cvPercent}%</dd></div>
            <div><dt>Repeats not counted</dt><dd>{result.ignored}</dd></div>
          </dl>
          <p className="muted">Lower variability means a steadier rhythm.</p>
          <div className="button-row">
            <TremorButton onPress={() => begin(result.hand === "left" ? "right" : "left")}>
              Now the {result.hand === "left" ? "right" : "left"} hand
            </TremorButton>
            <TremorButton variant="secondary" onPress={() => setPhase("choose")}>Done</TremorButton>
          </div>
        </div>
      )}

      {latestLeft && latestRight && phase !== "running" && (
        <section className="card" aria-labelledby="compare-h">
          <h2 id="compare-h">Left and right, latest results</h2>
          <p>
            Left {latestLeft.tapsPerSec} taps/s (CV {latestLeft.cvPercent}%) · Right {latestRight.tapsPerSec} taps/s (CV{" "}
            {latestRight.cvPercent}%).
          </p>
          <p>
            {slowerHand(latestLeft.tapsPerSec, latestRight.tapsPerSec)
              ? `The ${slowerHand(latestLeft.tapsPerSec, latestRight.tapsPerSec)} hand was ${asymmetryPercent(latestLeft.tapsPerSec, latestRight.tapsPerSec).toFixed(0)}% slower.`
              : "Both hands tapped at the same rate."}
          </p>
          <p className="muted">
            Results vary with time of day, sleep, and medication timing. A trend over weeks says more than one test; share it
            with your care team rather than reading too much into a single number.
          </p>
        </section>
      )}

      {history.length > 0 && phase !== "running" && (
        <section aria-labelledby="history-h">
          <h2 id="history-h">History</h2>
          <TrendChart
            series={chartSeries}
            yLabel="Taps per second"
            formatX={fmtDate}
            description={`Taps per second over time: ${history.length} tests. Full data in the table below.`}
          />
          <div className="table-wrap">
            <table>
              <caption className="sr-only">All tapping results, newest first</caption>
              <thead>
                <tr><th scope="col">When</th><th scope="col">Hand</th><th scope="col">Taps/s</th><th scope="col">CV</th><th scope="col">Note</th></tr>
              </thead>
              <tbody>
                {[...history].reverse().slice(0, 30).map((s) => (
                  <tr key={s.id}>
                    <td>{fmtDateTime(s.time)}</td>
                    <td>{s.hand}</td>
                    <td>{s.tapsPerSec}</td>
                    <td>{s.cvPercent}%</td>
                    <td>{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TremorButton variant="danger" onPress={clearHistory}>Delete tapping history</TremorButton>
        </section>
      )}
    </Page>
  );
}
