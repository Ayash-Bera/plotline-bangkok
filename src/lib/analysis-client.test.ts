import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalysisClient, type AnalysisWorker } from "./analysis-client";
import { analysisReducer, initialAnalysisState, type AnalysisEvent } from "./analysis-state";
import type { AnalysisRequest, AnalysisResult, WorkerReply } from "./domain";

class FakeWorker implements AnalysisWorker {
  onmessage: AnalysisWorker["onmessage"] = null;
  onerror: AnalysisWorker["onerror"] = null;
  onmessageerror: AnalysisWorker["onmessageerror"] = null;
  sent: AnalysisRequest[] = [];
  terminated = false;
  postError: Error | null = null;

  postMessage(request: AnalysisRequest) {
    if (this.postError) throw this.postError;
    this.sent.push(request);
  }

  terminate() { this.terminated = true; }
  reply(reply: WorkerReply) { this.onmessage?.({ data: reply } as MessageEvent<WorkerReply>); }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent); }
  unreadable() { this.onmessageerror?.({} as MessageEvent); }
}

function input(width = 20): string {
  return JSON.stringify({
    plot: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[100, 13], [100.001, 13], [100.001, 13.001], [100, 13]]] } },
    road: { id: "road", name: "Road", coordinates: [[100, 13], [100.001, 13]], width, widthEvidence: "scenario", publicRoad: true },
    zone: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[100, 13], [100.001, 13], [100.001, 13.001], [100, 13]]] } },
    buildingType: "condo", storeyHeight: 3.2, heightLimit: 22.7, permeableFraction: 0.6,
  });
}

function result(revision: number): AnalysisResult {
  return {
    revision, status: "ready", plotArea: 1000, buildableArea: 700,
    floorAreaCap: 2500, legalFar: 2.5, legalOsr: 0.125,
    setbacks: { type: "FeatureCollection", features: [] },
    envelope: { type: "FeatureCollection", features: [] },
    concepts: [], checks: [], assumptions: [], calculationMs: 1, zoneId: "study",
  };
}

function harness() {
  let state = initialAnalysisState;
  let revision = 0;
  const workers: FakeWorker[] = [];
  const events: AnalysisEvent[] = [];
  const createWorker = vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const options = {
    createWorker,
    nextRevision: () => ++revision,
    onEvent: (event: AnalysisEvent) => {
      events.push(event);
      state = analysisReducer(state, event);
    },
  };
  return {
    client: createAnalysisClient(options),
    recreate: () => createAnalysisClient(options),
    createWorker, workers, events,
    get state() { return state; },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("analysis worker lifecycle", () => {
  it("debounces startup and recovers identical input after construction failure only on explicit retry", () => {
    const h = harness();
    h.createWorker.mockImplementationOnce(() => { throw new Error("Worker asset unavailable"); });
    h.client.setInput(input());
    vi.advanceTimersByTime(79);
    expect(h.createWorker).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.state.error).toContain("Worker asset unavailable");
    expect(h.state.busy).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(h.createWorker).toHaveBeenCalledTimes(1);

    h.client.retry();
    expect(h.state.revision).toBe(2);
    expect(h.state.busy).toBe(true);
    vi.advanceTimersByTime(80);
    expect(h.createWorker).toHaveBeenCalledTimes(2);
    expect(h.workers[0].sent.map(request => request.revision)).toEqual([2]);
    h.workers[0].reply({ type: "result", result: result(2) });
    expect(h.state.result?.revision).toBe(2);
    expect(h.state.error).toBeNull();
    expect(h.state.busy).toBe(false);
  });

  it("replaces a fatally failed worker and ignores saved old callbacks and old pending work", () => {
    const h = harness();
    h.client.setInput(input());
    vi.advanceTimersByTime(80);
    const old = h.workers[0];
    const oldReply = old.onmessage!;
    const oldError = old.onerror!;
    h.client.setInput(input(21));
    vi.advanceTimersByTime(80);
    old.fail("Worker stopped");
    expect(h.state.revision).toBe(2);
    expect(h.state.error).toContain("Worker stopped");
    expect(old.terminated).toBe(true);
    h.client.retry();
    vi.advanceTimersByTime(80);
    const current = h.workers[1];
    expect(current.sent.map(request => request.revision)).toEqual([3]);
    h.client.setInput(input(22));
    vi.advanceTimersByTime(80);
    oldReply({ data: { type: "result", result: result(4) } } as MessageEvent<WorkerReply>);
    oldError({ message: "Late old error" } as ErrorEvent);
    expect(current.sent.map(request => request.revision)).toEqual([3]);
    expect(h.state.result).toBeNull();
    expect(h.state.error).toBeNull();
    expect(h.state.busy).toBe(true);
    current.reply({ type: "result", result: result(3) });
    expect(current.sent.map(request => request.revision)).toEqual([3, 4]);
    expect(current.sent[1].road.width).toBe(22);
    current.reply({ type: "result", result: result(4) });
    expect(h.state.result?.revision).toBe(4);
    expect(old.sent.map(request => request.revision)).toEqual([1]);
  });

  it("coalesces pending inputs and does not let an unrelated reply drain the queue", () => {
    const h = harness();
    h.client.setInput(input());
    vi.advanceTimersByTime(80);
    const worker = h.workers[0];
    h.client.setInput(input(21));
    vi.advanceTimersByTime(80);
    h.client.setInput(input(22));
    vi.advanceTimersByTime(80);
    worker.reply({ type: "result", result: result(999) });
    expect(worker.sent.map(request => request.revision)).toEqual([1]);
    worker.reply({ type: "result", result: result(1) });
    expect(worker.sent.map(request => request.revision)).toEqual([1, 3]);
    expect(worker.sent[1].road.width).toBe(22);
    expect(h.state.result).toBeNull();
    worker.reply({ type: "result", result: result(3) });
    expect(h.state.result?.revision).toBe(3);
  });

  it("removes a superseded pending request immediately during the next debounce", () => {
    const h = harness();
    h.client.setInput(input());
    vi.advanceTimersByTime(80);
    const worker = h.workers[0];
    h.client.setInput(input(21));
    vi.advanceTimersByTime(80);
    h.client.setInput(input(22));
    vi.advanceTimersByTime(40);
    worker.reply({ type: "result", result: result(1) });
    expect(worker.sent.map(request => request.revision)).toEqual([1]);
    vi.advanceTimersByTime(40);
    expect(worker.sent.map(request => request.revision)).toEqual([1, 3]);
  });

  it("clears null input without letting an in-flight reply restore results or pending work", () => {
    const h = harness();
    h.client.setInput(input());
    vi.advanceTimersByTime(80);
    const worker = h.workers[0];
    h.client.setInput(input(21));
    vi.advanceTimersByTime(80);
    h.client.setInput(null);
    expect(h.state.inputKey).toBeNull();
    expect(h.state.busy).toBe(false);
    worker.reply({ type: "result", result: result(1) });
    h.client.retry();
    vi.advanceTimersByTime(1000);
    expect(h.state.result).toBeNull();
    expect(worker.sent.map(request => request.revision)).toEqual([1]);
    h.client.setInput(input(22));
    vi.advanceTimersByTime(80);
    expect(worker.sent.map(request => request.revision)).toEqual([1, 4]);
  });

  it("handles postMessage failure with explicit fresh-worker recovery", () => {
    const h = harness();
    h.createWorker.mockImplementationOnce(() => {
      const worker = new FakeWorker();
      worker.postError = new Error("Could not clone scenario");
      h.workers.push(worker);
      return worker;
    });
    h.client.setInput(input());
    vi.advanceTimersByTime(80);
    expect(h.state.error).toContain("Could not clone scenario");
    expect(h.workers[0].terminated).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(h.createWorker).toHaveBeenCalledTimes(1);
    h.client.retry();
    vi.advanceTimersByTime(80);
    h.workers[1].reply({ type: "result", result: result(2) });
    expect(h.state.result?.revision).toBe(2);
  });

  it("recovers from a normal error reply on the same working worker", () => {
    const h = harness();
    h.client.setInput(input());
    vi.advanceTimersByTime(80);
    const worker = h.workers[0];
    worker.reply({ type: "error", revision: 1, error: "Scenario calculation failed" });
    expect(h.state.error).toBe("Scenario calculation failed");
    expect(worker.terminated).toBe(false);
    h.client.setInput(input(21));
    vi.advanceTimersByTime(80);
    worker.reply({ type: "result", result: result(2) });
    expect(h.state.result?.revision).toBe(2);
    expect(h.state.error).toBeNull();
    expect(h.createWorker).toHaveBeenCalledTimes(1);
  });

  it("treats an unreadable worker reply as a fatal recoverable error", () => {
    const h = harness();
    h.client.setInput(input());
    vi.advanceTimersByTime(80);
    h.workers[0].unreadable();
    expect(h.state.error).toContain("could not be read");
    expect(h.workers[0].terminated).toBe(true);
    h.client.retry();
    vi.advanceTimersByTime(80);
    expect(h.createWorker).toHaveBeenCalledTimes(2);
  });

  it("cancels cleanup work and recreates with increasing revisions for effect replay", () => {
    const h = harness();
    h.client.setInput(input());
    vi.advanceTimersByTime(80);
    const old = h.workers[0];
    const oldReply = old.onmessage!;
    const oldError = old.onerror!;
    h.client.setInput(input(21));
    const beforeCleanup = h.events.length;
    h.client.dispose();
    h.client.setInput(input(22));
    h.client.retry();
    vi.advanceTimersByTime(1000);
    oldReply({ data: { type: "result", result: result(2) } } as MessageEvent<WorkerReply>);
    oldError({ message: "Disposed worker error" } as ErrorEvent);
    expect(h.events).toHaveLength(beforeCleanup);
    expect(old.terminated).toBe(true);
    expect(old.sent).toHaveLength(1);

    const recreated = h.recreate();
    recreated.setInput(input(21));
    vi.advanceTimersByTime(80);
    const current = h.workers[1];
    expect(current.sent.map(request => request.revision)).toEqual([3]);
    current.reply({ type: "result", result: result(3) });
    expect(h.state.result?.revision).toBe(3);
  });

  it("does not construct a worker after cleanup during initial debounce", () => {
    const h = harness();
    h.client.setInput(input());
    h.client.dispose();
    vi.advanceTimersByTime(1000);
    expect(h.createWorker).not.toHaveBeenCalled();
  });
});
