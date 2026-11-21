import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { useResearch } from "../hooks/useResearch";
import { buildCitationEntries } from "../lib/citations";
import { formatCost } from "../lib/format";
import type { Effort } from "../lib/types";
import { ActivityTimeline } from "./ActivityTimeline";
import { CitationList } from "./CitationList";
import { Markdown } from "./Markdown";

const EXAMPLES = [
  "What is the evidence that aerobic exercise slows Parkinson's progression?",
  "Are there recruiting trials for young-onset Parkinson's?",
  "How does young-onset Parkinson's differ from late-onset?",
];

const EFFORTS: { value: Effort; label: string; hint: string }[] = [
  { value: "low", label: "Quick", hint: "Fewer searches, faster and cheaper" },
  { value: "medium", label: "Balanced", hint: "A good default" },
  { value: "high", label: "Thorough", hint: "More searches, slower" },
];

export function AskView({ headingRef }: { headingRef?: Ref<HTMLHeadingElement> }) {
  const { state, start, cancel } = useResearch();
  const [question, setQuestion] = useState("");
  const [effort, setEffort] = useState<Effort>("medium");
  const answerRef = useRef<HTMLElement>(null);
  const running = state.phase === "running";

  const entries = useMemo(
    () => (state.answer ? buildCitationEntries(state.answer, state.citations ?? []) : []),
    [state.answer, state.citations],
  );
  const entryMap = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  // When the answer lands, bring it into view (gently, unless motion is reduced).
  const hasAnswer = state.answer !== null;
  useEffect(() => {
    if (!hasAnswer || !answerRef.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    answerRef.current.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [hasAnswer, state.runId]);

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || running) return;
    start(q, effort);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(question);
  };

  // Enter sends, Shift+Enter adds a new line (the usual chat convention).
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(question);
    }
  };

  return (
    <section aria-labelledby="ask-heading">
      <h2 id="ask-heading" ref={headingRef} tabIndex={-1} className="view-title">
        Ask a research question
      </h2>
      <p className="view-intro">
        The agent searches PubMed, ClinicalTrials.gov and Europe PMC, reads what it finds, and
        answers with a citation for every claim.
      </p>

      <form className="ask-form card" onSubmit={onSubmit}>
        <label htmlFor="question" className="field-label">
          Your question
        </label>
        <textarea
          id="question"
          name="question"
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="For example: what helps with freezing of gait?"
          aria-describedby="question-hint"
          disabled={running}
        />
        <p id="question-hint" className="field-hint">
          Press Enter to ask, Shift + Enter for a new line.
        </p>

        <div className="examples" role="group" aria-label="Example questions">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              disabled={running}
              onClick={() => {
                setQuestion(example);
                ask(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>

        <div className="ask-form__footer">
          <fieldset className="effort" disabled={running}>
            <legend className="field-label">Effort</legend>
            <div className="segmented">
              {EFFORTS.map((option) => (
                <label key={option.value} className="segmented__option" title={option.hint}>
                  <input
                    type="radio"
                    name="effort"
                    value={option.value}
                    checked={effort === option.value}
                    onChange={() => setEffort(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {running ? (
            <button type="button" className="button button--secondary" onClick={cancel}>
              Stop
            </button>
          ) : (
            <button type="submit" className="button" disabled={!question.trim()}>
              Research
            </button>
          )}
        </div>
      </form>

      {/* Screen readers hear each new status line; sighted users see it too. */}
      <p className="status-line" role="status" aria-live="polite">
        {running && <span className="spinner" aria-hidden="true" />}
        {state.status}
      </p>

      {state.error && (
        <div className="banner banner--danger" role="alert">
          {state.error}
        </div>
      )}

      <ActivityTimeline
        key={state.runId}
        items={state.timeline}
        running={running}
        answerReady={hasAnswer}
      />

      {state.answer !== null && (
        <article className="answer card" ref={answerRef} aria-labelledby="answer-heading">
          <h3 id="answer-heading" className="answer__question">
            {state.question}
          </h3>
          <Markdown citations={entryMap}>{state.answer}</Markdown>

          {state.citations === null && running && (
            <p className="field-hint">Checking that every cited source exists…</p>
          )}
          <CitationList entries={entries} />

          {state.usage && (
            <p className="usage">
              {state.usage.summary}
              {state.usage.summary ? " · " : ""}
              Cost {formatCost(state.usage.costUsd)}
            </p>
          )}
        </article>
      )}
    </section>
  );
}
