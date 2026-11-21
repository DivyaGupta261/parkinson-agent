import { useCallback, useEffect, useRef, useState } from "react";
import { AskView } from "./components/AskView";
import { DigestsView } from "./components/DigestsView";
import { NotesView } from "./components/NotesView";
import { routeHref, useHashRoute, type View } from "./hooks/useHashRoute";
import { errorMessage, getHealth } from "./lib/api";

type HealthState =
  | { kind: "checking" }
  | { kind: "ok"; demo: boolean }
  | { kind: "down"; message: string };

const TABS: { view: View; label: string }[] = [
  { view: "ask", label: "Ask" },
  { view: "notes", label: "Notes" },
  { view: "digests", label: "Digests" },
];

export function App() {
  const route = useHashRoute();
  const [health, setHealth] = useState<HealthState>({ kind: "checking" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const checkHealth = useCallback(() => {
    setHealth({ kind: "checking" });
    getHealth()
      .then((h) => setHealth({ kind: "ok", demo: h.demo }))
      .catch((err: unknown) => setHealth({ kind: "down", message: errorMessage(err) }));
  }, []);

  useEffect(checkHealth, [checkHealth]);

  // When the view changes, move focus to its heading so keyboard and
  // screen-reader users land at the start of the new content.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [route.view]);

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // Focus <main> directly; following "#main" would change the route hash.
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>

      <header className="site-header">
        <div className="container site-header__inner">
          <h1 className="brand">
            <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="8" />
              <path d="M9 21c2.5-6 4.5-10 7-10s4.5 4 7 10" />
              <circle cx="16" cy="11" r="2.2" />
            </svg>
            <span>Parkinson's Research Agent</span>
          </h1>
          <nav aria-label="Main">
            <ul className="tabs">
              {TABS.map((tab) => (
                <li key={tab.view}>
                  <a
                    className="tab"
                    href={routeHref(tab.view)}
                    aria-current={route.view === tab.view ? "page" : undefined}
                  >
                    {tab.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <div className="container">
        <p className="disclaimer">
          <strong>Education, not medical advice.</strong> Discuss anything actionable with your
          neurologist.
        </p>

        {health.kind === "ok" && health.demo && (
          <p className="banner banner--info">
            <strong>Demo mode: recorded example.</strong> The server has no API key, so it replays a
            recorded research run instead of asking the model live.
          </p>
        )}

        {health.kind === "down" && (
          <div className="banner banner--warning" role="alert">
            <p>
              <strong>The research server isn't reachable.</strong> Start it with{" "}
              <code>uv run pd serve</code>, then try again.
            </p>
            <button type="button" className="button button--secondary" onClick={checkHealth}>
              Try again
            </button>
          </div>
        )}

        <main id="main" tabIndex={-1}>
          {/* Ask stays mounted so a running question keeps streaming while you read notes. */}
          <div hidden={route.view !== "ask"}>
            <AskView headingRef={route.view === "ask" ? headingRef : undefined} />
          </div>
          {route.view === "notes" && <NotesView headingRef={headingRef} />}
          {route.view === "digests" && (
            <DigestsView headingRef={headingRef} selectedDate={route.param} />
          )}
        </main>
      </div>

      <footer className="site-footer">
        <div className="container">
          Answers cite PubMed and ClinicalTrials.gov. Always check the original source.
        </div>
      </footer>
    </>
  );
}
