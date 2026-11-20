import type { AnalysisEvent } from "./analysis-state";
import type { AnalysisRequest, WorkerReply } from "./domain";

const EXECUTION_TIMEOUT_MS = 30_000;

export interface AnalysisWorker {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage: (request: AnalysisRequest) => void;
  terminate: () => void;
}

interface ClientOptions {
  createWorker: () => AnalysisWorker;
  nextRevision: () => number;
  onEvent: (event: AnalysisEvent) => void;
}

export interface AnalysisClient {
  setInput: (inputKey: string | null) => void;
  retry: () => void;
  dispose: () => void;
}

export function createAnalysisClient({ createWorker, nextRevision, onEvent }: ClientOptions): AnalysisClient {
  let worker: AnalysisWorker | null = null;
  let generation = 0;
  let disposed = false;
  let inputKey: string | null | undefined;
  let revision = 0;
  let inFlight: AnalysisRequest | null = null;
  let pending: AnalysisRequest | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let executionTimer: ReturnType<typeof setTimeout> | null = null;
  let fatalError: string | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const clearExecutionTimer = () => {
    if (executionTimer !== null) clearTimeout(executionTimer);
    executionTimer = null;
  };

  const retireWorker = () => {
    clearExecutionTimer();
    const previous = worker;
    worker = null;
    generation++;
    inFlight = null;
    pending = null;
    if (previous) {
      previous.onmessage = null;
      previous.onerror = null;
      previous.onmessageerror = null;
      previous.terminate();
    }
  };

  const failFatal = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message || fallback : typeof error === "string" && error ? error : fallback;
    fatalError = `${message} Retry the calculation to start a new worker.`;
    clearTimer();
    retireWorker();
    if (!disposed && inputKey != null) onEvent({ type: "failed", revision, error: fatalError });
  };

  const ensureWorker = (): AnalysisWorker | null => {
    if (worker) return worker;
    try {
      const created = createWorker();
      worker = created;
      const workerGeneration = ++generation;
      const current = () => !disposed && worker === created && generation === workerGeneration;
      created.onmessage = event => {
        if (!current()) return;
        const reply = event.data;
        const replyRevision = reply?.type === "result" ? reply.result?.revision : reply?.type === "error" ? reply.revision : undefined;
        if (!Number.isFinite(replyRevision)) {
          failFatal(null, "The calculation worker returned an invalid reply.");
          return;
        }
        if (!inFlight || replyRevision !== inFlight.revision) return;
        clearExecutionTimer();
        inFlight = null;
        if (inputKey != null && replyRevision === revision) {
          if (reply.type === "result") onEvent({ type: "received", result: reply.result });
          else onEvent({ type: "failed", revision: reply.revision, error: reply.error });
        }
        const queued = pending;
        pending = null;
        if (queued) send(queued);
      };
      created.onerror = event => {
        if (!current()) return;
        event.preventDefault?.();
        failFatal(event.message, "The calculation worker stopped unexpectedly.");
      };
      created.onmessageerror = () => {
        if (current()) failFatal(null, "The calculation worker reply could not be read.");
      };
      return created;
    } catch (error) {
      failFatal(error, "The calculation worker could not start.");
      return null;
    }
  };

  const send = (request: AnalysisRequest) => {
    if (disposed || inputKey == null || request.revision !== revision) return;
    if (fatalError) {
      onEvent({ type: "failed", revision, error: fatalError });
      return;
    }
    const target = ensureWorker();
    if (!target) return;
    inFlight = request;
    const requestGeneration = generation;
    clearExecutionTimer();
    executionTimer = setTimeout(() => {
      if (disposed || worker !== target || generation !== requestGeneration || inFlight !== request) return;
      executionTimer = null;
      failFatal(null, "The calculation worker did not respond within 30 seconds.");
    }, EXECUTION_TIMEOUT_MS);
    try {
      target.postMessage(request);
    } catch (error) {
      failFatal(error, "The scenario could not be sent to the calculation worker.");
    }
  };

  const requestCurrent = () => {
    revision = nextRevision();
    clearTimer();
    pending = null;
    if (inputKey == null) {
      retireWorker();
      onEvent({ type: "cleared", revision });
      return;
    }
    onEvent({ type: "requested", revision, inputKey });
    if (fatalError) {
      onEvent({ type: "failed", revision, error: fatalError });
      return;
    }
    let request: AnalysisRequest;
    try {
      request = { ...JSON.parse(inputKey), revision };
    } catch (error) {
      failFatal(error, "The scenario could not be read.");
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      if (inFlight) pending = request;
      else send(request);
    }, 80);
  };

  return {
    setInput(nextInputKey) {
      if (disposed || nextInputKey === inputKey) return;
      inputKey = nextInputKey;
      requestCurrent();
    },
    retry() {
      if (disposed || inputKey == null) return;
      clearTimer();
      retireWorker();
      fatalError = null;
      requestCurrent();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      retireWorker();
    },
  };
}
