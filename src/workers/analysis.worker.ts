import { analyze } from '../lib/engine';
import type { AnalysisRequest, WorkerReply } from '../lib/domain';

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const request = event.data;
  try {
    const reply: WorkerReply = { type: 'result', result: analyze(request) };
    self.postMessage(reply);
  } catch (error) {
    const reply: WorkerReply = { type: 'error', revision: Number.isFinite(request?.revision) ? request.revision : 0, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(reply);
  }
};
