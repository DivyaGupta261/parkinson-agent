import { useCallback, useEffect, useReducer, useRef } from "react";
import { initialResearchState, researchReducer } from "../lib/research";
import { openResearchStream } from "../lib/stream";
import type { Effort } from "../lib/types";

/** Runs one research question at a time and exposes its live state. */
export function useResearch() {
  const [state, dispatch] = useReducer(researchReducer, initialResearchState);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const start = useCallback(
    (question: string, effort: Effort) => {
      stop();
      dispatch({ type: "start", question, effort });
      stopRef.current = openResearchStream(
        question,
        effort,
        (event) => dispatch({ type: "event", event }),
        () => dispatch({ type: "connection-lost" }),
      );
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    dispatch({ type: "cancel" });
  }, [stop]);

  // Close the stream if the component goes away mid-run.
  useEffect(() => stop, [stop]);

  return { state, start, cancel };
}
