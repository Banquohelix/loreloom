import React, { useMemo, useState } from 'react';
import { Image as ImageIcon, Search, Upload } from 'lucide-react';
import type { ArtAsset, ArtCategory, WorldConfig } from '@shared/types';
import { getBridge } from '../lib/bridge';
import { ArtLightbox } from './ArtLightbox';

const CATEGORY_TABS: Array<{ id: ArtCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All Art' },
  { id: 'character', label: 'Characters' },
  { id: 'environment', label: 'Environments' },
  { id: 'prop', label: 'Props' },
  { id: 'mood', label: 'Mood' },
  { id: 'map', label: 'Maps' },
  { id: 'other', label: 'Other' },
];

interface ArtGalleryViewProps {
  world: WorldConfig;
  artAssets: ArtAsset[];
  onRefreshArt: () => Promise<void>;
  onNavigateEntry: (entryId: string) => void;
}

export function ArtGalleryView({
  world,
  artAssets,
  onRefreshArt,
  onNavigateEntry,
}: ArtGalleryViewProps) {
  const bridge = getBridge();
  const [category, setCategory] = useState<ArtCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const selectedAsset = useMemo(
    () => artAssets.find((a) => a.id === selectedAssetId) ?? null,
    [artAssets, selectedAssetId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return artAssets
      .filter((a) => (category === 'all' ? true : a.category === category))
      .filter((a) =>
        !q
          ? true
          : a.title.toLowerCase().includes(q) ||
            a.caption.toLowerCase().includes(q) ||
            a.tags.some((t) => t.toLowerCase().includes(q))
      );
  }, [artAssets, category, search]);

  const handleUploadClick = async () => {
    const files = await bridge.pickImageFiles();
    if (files.length === 0) return;
    await bridge.importArtFiles(world.slug, files, category === 'all' ? 'other' : category);
    await onRefreshArt();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;

    for (const file of files) {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await bridge.saveArtFromBuffer(
        world.slug,
        file.name,
        base64,
        category === 'all' ? 'other' : category
      );
    }
    await onRefreshArt();
  };

  return (
    <div
      className={`flex-1 h-full overflow-y-auto world-canvas transition ${
        dragging ? 'ring-4 ring-inset ring-amber-500/40' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--world-canvas-border)]">
          <div>
            <h1 className="world-heading text-3xl font-semibold tracking-tight">
              Concept Art Gallery
            </h1>
            <p className="text-xs text-[var(--studio-muted)]">
              Drag & drop images anywhere here — saved directly to <code className="opacity-80">worlds/{world.slug}/assets/</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--studio-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search art or tags…"
                className="pl-8 pr-3 py-1.5 rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 text-xs outline-none w-48"
              />
            </div>
            <button
              onClick={handleUploadClick}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white transition hover:opacity-90 cursor-pointer"
              style={{ backgroundColor: 'var(--world-accent)' }}
            >
              <Upload className="w-3.5 h-3.5" />
              Add Concept Art
            </button>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCategory(tab.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition cursor-pointer ${
                category === tab.id
                  ? 'text-white'
                  : 'bg-[var(--world-canvas-muted)] text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
              }`}
              style={
                category === tab.id ? { backgroundColor: 'var(--world-accent)' } : undefined
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="py-20 text-center rounded-2xl border border-dashed border-[var(--world-canvas-border)] space-y-3">
            <ImageIcon className="w-8 h-8 mx-auto text-[var(--studio-muted)] opacity-50" />
            <p className="text-sm text-[var(--studio-muted)]">
              Drop concept art files here or click <strong>Add Concept Art</strong>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((asset) => (
              <button
                key={asset.id}
                onClick={() => setSelectedAssetId(asset.id)}
                className="group text-left rounded-2xl overflow-hidden border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/40 hover:ring-2 hover:ring-amber-500/60 transition cursor-pointer"
              >
                <div className="aspect-[4/3] overflow-hidden bg-black/5">
                  <img
                    src={bridge.getThumbnailUrl(world.slug, asset.relativePath, 512)}
                    loading="lazy"
                    decoding="async"
                    alt={asset.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                  />
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{asset.title}</span>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--studio-muted)] shrink-0">
                      {asset.category}
                    </span>
                  </div>
                  {asset.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {asset.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[var(--studio-muted)]"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedAsset && (
        <ArtLightbox
          world={world}
          asset={selectedAsset}
          onUpdate={async (assetId, patch) => {
            await bridge.updateArtAsset(world.slug, assetId, patch);
            await onRefreshArt();
          }}
          onDelete={async (assetId) => {
            await bridge.deleteArtAsset(world.slug, assetId);
            await onRefreshArt();
          }}
          onNavigateEntry={onNavigateEntry}
          onClose={() => setSelectedAssetId(null)}
        />
      )}
    </div>
  );
}
