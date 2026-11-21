import { useEffect, useRef, useState, type Ref } from "react";
import { routeHref } from "../hooks/useHashRoute";
import { errorMessage, getDigest, getDigests, isAbort } from "../lib/api";
import { formatDigestDate } from "../lib/format";
import type { Digest, DigestSummary } from "../lib/types";
import { Markdown } from "./Markdown";

type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; message: string };

interface DigestsViewProps {
  headingRef: Ref<HTMLHeadingElement>;
  /** The date in the URL (#/digests/2026-11-19), if any. */
  selectedDate: string | null;
}

export function DigestsView({ headingRef, selectedDate }: DigestsViewProps) {
  const [list, setList] = useState<Load<DigestSummary[]>>({ kind: "loading" });
  const [digest, setDigest] = useState<Load<Digest> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const articleRef = useRef<HTMLElement>(null);
  const userPicked = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setList({ kind: "loading" });
    getDigests(controller.signal)
      .then((value) => setList({ kind: "ready", value }))
      .catch((err: unknown) => {
        if (!isAbort(err)) setList({ kind: "error", message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [attempt]);

  // The newest digest is shown until the reader picks another.
  const digests = list.kind === "ready" ? list.value : [];
  const date = selectedDate ?? digests[0]?.date ?? null;

  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    setDigest({ kind: "loading" });
    getDigest(date, controller.signal)
      .then((value) => setDigest({ kind: "ready", value }))
      .catch((err: unknown) => {
        if (!isAbort(err)) setDigest({ kind: "error", message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [date, attempt]);

  // After picking a digest (on a phone the list sits above it), move focus to it.
  useEffect(() => {
    if (digest?.kind === "ready" && userPicked.current) {
      userPicked.current = false;
      articleRef.current?.focus();
    }
  }, [digest]);

  return (
    <section aria-labelledby="digests-heading">
      <h2 id="digests-heading" ref={headingRef} tabIndex={-1} className="view-title">
        Digests
      </h2>
      <p className="view-intro">Weekly summaries of new Parkinson's research.</p>

      {list.kind === "loading" && (
        <p className="status-line" role="status">
          Loading digests…
        </p>
      )}

      {list.kind === "error" && (
        <div className="banner banner--warning" role="alert">
          <p>{list.message}</p>
          <button type="button" className="button button--secondary" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}

      {list.kind === "ready" && digests.length === 0 && (
        <p className="empty">No digests yet. The weekly digest workflow writes them here.</p>
      )}

      {digests.length > 0 && (
        <div className="digests">
          <nav className="digests__nav" aria-label="Digest list">
            <ul>
              {digests.map((d) => (
                <li key={d.date}>
                  <a
                    href={routeHref("digests", d.date)}
                    className="digests__link"
                    aria-current={d.date === date ? "page" : undefined}
                    onClick={() => {
                      userPicked.current = true;
                    }}
                  >
                    <span className="digests__title">{d.title}</span>
                    <time dateTime={d.date} className="digests__date">
                      {formatDigestDate(d.date)}
                    </time>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <article
            className="digests__content card"
            ref={articleRef}
            tabIndex={-1}
            aria-busy={digest?.kind === "loading"}
            aria-label={date ? `Digest for ${formatDigestDate(date)}` : "Digest"}
          >
            {digest?.kind === "loading" && <p className="status-line">Loading…</p>}
            {digest?.kind === "error" && (
              <p className="banner banner--warning" role="alert">
                {digest.message}
              </p>
            )}
            {digest?.kind === "ready" && (
              <>
                <p className="digests__content-date">{formatDigestDate(digest.value.date)}</p>
                <Markdown>{digest.value.markdown}</Markdown>
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
