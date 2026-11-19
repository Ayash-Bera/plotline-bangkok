import type { AnalysisResult } from "./domain";

export interface AnalysisState {
  revision: number;
  inputKey: string | null;
  result: AnalysisResult | null;
  busy: boolean;
  error: string | null;
}

export type AnalysisEvent =
  | { type: "requested"; revision: number; inputKey: string }
  | { type: "received"; result: AnalysisResult }
  | { type: "failed"; revision: number; error: string }
  | { type: "cleared"; revision: number };

export const initialAnalysisState: AnalysisState = {
  revision: 0, inputKey: null, result: null, busy: false, error: null,
};

export function analysisReducer(state: AnalysisState, event: AnalysisEvent): AnalysisState {
  if (event.type === "cleared") {
    return { ...initialAnalysisState, revision: event.revision };
  }
  if (event.type === "requested") {
    if (event.revision < state.revision) return state;
    return { ...state, revision: event.revision, inputKey: event.inputKey, busy: true, error: null };
  }
  const revision = event.type === "received" ? event.result.revision : event.revision;
  if (revision !== state.revision) return state;
  if (event.type === "failed") {
    return { ...state, result: null, busy: false, error: event.error };
  }
  return { ...state, result: event.result, busy: false, error: null };
}
