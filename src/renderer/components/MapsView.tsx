import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Map as MapIcon,
  MapPin as MapPinIcon,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ArtAsset, EntrySummary, MapPin, WorldConfig, WorldMapDef } from '@shared/types';
import { getBridge } from '../lib/bridge';
import { useKeyedDebouncedSaver } from '../lib/debounced-saver';
import { useNonPassiveWheel } from '../lib/use-non-passive-wheel';

const PIN_COLORS = ['#059669', '#d97706', '#0284c7', '#e11d48', '#7c3aed', '#f97316'];

interface MapsViewProps {
  world: WorldConfig;
  entries: EntrySummary[];
  artAssets: ArtAsset[];
  onRefreshArt: () => Promise<void>;
  onNavigateEntry: (entryId: string) => void;
}

export function MapsView({
  world,
  entries,
  artAssets,
  onRefreshArt,
  onNavigateEntry,
}: MapsViewProps) {
  const bridge = getBridge();
  const [maps, setMaps] = useState<WorldMapDef[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newMapTitle, setNewMapTitle] = useState('');
  const [newMapAssetId, setNewMapAssetId] = useState('');

  const [pinMode, setPinMode] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );
  const imgContainerRef = useRef<HTMLDivElement | null>(null);

  const loadMaps = async () => {
    const list = await bridge.listMaps(world.slug);
    setMaps(list);
    setActiveMapId((prev) =>
      prev && list.some((m) => m.id === prev) ? prev : list[0]?.id ?? null
    );
  };

  useEffect(() => {
    loadMaps();
  }, [world.slug]);

  const activeMap = useMemo(
    () => maps.find((m) => m.id === activeMapId) ?? null,
    [maps, activeMapId]
  );

  const activeAsset = useMemo(
    () => (activeMap ? artAssets.find((a) => a.id === activeMap.assetId) ?? null : null),
    [activeMap, artAssets]
  );

  const selectedPin = useMemo(
    () => activeMap?.pins.find((p) => p.id === selectedPinId) ?? null,
    [activeMap, selectedPinId]
  );

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  // Sort entries so Locations appear first in the pin link dropdown
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const aLoc = a.type === 'location' ? 0 : 1;
      const bLoc = b.type === 'location' ? 0 : 1;
      if (aLoc !== bLoc) return aLoc - bLoc;
      return a.title.localeCompare(b.title);
    });
  }, [entries]);

  // Sort art assets so 'map' category images appear first
  const sortedMapAssets = useMemo(() => {
    return [...artAssets].sort((a, b) => {
      const aMap = a.category === 'map' ? 0 : 1;
      const bMap = b.category === 'map' ? 0 : 1;
      if (aMap !== bMap) return aMap - bMap;
      return a.title.localeCompare(b.title);
    });
  }, [artAssets]);

  const handleUploadNewMapImage = async () => {
    const files = await bridge.pickImageFiles();
    if (files.length === 0) return;
    const saved = await bridge.importArtFiles(world.slug, [files[0]], 'map');
    await onRefreshArt();
    if (saved[0]) {
      setNewMapAssetId(saved[0].id);
      if (!newMapTitle.trim()) setNewMapTitle(saved[0].title);
    }
  };

  const handleCreateMap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMapAssetId) return;
    const created = await bridge.createMap(
      world.slug,
      newMapTitle.trim() || 'World Map',
      newMapAssetId
    );
    setMaps((prev) => [...prev, created]);
    setActiveMapId(created.id);
    setNewMapTitle('');
    setNewMapAssetId('');
    setCreateOpen(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleDeleteMap = async (mapId: string) => {
    const map = maps.find((m) => m.id === mapId);
    const ok = window.confirm(
      `Delete the map "${map?.title ?? 'Untitled'}" and its ${map?.pins.length ?? 0} pins?\n\nThe image stays in Concept Art. A copy of the map is kept in this World's .trash/maps folder.`
    );
    if (!ok) return;
    await bridge.deleteMap(world.slug, mapId);
    const remaining = maps.filter((m) => m.id !== mapId);
    setMaps(remaining);
    setActiveMapId(remaining[0]?.id ?? null);
    setSelectedPinId(null);
  };

  // Pin edits update the screen immediately; the file write is debounced and ordered so typing
  // in a label or note never drops characters or lands out of order.
  const schedulePinsSave = useKeyedDebouncedSaver<MapPin[]>((mapId, pins) =>
    bridge.updateMap(world.slug, mapId, { pins })
  );
  const mapWheelRef = useNonPassiveWheel<HTMLDivElement>((e) => {
    setZoom((z) => Math.max(0.5, Math.min(4, z * (e.deltaY < 0 ? 1.12 : 0.89))));
  });

  const savePins = async (nextPins: MapPin[]) => {
    if (!activeMap) return;
    const mapId = activeMap.id;
    setMaps((prev) => prev.map((m) => (m.id === mapId ? { ...m, pins: nextPins } : m)));
    schedulePinsSave(mapId, nextPins);
  };

  const handleMapClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode || !activeMap || !imgContainerRef.current) return;
    const rect = imgContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    const newPin: MapPin = {
      id: crypto.randomUUID(),
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      label: 'New Location Pin',
      color: PIN_COLORS[0],
      note: '',
    };

    await savePins([...activeMap.pins, newPin]);
    setSelectedPinId(newPin.id);
    setPinMode(false);
  };

  const updateSelectedPin = async (patch: Partial<MapPin>) => {
    if (!activeMap || !selectedPin) return;
    const next = activeMap.pins.map((p) => (p.id === selectedPin.id ? { ...p, ...patch } : p));
    await savePins(next);
  };

  const deleteSelectedPin = async () => {
    if (!activeMap || !selectedPin) return;
    const next = activeMap.pins.filter((p) => p.id !== selectedPin.id);
    await savePins(next);
    setSelectedPinId(null);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (pinMode) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!panRef.current) return;
    setPan({
      x: panRef.current.origX + (e.clientX - panRef.current.startX),
      y: panRef.current.origY + (e.clientY - panRef.current.startY),
    });
  };

  const handleCanvasMouseUp = () => {
    panRef.current = null;
  };

  return (
    <div className="flex-1 h-full flex flex-col world-canvas overflow-hidden">
      {/* Header Toolbar */}
      <div className="px-6 py-3.5 border-b border-[var(--world-canvas-border)] flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="world-heading text-2xl font-semibold tracking-tight">Maps</h1>
          {maps.length > 0 && (
            <select
              value={activeMapId ?? ''}
              onChange={(e) => {
                setActiveMapId(e.target.value);
                setSelectedPinId(null);
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/70 px-3 py-1.5 text-xs font-medium outline-none"
            >
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.pins.length} pins)
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {activeMap && (
            <>
              <button
                onClick={() => setPinMode((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  pinMode
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 hover:bg-[var(--world-canvas-muted)]'
                }`}
              >
                <MapPinIcon className="w-3.5 h-3.5" />
                {pinMode ? 'Click Map to Drop Pin…' : 'Drop Pin'}
              </button>

              <div className="flex items-center rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 p-0.5">
                <button
                  onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
                  className="p-1.5 rounded hover:bg-black/5 cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setZoom((z) => Math.max(0.5, z * 0.8))}
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
            </>
          )}

          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer"
            style={{ backgroundColor: 'var(--world-accent)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Map
          </button>
        </div>
      </div>

      {/* Main Split: Interactive Canvas + Pin Sidebar */}
      {!activeMap || !activeAsset ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
          <MapIcon className="w-10 h-10 text-[var(--studio-muted)] opacity-40" />
          <h2 className="world-heading text-2xl font-semibold">No Interactive Maps Yet</h2>
          <p className="text-xs text-[var(--studio-muted)] max-w-md">
            Create a map from any Concept Art image (world map, continent, or city layout) and drop
            clickable pins linked directly to your Locations and Lore Entries.
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-white cursor-pointer"
            style={{ backgroundColor: 'var(--world-accent)' }}
          >
            <Plus className="w-4 h-4" /> Create First Map
          </button>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Interactive Map Canvas */}
          <div
            className={`flex-1 relative overflow-hidden flex items-center justify-center bg-black/5 dark:bg-black/25 select-none ${
              pinMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
            }`}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            ref={mapWheelRef}
          >
            <div
              ref={imgContainerRef}
              onClick={handleMapClick}
              className="relative inline-block shadow-2xl rounded-xl overflow-visible"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            >
              <img
                src={bridge.getAssetUrl(world.slug, activeAsset.relativePath)}
                alt={activeMap.title}
                draggable={false}
                className="max-h-[76vh] max-w-[72vw] block rounded-xl pointer-events-none"
              />

              {/* Pins */}
              {activeMap.pins.map((pin) => {
                const linked = pin.entryId ? entryById.get(pin.entryId) : undefined;
                const isSelected = selectedPinId === pin.id;
                const isHovered = hoveredPinId === pin.id;
                return (
                  <div
                    key={pin.id}
                    style={{
                      left: `${pin.x}%`,
                      top: `${pin.y}%`,
                      transform: `translate(-50%, -100%) scale(${1 / Math.sqrt(zoom)})`,
                    }}
                    className="absolute z-10 outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-full"
                    role="button"
                    tabIndex={0}
                    aria-label={`Map pin: ${pin.label}${linked ? `, linked to ${linked.title}` : ''}`}
                    onMouseEnter={() => setHoveredPinId(pin.id)}
                    onMouseLeave={() => setHoveredPinId(null)}
                    onFocus={() => setHoveredPinId(pin.id)}
                    onBlur={() => setHoveredPinId(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedPinId(pin.id);
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPinId(pin.id);
                    }}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-white shadow-lg border-2 border-white transition cursor-pointer ${
                        isSelected ? 'scale-125 ring-4 ring-amber-400/50' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: pin.color }}
                    >
                      <MapPinIcon className="w-4 h-4" />
                    </div>

                    {(isHovered || isSelected) && (
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-9 w-48 p-2.5 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-surface)] text-[var(--studio-text)] shadow-xl pointer-events-none">
                        <div className="text-xs font-semibold truncate">{pin.label}</div>
                        {linked && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
                            Linked: {linked.title}
                          </div>
                        )}
                        {(pin.note || linked?.excerpt) && (
                          <div className="text-[10px] text-[var(--studio-muted)] line-clamp-2 mt-0.5">
                            {pin.note || linked?.excerpt}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Pin Inspector & Pin List */}
          <aside className="w-76 shrink-0 border-l border-[var(--studio-border)] bg-[var(--studio-sidebar)] overflow-y-auto p-4 space-y-5">
            {selectedPin ? (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
                    Selected Pin
                  </span>
                  <button
                    onClick={() => setSelectedPinId(null)}
                    className="p-1 rounded hover:bg-black/5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-[var(--studio-muted)] mb-1">Pin Label</label>
                  <input
                    value={selectedPin.label}
                    onChange={(e) => updateSelectedPin({ label: e.target.value })}
                    className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--studio-muted)] mb-1">
                    Linked Lore Entry
                  </label>
                  <select
                    value={selectedPin.entryId ?? ''}
                    onChange={(e) => {
                      const entryId = e.target.value || undefined;
                      const linked = entryId ? entryById.get(entryId) : undefined;
                      updateSelectedPin({
                        entryId,
                        label:
                          linked && selectedPin.label === 'New Location Pin'
                            ? linked.title
                            : selectedPin.label,
                      });
                    }}
                    className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none"
                  >
                    <option value="">— None —</option>
                    {sortedEntries.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title} ({e.type})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedPin.entryId && entryById.get(selectedPin.entryId) && (
                  <button
                    onClick={() => onNavigateEntry(selectedPin.entryId!)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
                  >
                    Open {entryById.get(selectedPin.entryId)!.title}
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}

                <div>
                  <label className="block text-xs text-[var(--studio-muted)] mb-1.5">Pin Color</label>
                  <div className="flex items-center gap-2">
                    {PIN_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => updateSelectedPin({ color: c })}
                        className={`w-6 h-6 rounded-full border-2 cursor-pointer ${
                          selectedPin.color === c
                            ? 'border-zinc-900 dark:border-white scale-110'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[var(--studio-muted)] mb-1">Quick Note</label>
                  <textarea
                    rows={3}
                    value={selectedPin.note ?? ''}
                    onChange={(e) => updateSelectedPin({ note: e.target.value })}
                    placeholder="Notes shown when hovering this pin…"
                    className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none resize-none"
                  />
                </div>

                <button
                  onClick={deleteSelectedPin}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove Pin
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
                  Pins on {activeMap.title} ({activeMap.pins.length})
                </div>
                {activeMap.pins.length === 0 ? (
                  <p className="text-xs text-[var(--studio-muted)]">
                    Click <strong>Drop Pin</strong> in the top bar, then click anywhere on the map to
                    pin a Location.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {activeMap.pins.map((pin) => (
                      <button
                        key={pin.id}
                        onClick={() => setSelectedPinId(pin.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] hover:border-amber-500/50 text-left text-xs cursor-pointer"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: pin.color }}
                        />
                        <span className="truncate font-medium flex-1">{pin.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="pt-4 border-t border-[var(--studio-border)]">
                  <button
                    onClick={() => handleDeleteMap(activeMap.id)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Map
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Create New Map Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
          onClick={() => setCreateOpen(false)}
        >
          <form
            onSubmit={handleCreateMap}
            onClick={(e) => e.stopPropagation()}
            className="max-w-lg w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Create Interactive Map</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1 rounded-lg hover:bg-black/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-[var(--studio-muted)] mb-1">Map Title</label>
              <input
                required
                value={newMapTitle}
                onChange={(e) => setNewMapTitle(e.target.value)}
                placeholder="e.g. Brimstone Continent, Ashgate Metro"
                className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[var(--studio-muted)]">Choose Map Image</label>
                <button
                  type="button"
                  onClick={handleUploadNewMapImage}
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 hover:underline cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload New Image
                </button>
              </div>
              {sortedMapAssets.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--studio-muted)] border border-dashed border-[var(--studio-border)] rounded-xl">
                  Click <strong>Upload New Image</strong> above to add a map image.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5 max-h-56 overflow-y-auto">
                  {sortedMapAssets.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => {
                        setNewMapAssetId(a.id);
                        if (!newMapTitle.trim()) setNewMapTitle(a.title);
                      }}
                      className={`relative aspect-video rounded-xl overflow-hidden border-2 transition cursor-pointer ${
                        newMapAssetId === a.id
                          ? 'border-amber-500 ring-2 ring-amber-500/30'
                          : 'border-[var(--studio-border)]'
                      }`}
                    >
                      <img
                        src={bridge.getThumbnailUrl(world.slug, a.relativePath, 256)}
                        loading="lazy"
                        decoding="async"
                        alt={a.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-0.5 text-[10px] text-white truncate">
                        {a.title}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 rounded-lg text-xs border border-[var(--studio-border)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newMapAssetId}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-40 cursor-pointer"
              >
                Create Map
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
