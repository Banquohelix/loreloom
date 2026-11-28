import { computeGraphLayout, type LayoutEdgeInput, type LayoutNodeInput } from '@shared/graph-layout';

interface LayoutRequest {
  requestId: number;
  nodes: LayoutNodeInput[];
  edges: LayoutEdgeInput[];
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { requestId, nodes, edges } = event.data;
  const positions = computeGraphLayout(nodes, edges);
  (self as unknown as Worker).postMessage({ requestId, positions });
};
