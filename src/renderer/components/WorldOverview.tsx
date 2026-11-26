import { Image as ImageIcon, Palette, Plus, Sparkles } from 'lucide-react';
import type { ArtAsset, EntrySummary, WorldConfig } from '@shared/types';
import { getBridge } from '../lib/bridge';
import { EntityIcon } from './IconBadge';

interface WorldOverviewProps {
  world: WorldConfig;
  entries: EntrySummary[];
  artAssets: ArtAsset[];
  onCreateEntry: (typeId: string) => void;
  onSelectEntry: (entryId: string) => void;
  onOpenArtGallery: () => void;
  onOpenThemeDrawer: () => void;
}

export function WorldOverview({
  world,
  entries,
  artAssets,
  onCreateEntry,
  onSelectEntry,
  onOpenArtGallery,
  onOpenThemeDrawer,
}: WorldOverviewProps) {
  const bridge = getBridge();
  const recentEntries = entries.slice(0, 6);
  const recentArt = artAssets.slice(0, 6);

  return (
    <div className="flex-1 h-full overflow-y-auto world-canvas">
      <div className="max-w-5xl mx-auto px-8 py-10 space-y-10">
        {/* Hero Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-[var(--world-canvas-border)]">
          <div>
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium mb-3 capitalize"
              style={{
                backgroundColor: 'var(--world-accent-soft)',
                color: 'var(--world-accent)',
              }}
            >
              <Sparkles className="w-3 h-3" />
              {world.medium.replace('-', ' ')} World
            </div>
            <h1 className="world-heading text-4xl font-semibold tracking-tight">{world.name}</h1>
            {world.subtitle && (
              <p className="text-sm text-[var(--studio-muted)] mt-1.5 max-w-2xl">
                {world.subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onOpenThemeDrawer}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)] text-xs font-medium hover:opacity-90 transition cursor-pointer shrink-0"
          >
            <Palette className="w-3.5 h-3.5" style={{ color: 'var(--world-accent)' }} />
            Style World
          </button>
        </div>

        {/* Quick Create Strip */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-muted)] mb-3">
            Quick Create
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            {world.entityTypes.map((et) => (
              <button
                key={et.id}
                onClick={() => onCreateEntry(et.id)}
                className="flex flex-col items-start gap-2 p-3.5 rounded-xl border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 hover:bg-[var(--world-canvas-muted)] transition text-left cursor-pointer group"
              >
                <div className="flex items-center justify-between w-full">
                  <span style={{ color: et.color }}>
                    <EntityIcon name={et.icon} className="w-4 h-4" />
                  </span>
                  <Plus className="w-3.5 h-3.5 opacity-0 group-hover:opacity-70 transition" />
                </div>
                <span className="text-xs font-medium truncate w-full">{et.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Concept Art */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
              Concept Art ({artAssets.length})
            </div>
            <button
              onClick={onOpenArtGallery}
              className="text-xs font-medium hover:underline cursor-pointer"
              style={{ color: 'var(--world-accent)' }}
            >
              Open Gallery →
            </button>
          </div>
          {recentArt.length === 0 ? (
            <button
              onClick={onOpenArtGallery}
              className="w-full py-10 rounded-2xl border border-dashed border-[var(--world-canvas-border)] flex flex-col items-center justify-center gap-2 text-xs text-[var(--studio-muted)] hover:bg-[var(--world-canvas-muted)]/40 transition cursor-pointer"
            >
              <ImageIcon className="w-5 h-5 opacity-60" />
              <span>Drop concept art into this World's gallery</span>
            </button>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {recentArt.map((asset) => (
                <button
                  key={asset.id}
                  onClick={onOpenArtGallery}
                  className="aspect-square rounded-xl overflow-hidden border border-[var(--world-canvas-border)] group cursor-pointer relative"
                >
                  <img
                    src={bridge.getAssetUrl(world.slug, asset.relativePath)}
                    alt={asset.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recent Lore Entries */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-muted)] mb-3">
            Recent Lore ({entries.length})
          </div>
          {recentEntries.length === 0 ? (
            <div className="p-8 rounded-2xl border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/40 text-center text-sm text-[var(--studio-muted)]">
              This world is a blank canvas. Create a Character, Location, or Lore Page above — or import an Obsidian vault from the sidebar.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recentEntries.map((entry) => {
                const et = world.entityTypes.find((t) => t.id === entry.type);
                return (
                  <button
                    key={entry.id}
                    onClick={() => onSelectEntry(entry.id)}
                    className="p-4 rounded-xl border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/40 hover:bg-[var(--world-canvas-muted)] transition text-left cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="world-heading text-lg font-semibold truncate">
                        {entry.title}
                      </span>
                      {et && (
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: `${et.color}20`, color: et.color }}
                        >
                          {et.name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--studio-muted)] line-clamp-2">
                      {entry.excerpt || 'Empty page…'}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
