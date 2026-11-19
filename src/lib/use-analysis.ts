"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { createAnalysisClient, type AnalysisClient } from "./analysis-client";
import { analysisReducer, initialAnalysisState } from "./analysis-state";
import type { AnalysisRequest } from "./domain";

export function useAnalysis(input: Omit<AnalysisRequest, "revision"> | null) {
  const [state, dispatch] = useReducer(analysisReducer, initialAnalysisState);
  const clientRef = useRef<AnalysisClient | null>(null);
  const revisionRef = useRef(0);
  const inputKey = input === null ? null : JSON.stringify(input);

  useEffect(() => {
    const client = createAnalysisClient({
      createWorker: () => new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), { type: "module" }),
      nextRevision: () => ++revisionRef.current,
      onEvent: dispatch,
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    clientRef.current?.setInput(inputKey);
  }, [inputKey]);

  const retry = useCallback(() => clientRef.current?.retry(), []);

  if (inputKey === null) return { result: null, busy: false, error: null, retry };
  return {
    result: state.result,
    busy: state.busy || state.inputKey !== inputKey,
    error: state.inputKey === inputKey ? state.error : null,
    retry,
  };
}
