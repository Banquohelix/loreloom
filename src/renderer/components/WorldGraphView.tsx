import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, RotateCcw, Search, ZoomIn, ZoomOut } from 'lucide-react';
import type { WorldConfig, WorldGraph } from '@shared/types';
import { getBridge } from '../lib/bridge';
import { layoutGraphAsync } from '../lib/graph-layout-client';
import { notifyError } from '../lib/notify';
import { useNonPassiveWheel } from '../lib/use-non-passive-wheel';

interface SimNode {
  id: string;
  title: string;
  type: string;
  connectionCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface WorldGraphViewProps {
  world: WorldConfig;
  onSelectEntry: (entryId: string) => void;
}

export function WorldGraphView({ world, onSelectEntry }: WorldGraphViewProps) {
  const bridge = getBridge();
  const [graph, setGraph] = useState<WorldGraph>({ nodes: [], edges: [] });
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [hideIsolated, setHideIsolated] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const draggingNodeRef = useRef<string | null>(null);
  /** Set once a node drag actually moves, so the click that ends the drag doesn't open the entry. */
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const panningRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );
  const svgRef = useRef<SVGSVGElement | null>(null);

  const colorByType = useMemo(() => {
    const map = new Map<string, string>();
    for (const et of world.entityTypes) map.set(et.id, et.color);
    return map;
  }, [world.entityTypes]);

  useEffect(() => {
    bridge.getWorldGraph(world.slug).then(setGraph).catch((err) => notifyError('Could not load the Lore Graph', err));
  }, [bridge, world.slug]);

  const visibleGraph = useMemo(() => {
    const filteredNodes = graph.nodes.filter((n) => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      if (hideIsolated && n.connectionCount === 0) return false;
      return true;
    });
    const visibleIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = graph.edges.filter(
      (e) => visibleIds.has(e.sourceId) && visibleIds.has(e.targetId)
    );
    return { nodes: filteredNodes, edges: filteredEdges };
  }, [graph, typeFilter, hideIsolated]);

  // Lay out off the UI thread whenever the visible graph changes (Barnes–Hut, in a Web Worker)
  const [layingOut, setLayingOut] = useState(false);
  useEffect(() => {
    if (visibleGraph.nodes.length === 0) {
      setNodes([]);
      return;
    }
    let cancelled = false;
    setLayingOut(true);
    layoutGraphAsync(visibleGraph.nodes, visibleGraph.edges).then((positions) => {
      if (cancelled) return;
      const byId = new Map(positions.map((p) => [p.id, p]));
      setNodes(
        visibleGraph.nodes.map((n) => ({
          ...n,
          x: byId.get(n.id)?.x ?? 0,
          y: byId.get(n.id)?.y ?? 0,
          vx: 0,
          vy: 0,
        }))
      );
      setLayingOut(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visibleGraph]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const neighborsOfHovered = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set<string>([hoveredId]);
    for (const e of visibleGraph.edges) {
      if (e.sourceId === hoveredId) set.add(e.targetId);
      if (e.targetId === hoveredId) set.add(e.sourceId);
    }
    return set;
  }, [hoveredId, visibleGraph.edges]);

  const searchLower = search.trim().toLowerCase();

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingNodeRef.current) return;
    panningRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingNodeRef.current && dragStartRef.current && !dragMovedRef.current) {
      if (Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y) > 4) {
        dragMovedRef.current = true;
      }
    }
    if (draggingNodeRef.current && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - rect.width / 2 - pan.x) / zoom;
      const y = (e.clientY - rect.top - rect.height / 2 - pan.y) / zoom;
      const id = draggingNodeRef.current;
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
      return;
    }
    if (panningRef.current) {
      const dx = e.clientX - panningRef.current.startX;
      const dy = e.clientY - panningRef.current.startY;
      setPan({ x: panningRef.current.origX + dx, y: panningRef.current.origY + dy });
    }
  };

  const handleSvgMouseUp = () => {
    draggingNodeRef.current = null;
    panningRef.current = null;
  };

  const wheelRef = useNonPassiveWheel<SVGSVGElement>((e) => {
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.max(0.3, Math.min(3, z * factor)));
  });

  return (
    <div className="flex-1 h-full flex flex-col world-canvas overflow-hidden">
      {/* Toolbar */}
      <div className="px-6 py-3.5 border-b border-[var(--world-canvas-border)] flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="world-heading text-2xl font-semibold tracking-tight">Lore Graph</h1>
          <p className="text-xs text-[var(--studio-muted)]">
            {visibleGraph.nodes.length} entries · {visibleGraph.edges.length} connections — drag
            nodes or click any entry to open
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--studio-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Highlight entry…"
              className="pl-8 pr-3 py-1.5 rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 text-xs outline-none w-40"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 px-2.5 py-1.5 text-xs outline-none"
          >
            <option value="all">All Collections</option>
            {world.entityTypes.map((et) => (
              <option key={et.id} value={et.id}>
                {et.pluralName}
              </option>
            ))}
          </select>

          <button
            onClick={() => setHideIsolated((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 text-xs cursor-pointer"
            title="Toggle entries with no [[wikilinks]]"
          >
            {hideIsolated ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {hideIsolated ? 'Connected Only' : 'Show All'}
          </button>

          <button
            onClick={() => setShowEdgeLabels((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
              showEdgeLabels
                ? 'border-amber-500/60 bg-amber-500/10 font-medium'
                : 'border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60'
            }`}
            title="Show typed relationship labels on edges"
          >
            Edge Labels
          </button>

          <div className="flex items-center rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 p-0.5">
            <button
              onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
              className="p-1.5 rounded hover:bg-black/5 cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}
              className="p-1.5 rounded hover:bg-black/5 cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="p-1.5 rounded hover:bg-black/5 cursor-pointer"
              title="Reset View"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Interactive SVG Canvas */}
      <div className="flex-1 relative overflow-hidden">
        {layingOut && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full text-[11px] bg-[var(--studio-surface)] border border-[var(--studio-border)] text-[var(--studio-muted)]">
            Laying out {visibleGraph.nodes.length} entries…
          </div>
        )}
        {nodes.length === 0 && !layingOut ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-2">
            <p className="text-sm text-[var(--studio-muted)]">
              No connected entries match the current filter.
            </p>
            {hideIsolated && graph.nodes.length > 0 && (
              <button
                onClick={() => setHideIsolated(false)}
                className="text-xs font-medium text-amber-600 hover:underline cursor-pointer"
              >
                Show all {graph.nodes.length} entries (including unlinked)
              </button>
            )}
          </div>
        ) : (
          <svg
            ref={(el) => {
              svgRef.current = el;
              wheelRef(el);
            }}
            className="w-full h-full cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgMouseUp}
          >
            <g
              transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
              style={{ transformOrigin: 'center center' }}
            >
              <g transform="translate(560, 360)">
                {/* Edges */}
                {visibleGraph.edges.map((edge) => {
                  const a = nodeById.get(edge.sourceId);
                  const b = nodeById.get(edge.targetId);
                  if (!a || !b) return null;
                  const highlighted =
                    hoveredId && (edge.sourceId === hoveredId || edge.targetId === hoveredId);
                  const dimmed = hoveredId && !highlighted;
                  const isTyped = Boolean(edge.label);
                  const midX = (a.x + b.x) / 2;
                  const midY = (a.y + b.y) / 2;
                  return (
                    <g key={`${edge.sourceId}-${edge.targetId}`}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={highlighted || isTyped ? 'var(--world-accent)' : 'currentColor'}
                        strokeOpacity={
                          highlighted ? 0.9 : dimmed ? 0.06 : isTyped ? 0.55 : 0.22
                        }
                        strokeWidth={highlighted ? 2.2 : isTyped ? 1.6 : 1.1}
                      />
                      {edge.label && (showEdgeLabels || highlighted) && !dimmed && (
                        <text
                          x={midX}
                          y={midY - 4}
                          textAnchor="middle"
                          fill="var(--world-accent)"
                          fontSize={9.5}
                          fontWeight={600}
                          className="pointer-events-none"
                        >
                          {edge.label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Nodes */}
                {nodes.map((node) => {
                  const color = colorByType.get(node.type) ?? '#64748b';
                  const r = Math.min(20, 7 + Math.sqrt(node.connectionCount) * 3.2);
                  const isSearchMatch =
                    searchLower.length > 0 && node.title.toLowerCase().includes(searchLower);
                  const isDimmed =
                    (neighborsOfHovered && !neighborsOfHovered.has(node.id)) ||
                    (searchLower.length > 0 && !isSearchMatch);

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="cursor-pointer"
                      opacity={isDimmed ? 0.18 : 1}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        draggingNodeRef.current = node.id;
                        dragMovedRef.current = false;
                        dragStartRef.current = { x: e.clientX, y: e.clientY };
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (dragMovedRef.current) {
                          dragMovedRef.current = false;
                          return;
                        }
                        onSelectEntry(node.id);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${node.title}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectEntry(node.id);
                        }
                      }}
                      onFocus={() => setHoveredId(node.id)}
                      onBlur={() => setHoveredId(null)}
                    >
                      {isSearchMatch && (
                        <circle r={r + 6} fill={color} fillOpacity={0.25} />
                      )}
                      <circle
                        r={r}
                        fill={color}
                        stroke="var(--world-canvas-bg)"
                        strokeWidth={2}
                      />
                      <text
                        y={r + 13}
                        textAnchor="middle"
                        fill="currentColor"
                        fontSize={11}
                        fontWeight={hoveredId === node.id || isSearchMatch ? 600 : 400}
                        className="pointer-events-none"
                      >
                        {node.title}
                      </text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-2 px-3 py-2 rounded-xl border border-[var(--world-canvas-border)] bg-[var(--world-canvas-bg)]/90 backdrop-blur-xs max-w-xl">
          {world.entityTypes.map((et) => (
            <button
              key={et.id}
              onClick={() => setTypeFilter((cur) => (cur === et.id ? 'all' : et.id))}
              className={`inline-flex items-center gap-1.5 text-[11px] cursor-pointer transition ${
                typeFilter !== 'all' && typeFilter !== et.id ? 'opacity-35' : ''
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: et.color }} />
              <span>{et.pluralName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
