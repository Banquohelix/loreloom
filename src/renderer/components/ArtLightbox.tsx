import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ArtAsset, ArtCategory, EntrySummary, WorldConfig } from '@shared/types';
import { getBridge } from '../lib/bridge';
import { notifyError } from '../lib/notify';

const CATEGORIES: ArtCategory[] = ['character', 'environment', 'prop', 'mood', 'map', 'other'];

interface ArtLightboxProps {
  world: WorldConfig;
  asset: ArtAsset;
  onUpdate: (
    assetId: string,
    patch: Partial<Pick<ArtAsset, 'title' | 'category' | 'tags' | 'caption'>>
  ) => Promise<void>;
  onDelete: (assetId: string) => Promise<void>;
  onNavigateEntry: (entryId: string) => void;
  onClose: () => void;
}

export function ArtLightbox({
  world,
  asset,
  onUpdate,
  onDelete,
  onNavigateEntry,
  onClose,
}: ArtLightboxProps) {
  const bridge = getBridge();
  const [zoomed, setZoomed] = useState(false);
  const [title, setTitle] = useState(asset.title);
  const [caption, setCaption] = useState(asset.caption);
  const [tagInput, setTagInput] = useState('');
  const [linkedEntries, setLinkedEntries] = useState<EntrySummary[]>([]);

  useEffect(() => {
    bridge
      .getArtLinkedEntries(world.slug, asset.id)
      .then(setLinkedEntries)
      .catch((err) => notifyError('Could not load linked entries', err));
  }, [world.slug, asset.id, bridge]);

  const handleSaveText = () => {
    if (title !== asset.title || caption !== asset.caption) {
      onUpdate(asset.id, { title: title.trim() || asset.filename, caption });
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const cleaned = tagInput.replace(/^#/, '').trim();
    if (!cleaned || asset.tags.includes(cleaned)) {
      setTagInput('');
      return;
    }
    onUpdate(asset.id, { tags: [...asset.tags, cleaned] });
    setTagInput('');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col lg:flex-row"
      onClick={onClose}
    >
      {/* Image Canvas */}
      <div
        className="flex-1 flex items-center justify-center p-6 overflow-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
          <button
            onClick={() => setZoomed((z) => !z)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 text-white text-xs hover:bg-black/80 cursor-pointer"
          >
            {zoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
            {zoomed ? 'Fit' : 'Zoom 150%'}
          </button>
        </div>

        <img
          src={bridge.getAssetUrl(world.slug, asset.relativePath)}
          alt={asset.title}
          onClick={() => setZoomed((z) => !z)}
          className={`rounded-xl shadow-2xl transition-transform duration-200 cursor-zoom-in ${
            zoomed ? 'scale-150 cursor-zoom-out' : 'max-h-[85vh] max-w-full object-contain'
          }`}
        />
      </div>

      {/* Metadata Sidebar */}
      <div
        className="w-full lg:w-88 shrink-0 bg-[var(--studio-surface)] border-l border-[var(--studio-border)] p-6 overflow-y-auto space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
            Concept Art Details
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleSaveText}
            className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-1.5 text-sm font-medium outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1">Category</label>
          <select
            value={asset.category}
            onChange={(e) => onUpdate(asset.id, { category: e.target.value as ArtCategory })}
            className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-3 py-1.5 text-xs capitalize outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1">Notes / Caption</label>
          <textarea
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={handleSaveText}
            placeholder="Lighting notes, lore context, artist credit…"
            className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-xs outline-none resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1.5">Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {asset.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/15 text-amber-700 dark:text-amber-300"
              >
                #{t}
                <button
                  onClick={() => onUpdate(asset.id, { tags: asset.tags.filter((x) => x !== t) })}
                  className="cursor-pointer"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleAddTag}
            placeholder="+ press Enter to add tag"
            className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-1.5 text-xs outline-none"
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
            Linked Lore Entries ({linkedEntries.length})
          </div>
          {linkedEntries.length === 0 ? (
            <p className="text-xs text-[var(--studio-muted)]">
              Not linked to any lore page yet. Attach it as a cover, portrait, or inline image in any Entry.
            </p>
          ) : (
            <div className="space-y-1.5">
              {linkedEntries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => {
                    onClose();
                    onNavigateEntry(entry.id);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--studio-border)] hover:border-amber-500/50 text-xs font-medium cursor-pointer"
                >
                  <span className="truncate">{entry.title}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-[var(--studio-muted)]" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-[var(--studio-border)]">
          <button
            onClick={async () => {
              const linkedNote =
                linkedEntries.length > 0
                  ? `\n\nWARNING: ${linkedEntries.length} lore ${linkedEntries.length === 1 ? 'entry uses' : 'entries use'} this image (${linkedEntries
                      .slice(0, 3)
                      .map((e) => e.title)
                      .join(', ')}${linkedEntries.length > 3 ? '…' : ''}). Those covers, portraits and inline images will break.`
                  : '';
              const ok = window.confirm(
                `Delete "${asset.title}"?${linkedNote}\n\nThe file is moved to this World's .trash/assets folder, so it can be restored.`
              );
              if (!ok) return;
              await onDelete(asset.id);
              onClose();
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete Asset
          </button>
        </div>
      </div>
    </div>
  );
}
