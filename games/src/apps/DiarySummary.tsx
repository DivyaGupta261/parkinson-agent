import { useEffect, useState } from "react";
import { Page } from "../components/Page";
import { TremorButton } from "../components/TremorButton";
import { DayTimeline, StateLegend, stateShort, useDiaryEntries } from "../components/DayTimeline";
import { MAX_SPAN_MS, formatHours, summariseDays } from "../lib/diary";
import { load, save } from "../lib/storage";

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * A one-page, printable summary of the last 7 days. The print styles in
 * styles.css (@media print) hide the app chrome and buttons, switch to black
 * on white, and keep each section from splitting across pages.
 */
export function DiarySummary() {
  const [entries] = useDiaryEntries();
  const [questions, setQuestions] = useState(() => load("diary-questions", ""));
  useEffect(() => {
    save("diary-questions", questions);
  }, [questions]);

  const now = Date.now();
  const s = summariseDays(entries, now, 7);
  const notes = entries.filter((e) => e.time >= s.from && e.time <= now && e.notes.trim());

  return (
    <Page title="Summary for my neurologist">
      <div className="no-print button-row">
        <TremorButton onPress={() => window.print()}>Print or save as PDF</TremorButton>
        <a className="btn btn-secondary" href="#/diary">Back to diary</a>
      </div>

      <p className="summary-meta">
        {fmtDate(s.from)} to {fmtDate(now)} · {s.entryCount} diary entries · Printed {fmtDateTime(now)}
      </p>

      {s.entryCount === 0 ? (
        <p>No diary entries in the last 7 days yet.</p>
      ) : (
        <>
          <section className="summary-section" aria-labelledby="split-h">
            <h2 id="split-h">Recorded awake time</h2>
            <dl className="stats big-stats">
              <div><dt>ON</dt><dd>{s.percentages.on}%</dd></div>
              <div><dt>OFF</dt><dd>{s.percentages.off}%</dd></div>
              <div><dt>ON with troublesome dyskinesia</dt><dd>{s.percentages.dyskinesia}%</dd></div>
              <div><dt>Awake time recorded</dt><dd>{formatHours(s.percentages.awakeMs)}</dd></div>
              <div><dt>Sleep recorded</dt><dd>{formatHours(s.totals.asleep)}</dd></div>
            </dl>
          </section>

          <section className="summary-section" aria-labelledby="days-h">
            <h2 id="days-h">Day by day</h2>
            <div className="table-wrap">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">ON</th>
                    <th scope="col">OFF</th>
                    <th scope="col">Dysk.</th>
                    <th scope="col">Asleep</th>
                    <th scope="col" className="timeline-col">Timeline (00:00 to 24:00)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.days.map((d) => (
                    <tr key={d.dayStart}>
                      <th scope="row">{fmtDate(d.dayStart)}</th>
                      <td>{formatHours(d.totals.on)}</td>
                      <td>{formatHours(d.totals.off)}</td>
                      <td>{formatHours(d.totals.dyskinesia)}</td>
                      <td>{formatHours(d.totals.asleep)}</td>
                      <td className="timeline-col">
                        <DayTimeline entries={entries} dayStart={d.dayStart} now={now} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mobile-timelines" aria-hidden="true">
              {s.days.map((d) => (
                <li key={d.dayStart}>
                  <strong>{fmtDate(d.dayStart)}</strong>
                  <DayTimeline entries={entries} dayStart={d.dayStart} now={now} compact />
                </li>
              ))}
            </ul>
            <StateLegend />
          </section>

          <section className="summary-section" aria-labelledby="meds-h">
            <h2 id="meds-h">Medication noted</h2>
            {s.medications.length === 0 ? (
              <p>None noted.</p>
            ) : (
              <ul className="compact-list med-list">
                {s.medications.map((m, i) => (
                  <li key={i}>
                    {fmtDateTime(m.time)}: {m.medication}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="summary-section" aria-labelledby="symptoms-h">
            <h2 id="symptoms-h">Symptoms and mood</h2>
            <ul className="compact-list">
              <li>Entries with moderate or severe tremor: {s.moderateOrWorse.tremor}</li>
              <li>Entries with moderate or severe stiffness: {s.moderateOrWorse.stiffness}</li>
              <li>Entries with low mood: {s.lowMoodCount}</li>
            </ul>
            {notes.length > 0 && (
              <>
                <h3>Notes</h3>
                <ul className="compact-list">
                  {notes.slice(-8).map((e) => (
                    <li key={e.id}>
                      {fmtDateTime(e.time)} ({stateShort(e.state)}): {e.notes.length > 160 ? `${e.notes.slice(0, 160)}…` : e.notes}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}

      <section className="summary-section" aria-labelledby="q-h">
        <h2 id="q-h">Questions I want to ask</h2>
        <label className="field no-print">
          <span className="sr-only">Questions I want to ask</span>
          <textarea rows={4} value={questions} onChange={(e) => setQuestions(e.target.value)} maxLength={1500} />
        </label>
        <p className="print-only questions-print">{questions || " "}</p>
      </section>

      <p className="summary-method">
        How this is calculated: each diary entry counts from its time until the next entry, for at most{" "}
        {MAX_SPAN_MS / 3_600_000} hours. Percentages are of recorded awake time. This is a self-recorded diary to support a
        conversation with my care team. It is not a diagnosis or a medical record.
      </p>
    </Page>
  );
}
