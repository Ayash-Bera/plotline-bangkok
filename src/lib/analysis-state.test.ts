import { describe, expect, it } from "vitest";
import { analysisReducer, initialAnalysisState } from "./analysis-state";
import type { AnalysisResult } from "./domain";

function result(revision: number): AnalysisResult {
  return {
    revision, status: "ready", plotArea: 1000, buildableArea: 700,
    floorAreaCap: 2500, legalFar: 2.5, legalOsr: 0.125,
    setbacks: { type: "FeatureCollection", features: [] },
    envelope: { type: "FeatureCollection", features: [] },
    concepts: [], checks: [], assumptions: [], calculationMs: 1, zoneId: "ย.3-29",
  };
}

describe("analysis state synchronization", () => {
  it("marks a new request busy while retaining one coherent previous result", () => {
    const previous = result(1);
    const state = { ...initialAnalysisState, revision: 1, inputKey: "first", result: previous };
    const next = analysisReducer(state, { type: "requested", revision: 2, inputKey: "second" });
    expect(next.busy).toBe(true);
    expect(next.result).toBe(previous);
    expect(next.inputKey).toBe("second");
  });

  it("ignores an older calculation that finishes after a newer request", () => {
    const state = { ...initialAnalysisState, revision: 3, inputKey: "newest", busy: true };
    const next = analysisReducer(state, { type: "received", result: result(2) });
    expect(next.revision).toBe(3);
    expect(next.result).toBeNull();
    expect(next.busy).toBe(true);
  });

  it("publishes the matching calculation and clears the pending state", () => {
    const state = { ...initialAnalysisState, revision: 3, inputKey: "newest", busy: true };
    const latest = result(3);
    const next = analysisReducer(state, { type: "received", result: latest });
    expect(next.result).toBe(latest);
    expect(next.busy).toBe(false);
    expect(next.error).toBeNull();
  });

  it("clears obsolete passing geometry when the latest calculation fails", () => {
    const state = { ...initialAnalysisState, revision: 3, inputKey: "newest", result: result(2), busy: true };
    const next = analysisReducer(state, { type: "failed", revision: 3, error: "Invalid plot" });
    expect(next.result).toBeNull();
    expect(next.error).toBe("Invalid plot");
    expect(next.busy).toBe(false);
  });

  it("clears drawing results without allowing a previous reply to restore them", () => {
    const state = { ...initialAnalysisState, revision: 3, inputKey: "old", result: result(3) };
    const reset = analysisReducer(state, { type: "cleared", revision: 4 });
    const next = analysisReducer(reset, { type: "received", result: result(3) });
    expect(next.result).toBeNull();
    expect(next.inputKey).toBeNull();
    expect(next.revision).toBe(4);
  });
});
