import {
  computeGraphLayout,
  type LayoutEdgeInput,
  type LayoutNodeInput,
  type LayoutPosition,
} from '@shared/graph-layout';
// Inlined as a blob: worker so it also works when the app is loaded from file:// in Electron
import LayoutWorker from './graph-layout.worker.ts?worker&inline';

let worker: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;
const pending = new Map<number, (positions: LayoutPosition[]) => void>();

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker) return worker;
  try {
    worker = new LayoutWorker();
    worker.onmessage = (event: MessageEvent<{ requestId: number; positions: LayoutPosition[] }>) => {
      pending.get(event.data.requestId)?.(event.data.positions);
      pending.delete(event.data.requestId);
    };
    worker.onerror = () => {
      workerFailed = true;
      worker = null;
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

/** Computes the graph layout off the UI thread (falls back to the main thread if workers are unavailable). */
export function layoutGraphAsync(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[]): Promise<LayoutPosition[]> {
  const w = getWorker();
  const plainNodes = nodes.map((n) => ({ id: n.id }));
  const plainEdges = edges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId }));
  if (!w) return Promise.resolve(computeGraphLayout(plainNodes, plainEdges));
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      resolve(computeGraphLayout(plainNodes, plainEdges));
    }, 10_000);
    pending.set(requestId, (positions) => {
      window.clearTimeout(timeout);
      resolve(positions);
    });
    w.postMessage({ requestId, nodes: plainNodes, edges: plainEdges });
  });
}
