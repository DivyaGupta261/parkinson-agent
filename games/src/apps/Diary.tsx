import { useRef, useState, type FormEvent } from "react";
import { Page } from "../components/Page";
import { TremorButton } from "../components/TremorButton";
import { DayTimeline, StateLegend, stateShort, useDiaryEntries } from "../components/DayTimeline";
import {
  STATES,
  makeExport,
  mergeEntries,
  parseImport,
  startOfDay,
  type DiaryEntry,
  type DiaryState,
  type Level,
  type Mood,
} from "../lib/diary";
import { makeId } from "../lib/storage";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DDTHH:MM" in local time, the format <input type="datetime-local"> wants. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

const LEVELS: { value: Level; label: string }[] = [
  { value: "", label: "Not noted" },
  { value: "none", label: "None" },
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
];

const QUICK: { state: DiaryState; label: string }[] = [
  { state: "on", label: "I'm ON now" },
  { state: "off", label: "I'm OFF now" },
  { state: "dyskinesia", label: "Troublesome dyskinesia now" },
  { state: "asleep", label: "Going to sleep" },
];

function blankForm() {
  return {
    time: toLocalInput(Date.now()),
    state: "on" as DiaryState,
    medication: "",
    tremor: "" as Level,
    stiffness: "" as Level,
    mood: "" as Mood,
    sleep: "",
    notes: "",
  };
}

export function Diary() {
  const [entries, setEntries] = useDiaryEntries();
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [form, setForm] = useState(blankForm);
  const [status, setStatus] = useState("");
  const [undoId, setUndoId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const add = (entry: DiaryEntry, message: string) => {
    setEntries((prev) => [...prev, entry].sort((a, b) => a.time - b.time));
    setUndoId(entry.id);
    setStatus(message);
  };

  const quickLog = (state: DiaryState) => {
    const now = Date.now();
    add(
      { id: makeId(), time: now, state, medication: "", tremor: "", stiffness: "", mood: "", sleep: "", notes: "" },
      `Saved: ${stateShort(state)} at ${fmtTime(now)}.`,
    );
    setDay(startOfDay(now));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const time = new Date(form.time).getTime();
    if (!Number.isFinite(time)) {
      setStatus("Please enter a valid date and time.");
      return;
    }
    add({ id: makeId(), ...form, time }, `Saved: ${stateShort(form.state)} at ${fmtTime(time)}.`);
    setDay(startOfDay(time));
    setForm(blankForm());
  };

  const undo = () => {
    if (!undoId) return;
    setEntries((prev) => prev.filter((e) => e.id !== undoId));
    setUndoId(null);
    setStatus("Entry removed.");
  };

  const remove = (entry: DiaryEntry) => {
    if (!window.confirm(`Delete the ${stateShort(entry.state)} entry at ${fmtTime(entry.time)}?`)) return;
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    setStatus("Entry deleted.");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(makeExport(entries), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `on-off-diary-${toLocalInput(Date.now()).slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${entries.length} entries.`);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { entries: incoming, skipped } = parseImport(await file.text());
      setEntries((prev) => mergeEntries(prev, incoming));
      setStatus(`Imported ${incoming.length} entries${skipped ? `, skipped ${skipped} that didn't look right` : ""}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const dayEnd = startOfDay(day + DAY_MS * 1.5);
  const dayEntries = entries.filter((e) => e.time >= day && e.time < dayEnd);
  const isToday = day === startOfDay(Date.now());

  return (
    <Page
      title="ON/OFF Diary"
      intro={
        <p>
          Note how you are through the day. Each entry counts until your next one (for up to 3 hours), which builds a
          picture of your ON and OFF time to share with your neurologist.
        </p>
      }
    >
      <p className="status-message" role="status">
        {status}
        {undoId && status.startsWith("Saved") && (
          <>
            {" "}
            <TremorButton variant="secondary" className="btn-small" onPress={undo}>
              Undo
            </TremorButton>
          </>
        )}
      </p>

      <section className="card stack" aria-labelledby="quick-h">
        <h2 id="quick-h">Quick log, right now</h2>
        <div className="quick-grid">
          {QUICK.map((q) => (
            <TremorButton key={q.state} variant="plain" className={`quick-btn quick-${q.state}`} onPress={() => quickLog(q.state)}>
              <span className={`swatch state-${q.state}`} aria-hidden="true" />
              {q.label}
            </TremorButton>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="day-h">
        <h2 id="day-h">{isToday ? "Today" : fmtDay(day)}</h2>
        <div className="button-row">
          <TremorButton variant="secondary" onPress={() => setDay(startOfDay(day - DAY_MS / 2))}>
            <span aria-hidden="true">←</span> Previous day
          </TremorButton>
          <TremorButton variant="secondary" onPress={() => setDay(startOfDay(Date.now()))} disabled={isToday}>
            Today
          </TremorButton>
          <TremorButton variant="secondary" onPress={() => setDay(dayEnd)} disabled={isToday}>
            Next day <span aria-hidden="true">→</span>
          </TremorButton>
        </div>
        <DayTimeline entries={entries} dayStart={day} />
        <StateLegend />
        {dayEntries.length === 0 ? (
          <p className="muted">No entries for this day.</p>
        ) : (
          <ol className="entry-list">
            {dayEntries.map((e) => (
              <li key={e.id} className="entry">
                <div>
                  <strong>{fmtTime(e.time)}</strong> <span className={`swatch state-${e.state}`} aria-hidden="true" />{" "}
                  {stateShort(e.state)}
                  {e.medication && <> · Medication: {e.medication}</>}
                  {(e.tremor || e.stiffness || e.mood || e.sleep || e.notes) && (
                    <div className="muted">
                      {[
                        e.tremor && `tremor ${e.tremor}`,
                        e.stiffness && `stiffness ${e.stiffness}`,
                        e.mood && `mood ${e.mood}`,
                        e.sleep && `sleep: ${e.sleep}`,
                        e.notes,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </div>
                <TremorButton variant="secondary" className="btn-small" onPress={() => remove(e)} aria-label={`Delete ${stateShort(e.state)} entry at ${fmtTime(e.time)}`}>
                  Delete
                </TremorButton>
              </li>
            ))}
          </ol>
        )}
      </section>

      <form className="card stack" onSubmit={submit} aria-labelledby="form-h">
        <h2 id="form-h">Add a detailed entry</h2>
        <label className="field">
          <span>Time</span>
          <input type="datetime-local" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
        </label>
        <fieldset className="choice-group state-choices">
          <legend>How are you?</legend>
          {STATES.map((s) => (
            <label key={s.value} className="choice">
              <input type="radio" name="state" value={s.value} checked={form.state === s.value} onChange={() => setForm({ ...form, state: s.value })} />
              <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Medication taken (optional)</span>
          <input type="text" value={form.medication} maxLength={200} placeholder="Name and dose, as you'd write it" onChange={(e) => setForm({ ...form, medication: e.target.value })} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Tremor</span>
            <select value={form.tremor} onChange={(e) => setForm({ ...form, tremor: e.target.value as Level })}>
              {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Stiffness</span>
            <select value={form.stiffness} onChange={(e) => setForm({ ...form, stiffness: e.target.value as Level })}>
              {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Mood</span>
            <select value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value as Mood })}>
              <option value="">Not noted</option>
              <option value="good">Good</option>
              <option value="okay">Okay</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Sleep (optional)</span>
          <input type="text" value={form.sleep} maxLength={200} placeholder="For example: about 6 hours, woke twice" onChange={(e) => setForm({ ...form, sleep: e.target.value })} />
        </label>
        <label className="field">
          <span>Notes (optional)</span>
          <textarea rows={3} value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <button type="submit" className="btn btn-primary">Save entry</button>
      </form>

      <section className="card stack" aria-labelledby="share-h">
        <h2 id="share-h">Share and back up</h2>
        <a className="btn btn-primary" href="#/diary/summary">Summary for my neurologist</a>
        <div className="button-row">
          <TremorButton variant="secondary" onPress={exportJson} disabled={entries.length === 0}>
            Export (JSON file)
          </TremorButton>
          <TremorButton variant="secondary" onPress={() => fileInput.current?.click()}>
            Import (JSON file)
          </TremorButton>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void importJson(e.target.files?.[0])}
          />
        </div>
        <p className="muted">
          Your diary is stored only in this browser. Export it now and then as a backup, or to move it to another device.
          Importing adds entries to what's already here.
        </p>
      </section>
    </Page>
  );
}
