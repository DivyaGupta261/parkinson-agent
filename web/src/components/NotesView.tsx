import { useEffect, useState, type Ref } from "react";
import { errorMessage, getNotes, isAbort } from "../lib/api";
import { citationLabel, citationUrl, normalizeCitationId } from "../lib/citations";
import { formatDateTime } from "../lib/format";
import type { Note } from "../lib/types";
import { Markdown } from "./Markdown";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; notes: Note[] }
  | { kind: "error"; message: string };

function Source({ source }: { source: string }) {
  const id = normalizeCitationId(source);
  if (id) {
    return (
      <a href={citationUrl(id)} target="_blank" rel="noreferrer">
        {citationLabel(id)}
      </a>
    );
  }
  if (/^https?:\/\//i.test(source)) {
    return (
      <a href={source} target="_blank" rel="noreferrer">
        {source}
      </a>
    );
  }
  return <>{source}</>;
}

function NoteCard({ note }: { note: Note }) {
  return (
    <article className="note card" aria-labelledby={`note-${note.id}`}>
      <header className="note__header">
        <h3 id={`note-${note.id}`}>{note.title}</h3>
        <p className="note__meta">
          <time dateTime={note.created_at}>{formatDateTime(note.created_at)}</time>
        </p>
        {note.tags.length > 0 && (
          <ul className="tags" aria-label="Tags">
            {note.tags.map((tag) => (
              <li key={tag} className="tag">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </header>
      <Markdown>{note.content}</Markdown>
      {note.sources.length > 0 && (
        <div className="note__sources">
          <h4>Sources</h4>
          <ul>
            {note.sources.map((source) => (
              <li key={source}>
                <Source source={source} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function NotesView({ headingRef }: { headingRef: Ref<HTMLHeadingElement> }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    getNotes(debounced, controller.signal)
      .then((notes) => setLoad({ kind: "ready", notes }))
      .catch((err: unknown) => {
        if (!isAbort(err)) setLoad({ kind: "error", message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [debounced, attempt]);

  let resultText = "";
  if (load.kind === "ready") {
    const n = load.notes.length;
    resultText = debounced
      ? `${n} ${n === 1 ? "note matches" : "notes match"} “${debounced}”.`
      : `${n} ${n === 1 ? "note" : "notes"}.`;
  }

  return (
    <section aria-labelledby="notes-heading">
      <h2 id="notes-heading" ref={headingRef} tabIndex={-1} className="view-title">
        Notes
      </h2>
      <p className="view-intro">
        Findings the agent saved to its memory. They stay on this computer.
      </p>

      <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="notes-search" className="field-label">
          Search notes
        </label>
        <input
          id="notes-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. exercise, LRRK2, sleep"
          autoComplete="off"
        />
      </form>

      <p className="status-line" role="status" aria-live="polite">
        {load.kind === "loading" ? "Loading notes…" : resultText}
      </p>

      {load.kind === "error" && (
        <div className="banner banner--warning" role="alert">
          <p>{load.message}</p>
          <button type="button" className="button button--secondary" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}

      {load.kind === "ready" && load.notes.length === 0 && (
        <p className="empty">
          {debounced
            ? "No notes match that search."
            : "No notes yet. When you ask the agent to remember something, it appears here."}
        </p>
      )}

      {load.kind === "ready" && (
        <div className="note-list">
          {load.notes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </section>
  );
}
