import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  LayoutDashboard,
  Palette,
  Plus,
  RotateCcw,
  StickyNote,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ArtAsset, BoardItem, MoodboardDef, WorldConfig } from '@shared/types';
import { getBridge } from '../lib/bridge';

interface MoodboardViewProps {
  world: WorldConfig;
  artAssets: ArtAsset[];
  onRefreshArt: () => Promise<void>;
}

export function MoodboardView({ world, artAssets, onRefreshArt }: MoodboardViewProps) {
  const bridge = getBridge();
  const [boards, setBoards] = useState<MoodboardDef[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [artPickerOpen, setArtPickerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const draggingItemRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const panningRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const loadBoards = async () => {
    const list = await bridge.listBoards(world.slug);
    setBoards(list);
    setActiveBoardId((prev) =>
      prev && list.some((b) => b.id === prev) ? prev : list[0]?.id ?? null
    );
  };

  useEffect(() => {
    loadBoards();
  }, [world.slug]);

  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? null,
    [boards, activeBoardId]
  );

  const assetById = useMemo(() => new Map(artAssets.map((a) => [a.id, a])), [artAssets]);

  const saveItems = async (nextItems: BoardItem[]) => {
    if (!activeBoard) return;
    setBoards((prev) =>
      prev.map((b) => (b.id === activeBoard.id ? { ...b, items: nextItems } : b))
    );
    await bridge.updateBoard(world.slug, activeBoard.id, { items: nextItems });
  };

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle.trim()) return;
    const created = await bridge.createBoard(world.slug, createTitle.trim());
    setBoards((prev) => [...prev, created]);
    setActiveBoardId(created.id);
    setCreateTitle('');
    setCreateOpen(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleDeleteBoard = async (boardId: string) => {
    await bridge.deleteBoard(world.slug, boardId);
    const remaining = boards.filter((b) => b.id !== boardId);
    setBoards(remaining);
    setActiveBoardId(remaining[0]?.id ?? null);
  };

  const addItem = async (item: Omit<BoardItem, 'id' | 'x' | 'y'>) => {
    if (!activeBoard) return;
    const offset = (activeBoard.items.length % 6) * 28;
    const next: BoardItem = {
      ...item,
      id: crypto.randomUUID(),
      x: Math.round((120 - pan.x) / zoom + offset),
      y: Math.round((80 - pan.y) / zoom + offset),
    };
    await saveItems([...activeBoard.items, next]);
  };

  const updateItem = async (id: string, patch: Partial<BoardItem>) => {
    if (!activeBoard) return;
    const next = activeBoard.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    await saveItems(next);
  };

  const deleteItem = async (id: string) => {
    if (!activeBoard) return;
    await saveItems(activeBoard.items.filter((it) => it.id !== id));
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (draggingItemRef.current) return;
    panningRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (draggingItemRef.current && activeBoard) {
      const { id, startX, startY, origX, origY } = draggingItemRef.current;
      const dx = (e.clientX - startX) / zoom;
      const dy = (e.clientY - startY) / zoom;
      setBoards((prev) =>
        prev.map((b) =>
          b.id === activeBoard.id
            ? {
                ...b,
                items: b.items.map((it) =>
                  it.id === id ? { ...it, x: Math.round(origX + dx), y: Math.round(origY + dy) } : it
                ),
              }
            : b
        )
      );
      return;
    }
    if (panningRef.current) {
      setPan({
        x: panningRef.current.origX + (e.clientX - panningRef.current.startX),
        y: panningRef.current.origY + (e.clientY - panningRef.current.startY),
      });
    }
  };

  const handleCanvasMouseUp = async () => {
    if (draggingItemRef.current && activeBoard) {
      draggingItemRef.current = null;
      await bridge.updateBoard(world.slug, activeBoard.id, { items: activeBoard.items });
    }
    panningRef.current = null;
  };

  const handleDropImageFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!activeBoard) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const newItems: BoardItem[] = [];
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const saved = await bridge.saveArtFromBuffer(world.slug, file.name, btoa(bin), 'mood');
      newItems.push({
        id: crypto.randomUUID(),
        kind: 'art',
        assetId: saved.id,
        title: saved.title,
        x: Math.round((140 - pan.x) / zoom + idx * 40),
        y: Math.round((100 - pan.y) / zoom + idx * 40),
        width: 280,
      });
    }
    await onRefreshArt();
    await saveItems([...activeBoard.items, ...newItems]);
  };

  return (
    <div className="flex-1 h-full flex flex-col world-canvas overflow-hidden">
      {/* Toolbar */}
      <div className="px-6 py-3.5 border-b border-[var(--world-canvas-border)] flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="world-heading text-2xl font-semibold tracking-tight">Moodboards</h1>
          {boards.length > 0 && (
            <select
              value={activeBoardId ?? ''}
              onChange={(e) => {
                setActiveBoardId(e.target.value);
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/70 px-3 py-1.5 text-xs font-medium outline-none"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} ({b.items.length})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {activeBoard && (
            <>
              <button
                onClick={() => setArtPickerOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 hover:bg-[var(--world-canvas-muted)] text-xs cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5" /> + Art
              </button>
              <button
                onClick={() =>
                  addItem({ kind: 'note', width: 240, title: 'Direction Note', text: '' })
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 hover:bg-[var(--world-canvas-muted)] text-xs cursor-pointer"
              >
                <StickyNote className="w-3.5 h-3.5" /> + Note
              </button>
              <button
                onClick={() =>
                  addItem({
                    kind: 'swatch',
                    width: 150,
                    title: 'Key Accent',
                    color: world.theme.accentColor,
                  })
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 hover:bg-[var(--world-canvas-muted)] text-xs cursor-pointer"
              >
                <Palette className="w-3.5 h-3.5" /> + Swatch
              </button>

              <div className="flex items-center rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 p-0.5">
                <button
                  onClick={() => setZoom((z) => Math.min(2.5, z * 1.15))}
                  className="p-1.5 rounded hover:bg-black/5 cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setZoom((z) => Math.max(0.4, z * 0.85))}
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

              <button
                onClick={() => handleDeleteBoard(activeBoard.id)}
                title="Delete Board"
                className="p-1.5 rounded-lg text-[var(--studio-muted)] hover:text-red-500 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer"
            style={{ backgroundColor: 'var(--world-accent)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Board
          </button>
        </div>
      </div>

      {/* Canvas */}
      {!activeBoard ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
          <LayoutDashboard className="w-10 h-10 text-[var(--studio-muted)] opacity-40" />
          <h2 className="world-heading text-2xl font-semibold">No Moodboards Yet</h2>
          <p className="text-xs text-[var(--studio-muted)] max-w-md">
            Create a visual reference pinboard for {world.name} to arrange concept art, color
            palettes, and art-direction notes side-by-side.
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-white cursor-pointer"
            style={{ backgroundColor: 'var(--world-accent)' }}
          >
            <Plus className="w-4 h-4" /> Create First Moodboard
          </button>
        </div>
      ) : (
        <div
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
          style={{
            backgroundImage: 'radial-gradient(rgba(120,120,130,0.22) 1px, transparent 1px)',
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onWheel={(e) => {
            e.preventDefault();
            setZoom((z) => Math.max(0.4, Math.min(2.5, z * (e.deltaY < 0 ? 1.1 : 0.9))));
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropImageFiles}
        >
          <div
            className="absolute inset-0 origin-top-left"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            {activeBoard.items.map((item) => {
              const asset = item.assetId ? assetById.get(item.assetId) : undefined;
              return (
                <div
                  key={item.id}
                  style={{ left: item.x, top: item.y, width: item.width }}
                  className="absolute rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-lg overflow-hidden group"
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest('input,textarea,button')) return;
                    e.stopPropagation();
                    draggingItemRef.current = {
                      id: item.id,
                      startX: e.clientX,
                      startY: e.clientY,
                      origX: item.x,
                      origY: item.y,
                    };
                  }}
                >
                  {/* Card Top Hover Bar */}
                  <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--studio-border)]/70 bg-black/3 dark:bg-white/3 cursor-move">
                    <span className="text-[10px] uppercase tracking-wider text-[var(--studio-muted)] font-medium">
                      {item.kind}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      {item.kind === 'art' && (
                        <>
                          {[200, 300, 440].map((w, i) => (
                            <button
                              key={w}
                              onClick={() => updateItem(item.id, { width: w })}
                              className="px-1 text-[10px] rounded hover:bg-black/10 cursor-pointer"
                            >
                              {['S', 'M', 'L'][i]}
                            </button>
                          ))}
                        </>
                      )}
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="p-0.5 text-[var(--studio-muted)] hover:text-red-500 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {item.kind === 'art' && asset ? (
                    <div>
                      <img
                        src={bridge.getAssetUrl(world.slug, asset.relativePath)}
                        alt={asset.title}
                        draggable={false}
                        className="w-full h-auto block pointer-events-none"
                      />
                      <div className="px-3 py-2">
                        <input
                          value={item.title ?? asset.title}
                          onChange={(e) => updateItem(item.id, { title: e.target.value })}
                          className="w-full bg-transparent text-xs font-medium outline-none"
                        />
                      </div>
                    </div>
                  ) : item.kind === 'swatch' ? (
                    <div className="p-3 space-y-2">
                      <div
                        className="h-20 rounded-xl border border-black/10 relative overflow-hidden"
                        style={{ backgroundColor: item.color || '#d97706' }}
                      >
                        <input
                          type="color"
                          value={item.color || '#d97706'}
                          onChange={(e) => updateItem(item.id, { color: e.target.value })}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          title="Pick swatch color"
                        />
                      </div>
                      <input
                        value={item.title ?? ''}
                        onChange={(e) => updateItem(item.id, { title: e.target.value })}
                        placeholder="Swatch name"
                        className="w-full bg-transparent text-xs font-medium outline-none"
                      />
                      <div className="text-[10px] font-mono text-[var(--studio-muted)] uppercase">
                        {item.color || '#d97706'}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 space-y-1.5">
                      <input
                        value={item.title ?? ''}
                        onChange={(e) => updateItem(item.id, { title: e.target.value })}
                        placeholder="Note title…"
                        className="w-full bg-transparent text-xs font-semibold outline-none"
                      />
                      <textarea
                        rows={4}
                        value={item.text ?? ''}
                        onChange={(e) => updateItem(item.id, { text: e.target.value })}
                        placeholder="Lighting, silhouette, palette, or lore notes…"
                        className="w-full bg-transparent text-xs text-[var(--studio-muted)] outline-none resize-y leading-relaxed"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-bg)]/90 text-[11px] text-[var(--studio-muted)]">
            Drag cards to arrange · Drop images onto canvas · Scroll to zoom
          </div>
        </div>
      )}

      {/* Create Board Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
          onClick={() => setCreateOpen(false)}
        >
          <form
            onSubmit={handleCreateBoard}
            onClick={(e) => e.stopPropagation()}
            className="max-w-sm w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">New Moodboard</h2>
              <button type="button" onClick={() => setCreateOpen(false)} className="p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              required
              autoFocus
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="e.g. Ashgate Lighting & Vehicles"
              className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs border border-[var(--studio-border)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 cursor-pointer"
              >
                Create Board
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Concept Art Modal */}
      {artPickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
          onClick={() => setArtPickerOpen(false)}
        >
          <div
            className="max-w-2xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Pin Concept Art to Moodboard</h3>
              <button onClick={() => setArtPickerOpen(false)} className="p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            {artAssets.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--studio-muted)]">
                No concept art yet — drag image files straight onto the Moodboard canvas!
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                {artAssets.map((a) => (
                  <button
                    key={a.id}
                    onClick={async () => {
                      await addItem({ kind: 'art', assetId: a.id, title: a.title, width: 280 });
                      setArtPickerOpen(false);
                    }}
                    className="group relative aspect-video rounded-xl overflow-hidden border border-[var(--studio-border)] hover:ring-2 hover:ring-amber-500 cursor-pointer"
                  >
                    <img
                      src={bridge.getAssetUrl(world.slug, a.relativePath)}
                      alt={a.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-[11px] text-white truncate">
                      {a.title}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
