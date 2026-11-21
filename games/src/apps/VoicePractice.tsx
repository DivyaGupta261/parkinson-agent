import { useEffect, useRef, useState } from "react";
import { Page } from "../components/Page";
import { TremorButton } from "../components/TremorButton";
import {
  bandFromCalibration,
  meterFraction,
  rms,
  rmsToDbfs,
  SILENCE_DB,
  summariseFrames,
  zoneOf,
  type Band,
  type Zone,
} from "../lib/loudness";
import { load, makeId, save } from "../lib/storage";

const FRAME_MS = 50; // 20 measurements per second
const METER_FLOOR = -70;
const DEFAULT_BAND: Band = { low: -30, high: -18 };
const CALIBRATE_MS = 4000;

const SENTENCES = [
  "The kettle is on, so come and sit by the window.",
  "Please pass the blue folder from the top shelf.",
  "We walked along the river until the light began to fade.",
  "My favourite soup has tomatoes, basil and a little pepper.",
  "The train to the coast leaves at a quarter past nine.",
  "Could you open the back door and let the dog in?",
];

type MicStatus = "idle" | "requesting" | "live" | "denied" | "nomic" | "unsupported" | "error";
type Exercise = "ahh" | "sentence" | "calibrate";

interface LogEntry {
  id: string;
  time: number;
  exercise: "ahh" | "sentence";
  seconds: number;
  meanDb: number;
  inBandPct: number;
  longestHoldSec: number;
}

const ZONE_TEXT: Record<Zone, string> = {
  quiet: "Below target: a little stronger",
  target: "In the target zone",
  over: "Above target: ease off a little",
};

export function VoicePractice() {
  const [status, setStatus] = useState<MicStatus>("idle");
  const [level, setLevel] = useState(-100);
  const [band, setBand] = useState<Band>(() => load("voice-band", DEFAULT_BAND));
  const [running, setRunning] = useState<Exercise | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [holdSecs, setHoldSecs] = useState(10);
  const [sentence, setSentence] = useState(0);
  const [log, setLog] = useState<LogEntry[]>(() => load("voice-log", []));
  const [message, setMessage] = useState("");
  const [spokenZone, setSpokenZone] = useState("");

  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const interval = useRef<number | null>(null);
  const frames = useRef<number[] | null>(null); // non-null while recording an exercise
  const smoothed = useRef(-100);
  const lastSpoken = useRef(0);
  const stopCountdown = useRef<() => void>(() => undefined);
  const bandRef = useRef(band);
  bandRef.current = band;

  useEffect(() => void save("voice-band", band), [band]);
  useEffect(() => void save("voice-log", log), [log]);

  const stopMic = () => {
    stopCountdown.current();
    if (interval.current !== null) window.clearInterval(interval.current);
    interval.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    frames.current = null;
    setRunning(null);
    setStatus("idle");
    setLevel(-100);
  };
  useEffect(() => () => stopMic(), []); // release the microphone when leaving the page

  const startMic = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    setStatus("requesting");
    // Create the AudioContext now, while we are still inside the click, so
    // the browser's autoplay rules let it run. After the permission prompt
    // the "user gesture" may have expired and it would start suspended.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      setStatus("unsupported");
      return;
    }
    try {
      // Turn off the browser's automatic gain control, which would otherwise
      // "helpfully" level out exactly the loudness we are trying to measure.
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      const source = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser); // not connected to the speakers: no feedback
      const buf = new Float32Array(analyser.fftSize);
      stream.current = s;
      audioCtx.current = ctx;

      interval.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        const db = rmsToDbfs(rms(buf));
        frames.current?.push(db);
        // Light smoothing so the meter is readable rather than jittery.
        smoothed.current = 0.6 * smoothed.current + 0.4 * db;
        setLevel(smoothed.current);
        // Screen readers: announce zone changes, at most every 2 seconds.
        const now = performance.now();
        if (now - lastSpoken.current > 2000 && smoothed.current > -55) {
          lastSpoken.current = now;
          setSpokenZone(ZONE_TEXT[zoneOf(smoothed.current, bandRef.current)]);
        }
      }, FRAME_MS);
      setStatus("live");
    } catch (err) {
      void ctx.close().catch(() => undefined);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setStatus("denied");
      else if (name === "NotFoundError" || name === "OverconstrainedError") setStatus("nomic");
      else setStatus("error");
    }
  };

  const runExercise = (kind: Exercise, ms: number) => {
    frames.current = [];
    setRunning(kind);
    setMessage("");
    setRemaining(Math.ceil(ms / 1000));
    const started = performance.now();
    const countdown = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((ms - (performance.now() - started)) / 1000));
      setRemaining(left);
      if (left === 0) {
        window.clearInterval(countdown);
        endExercise(kind);
      }
    }, 250);
    stopCountdown.current = () => window.clearInterval(countdown);
  };

  const endExercise = (kind: Exercise) => {
    stopCountdown.current();
    const recorded = frames.current ?? [];
    frames.current = null;
    setRunning(null);
    if (kind === "calibrate") {
      const b = bandFromCalibration(recorded);
      if (b) {
        setBand(b);
        setMessage(`Target zone set to ${b.low} to ${b.high} dB, a little above your normal speaking voice.`);
      } else {
        setMessage("I couldn't hear enough speech. Move closer to the microphone and try again.");
      }
      return;
    }
    const s = summariseFrames(recorded, bandRef.current, FRAME_MS);
    if (s.meanDb <= SILENCE_DB) {
      setMessage("I didn't hear your voice. Check the microphone is on and try moving a little closer.");
      return;
    }
    const entry: LogEntry = {
      id: makeId(),
      time: Date.now(),
      exercise: kind,
      seconds: Math.round(s.seconds),
      meanDb: Math.round(s.meanDb),
      inBandPct: Math.round(s.inBandShare * 100),
      longestHoldSec: Math.round(s.longestHoldSec * 10) / 10,
    };
    setLog((prev) => [...prev, entry]);
    setMessage(
      kind === "ahh"
        ? `Longest steady hold in the zone: ${entry.longestHoldSec} s. ${entry.inBandPct}% of your voice was in the zone.`
        : `${entry.inBandPct}% of your reading was in the target zone (average ${entry.meanDb} dB).`,
    );
  };

  const nudgeBand = (delta: number) =>
    setBand((b) => {
      const high = Math.min(-2, Math.max(METER_FLOOR + 14, b.high + delta));
      return { low: high - (b.high - b.low), high };
    });

  const zone = zoneOf(level, band);
  const pct = (db: number) => `${meterFraction(db, METER_FLOOR) * 100}%`;
  const live = status === "live";

  return (
    <Page
      title="Voice Meter"
      intro={
        <p>
          Speaking with more effort than feels natural is a common goal in voice practice for Parkinson's. This meter shows
          how loud your voice is reaching the microphone, with a target zone to aim for. Rest if your voice or throat feels
          strained, and follow any advice from your speech and language therapist.
        </p>
      }
    >
      <div className="sr-only" aria-live="polite">
        {live ? spokenZone : ""}
      </div>

      {!live && (
        <div className="card stack">
          {status === "denied" && (
            <p className="alert" role="alert">
              Microphone access was blocked. To use the meter, allow the microphone for this site in your browser's address
              bar or site settings, then press the button again. The other apps work without it.
            </p>
          )}
          {status === "nomic" && (
            <p className="alert" role="alert">No microphone was found. Plug one in or check your device's sound settings.</p>
          )}
          {status === "unsupported" && (
            <p className="alert" role="alert">
              This browser can't use the microphone here. It needs a secure (https) page or localhost, in a recent browser.
            </p>
          )}
          {status === "error" && (
            <p className="alert" role="alert">Something went wrong starting the microphone. Please try again.</p>
          )}
          <p>The sound is measured on this device only. Nothing is recorded or sent anywhere.</p>
          <TremorButton onPress={startMic} disabled={status === "requesting"}>
            {status === "requesting" ? "Waiting for permission…" : "Turn on microphone"}
          </TremorButton>
        </div>
      )}

      {live && (
        <>
          <div className="meter-wrap">
            <div
              className={`meter zone-${zone}`}
              role="meter"
              aria-label="Voice loudness"
              aria-valuemin={METER_FLOOR}
              aria-valuemax={0}
              aria-valuenow={Math.round(Math.max(METER_FLOOR, level))}
              aria-valuetext={`${Math.round(level)} decibels. ${ZONE_TEXT[zone]}`}
            >
              <div className="meter-band" style={{ left: pct(band.low), width: `calc(${pct(band.high)} - ${pct(band.low)})` }}>
                <span>Target</span>
              </div>
              <div className="meter-fill" style={{ width: pct(level) }} />
            </div>
            <p className={`zone-label zone-${zone}`} aria-hidden="true">
              {level > -55 ? ZONE_TEXT[zone] : "Listening…"} <span className="muted">({Math.round(level)} dB)</span>
            </p>
          </div>

          {running ? (
            <div className="card stack" role="status">
              <p className="prompt">
                {running === "ahh" && "Take a breath and say a long, strong “ahh”."}
                {running === "sentence" && <>Read aloud, strongly: <q className="read-sentence">{SENTENCES[sentence]}</q></>}
                {running === "calibrate" && "Talk in your normal, everyday voice: say your name, what day it is, what you had for breakfast…"}
              </p>
              <p className="countdown">{remaining} s</p>
              <TremorButton variant="secondary" onPress={() => endExercise(running)}>Stop early</TremorButton>
            </div>
          ) : (
            <div className="exercise-grid">
              <section className="card stack" aria-labelledby="ahh-h">
                <h2 id="ahh-h">Hold an “ahh”</h2>
                <p>Keep the meter in the target zone for as long as you comfortably can.</p>
                <fieldset className="choice-group">
                  <legend>Length</legend>
                  {[5, 10, 15].map((n) => (
                    <label key={n} className="choice">
                      <input type="radio" name="hold" checked={holdSecs === n} onChange={() => setHoldSecs(n)} />
                      <span>{n} s</span>
                    </label>
                  ))}
                </fieldset>
                <TremorButton onPress={() => runExercise("ahh", holdSecs * 1000)}>Start “ahh”</TremorButton>
              </section>

              <section className="card stack" aria-labelledby="read-h">
                <h2 id="read-h">Read a sentence</h2>
                <p className="read-sentence">{SENTENCES[sentence]}</p>
                <div className="button-row">
                  <TremorButton onPress={() => runExercise("sentence", 10_000)}>Start reading</TremorButton>
                  <TremorButton variant="secondary" onPress={() => setSentence((i) => (i + 1) % SENTENCES.length)}>
                    Another sentence
                  </TremorButton>
                </div>
              </section>

              <section className="card stack" aria-labelledby="zone-h">
                <h2 id="zone-h">Target zone</h2>
                <p>
                  Now {band.low} to {band.high} dB. These numbers are relative to your microphone, so they can't be compared
                  between devices.
                </p>
                <TremorButton onPress={() => runExercise("calibrate", CALIBRATE_MS)}>Set from my normal voice</TremorButton>
                <div className="button-row">
                  <TremorButton variant="secondary" onPress={() => nudgeBand(-2)} aria-label="Lower the target zone by 2 dB">
                    Lower
                  </TremorButton>
                  <TremorButton variant="secondary" onPress={() => nudgeBand(2)} aria-label="Raise the target zone by 2 dB">
                    Raise
                  </TremorButton>
                </div>
              </section>
            </div>
          )}

          {message && (
            <p className="result-message" role="status">
              {message}
            </p>
          )}
          <TremorButton variant="secondary" onPress={stopMic}>Turn off microphone</TremorButton>
        </>
      )}

      {log.length > 0 && (
        <section aria-labelledby="log-h">
          <h2 id="log-h">Practice log</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">When</th><th scope="col">Exercise</th><th scope="col">In zone</th><th scope="col">Longest hold</th><th scope="col">Average</th></tr>
              </thead>
              <tbody>
                {[...log].reverse().slice(0, 30).map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.time).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{e.exercise === "ahh" ? "“Ahh”" : "Reading"}</td>
                    <td>{e.inBandPct}%</td>
                    <td>{e.longestHoldSec} s</td>
                    <td>{e.meanDb} dB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TremorButton
            variant="danger"
            onPress={() => {
              if (window.confirm("Delete the voice practice log on this device?")) setLog([]);
            }}
          >
            Delete practice log
          </TremorButton>
        </section>
      )}
    </Page>
  );
}
