import { useEffect, useState } from "react";
import { toolInputSummary, toolLabel } from "../lib/format";
import type { TimelineItem } from "../lib/research";

const LONG_THOUGHT = 280;

function Thought({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > LONG_THOUGHT;
  const shown = long && !expanded ? `${text.slice(0, LONG_THOUGHT).trimEnd()}…` : text;
  return (
    <>
      <p className="timeline__thought">{shown}</p>
      {long && (
        <button
          type="button"
          className="link-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

function Item({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "tool": {
      const detail = toolInputSummary(item.input);
      return (
        <li className="timeline__item timeline__item--tool">
          <span className="timeline__label">{toolLabel(item.name)}</span>
          {detail && <span className="timeline__detail">{detail}</span>}
        </li>
      );
    }
    case "thinking":
      return (
        <li className="timeline__item timeline__item--thinking">
          <span className="timeline__label">Thinking</span>
          <Thought text={item.text} />
        </li>
      );
    case "status":
      return (
        <li className="timeline__item timeline__item--status">
          <span className="timeline__detail">{item.message}</span>
        </li>
      );
  }
}

interface ActivityTimelineProps {
  items: TimelineItem[];
  running: boolean;
  /** Collapse automatically once the answer is in, so it takes centre stage. */
  answerReady: boolean;
}

export function ActivityTimeline({ items, running, answerReady }: ActivityTimelineProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (answerReady) setOpen(false);
  }, [answerReady]);

  if (items.length === 0) return null;
  const toolCount = items.filter((i) => i.kind === "tool").length;

  return (
    <details
      className="timeline"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="timeline__summary-title">Agent activity</span>
        <span className="timeline__summary-count">
          {toolCount} {toolCount === 1 ? "tool call" : "tool calls"}
          {running ? ", in progress" : ""}
        </span>
      </summary>
      <ol className="timeline__list">
        {items.map((item, i) => (
          <Item key={i} item={item} />
        ))}
      </ol>
    </details>
  );
}
