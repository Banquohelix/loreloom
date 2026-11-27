import { useEffect, useMemo, useState } from 'react';
import { Clock, LayoutGrid, Plus, Search, Table as TableIcon } from 'lucide-react';
import type { ArtAsset, EntityTypeDef, EntrySummary, WorldConfig } from '@shared/types';
import { groupEntriesForTimeline } from '@shared/timeline-utils';
import { getBridge } from '../lib/bridge';
import { EntityIcon } from './IconBadge';

interface CollectionViewProps {
  world: WorldConfig;
  entityType: EntityTypeDef;
  entries: EntrySummary[];
  artAssets: ArtAsset[];
  onCreateEntry: (typeId: string) => void;
  onSelectEntry: (entryId: string) => void;
}

export function CollectionView({
  world,
  entityType,
  entries,
  artAssets,
  onCreateEntry,
  onSelectEntry,
}: CollectionViewProps) {
  const bridge = getBridge();
  const [viewMode, setViewMode] = useState<'gallery' | 'table' | 'timeline'>(
    entityType.id === 'event' ? 'timeline' : entityType.defaultView
  );
  const [search, setSearch] = useState('');
  const [eraFilter, setEraFilter] = useState<string>('all');

  useEffect(() => {
    setViewMode(entityType.id === 'event' ? 'timeline' : entityType.defaultView);
    setEraFilter('all');
  }, [entityType.id, entityType.defaultView]);

  const assetById = useMemo(() => {
    const m = new Map<string, ArtAsset>();
    for (const a of artAssets) m.set(a.id, a);
    return m;
  }, [artAssets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries
      .filter((e) => e.type === entityType.id || (e.secondaryTypes ?? []).includes(entityType.id))
      .filter((e) =>
        !q
          ? true
          : e.title.toLowerCase().includes(q) ||
            e.excerpt.toLowerCase().includes(q) ||
            e.tags.some((t) => t.toLowerCase().includes(q))
      );
  }, [entries, entityType.id, search]);

  const timelineGroups = useMemo(() => groupEntriesForTimeline(filtered), [filtered]);
  const visibleTimelineGroups = useMemo(
    () =>
      eraFilter === 'all'
        ? timelineGroups
        : timelineGroups.filter((g) => g.era === eraFilter),
    [timelineGroups, eraFilter]
  );

  return (
    <div className="flex-1 h-full overflow-y-auto world-canvas">
      <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--world-canvas-border)]">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${entityType.color}20`, color: entityType.color }}
            >
              <EntityIcon name={entityType.icon} className="w-5 h-5" />
            </div>
            <div>
              <h1 className="world-heading text-3xl font-semibold tracking-tight">
                {entityType.pluralName}
              </h1>
              <p className="text-xs text-[var(--studio-muted)]">
                {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'} in {world.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--studio-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Filter ${entityType.pluralName.toLowerCase()}…`}
                className="pl-8 pr-3 py-1.5 rounded-lg border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/60 text-xs outline-none w-48"
              />
            </div>

            <div className="flex items-center rounded-lg border border-[var(--world-canvas-border)] p-0.5 bg-[var(--world-canvas-muted)]/60">
              <button
                onClick={() => setViewMode('gallery')}
                className={`p-1.5 rounded-md transition cursor-pointer ${
                  viewMode === 'gallery' ? 'bg-[var(--studio-surface)] shadow-xs' : 'opacity-60'
                }`}
                title="Gallery View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md transition cursor-pointer ${
                  viewMode === 'table' ? 'bg-[var(--studio-surface)] shadow-xs' : 'opacity-60'
                }`}
                title="Table View"
              >
                <TableIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={`p-1.5 rounded-md transition cursor-pointer ${
                  viewMode === 'timeline' ? 'bg-[var(--studio-surface)] shadow-xs' : 'opacity-60'
                }`}
                title="Timeline & Era View"
              >
                <Clock className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={() => onCreateEntry(entityType.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition hover:opacity-90 cursor-pointer"
              style={{ backgroundColor: 'var(--world-accent)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              New {entityType.name}
            </button>
          </div>
        </div>

        {/* Content */}
        {filtered.length === 0 ? (
          <div className="py-16 text-center rounded-2xl border border-dashed border-[var(--world-canvas-border)]">
            <p className="text-sm text-[var(--studio-muted)] mb-3">
              No {entityType.pluralName.toLowerCase()} match your view yet.
            </p>
            <button
              onClick={() => onCreateEntry(entityType.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white cursor-pointer"
              style={{ backgroundColor: 'var(--world-accent)' }}
            >
              <Plus className="w-3.5 h-3.5" /> Create First {entityType.name}
            </button>
          </div>
        ) : viewMode === 'gallery' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((entry) => {
              const art =
                (entry.portraitAssetId && assetById.get(entry.portraitAssetId)) ||
                (entry.coverAssetId && assetById.get(entry.coverAssetId));
              return (
                <button
                  key={entry.id}
                  onClick={() => onSelectEntry(entry.id)}
                  className="group text-left rounded-2xl border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/40 hover:bg-[var(--world-canvas-muted)] overflow-hidden transition cursor-pointer flex flex-col"
                >
                  <div className="h-40 w-full bg-black/5 dark:bg-white/5 overflow-hidden relative">
                    {art ? (
                      <img
                        src={bridge.getAssetUrl(world.slug, art.relativePath)}
                        alt={entry.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center opacity-20">
                        <EntityIcon name={entityType.icon} className="w-10 h-10" />
                      </div>
                    )}
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="world-heading text-xl font-semibold truncate mb-1">
                      {entry.title}
                    </div>
                    <p className="text-xs text-[var(--studio-muted)] line-clamp-2 mb-3 flex-1">
                      {entry.excerpt || 'No description yet…'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {entityType.fields.slice(0, 2).map((f) => {
                        const val = entry.properties[f.key];
                        if (!val) return null;
                        return (
                          <span
                            key={f.key}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-[var(--studio-muted)]"
                          >
                            {f.label}: {String(val)}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : viewMode === 'timeline' ? (
          <div className="space-y-6">
            {/* Era filter chips */}
            {timelineGroups.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setEraFilter('all')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer ${
                    eraFilter === 'all'
                      ? 'text-white'
                      : 'bg-[var(--world-canvas-muted)] text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
                  }`}
                  style={
                    eraFilter === 'all' ? { backgroundColor: 'var(--world-accent)' } : undefined
                  }
                >
                  All Eras ({filtered.length})
                </button>
                {timelineGroups.map((g) => (
                  <button
                    key={g.era}
                    onClick={() => setEraFilter(g.era)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer ${
                      eraFilter === g.era
                        ? 'text-white'
                        : 'bg-[var(--world-canvas-muted)] text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
                    }`}
                    style={
                      eraFilter === g.era ? { backgroundColor: 'var(--world-accent)' } : undefined
                    }
                  >
                    {g.era} ({g.items.length})
                  </button>
                ))}
              </div>
            )}

            {/* Era Bands + Vertical Spine */}
            <div className="space-y-8">
              {visibleTimelineGroups.map((group) => (
                <div key={group.era} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider"
                      style={{
                        backgroundColor: 'var(--world-accent-soft)',
                        color: 'var(--world-accent)',
                      }}
                    >
                      {group.era}
                    </span>
                    <div className="h-px flex-1 bg-[var(--world-canvas-border)]" />
                    <span className="text-[11px] text-[var(--studio-muted)]">
                      {group.items.length} {group.items.length === 1 ? 'event' : 'events'}
                    </span>
                  </div>

                  <div className="relative pl-7 space-y-4 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--world-canvas-border)]">
                    {group.items.map(({ entry, dateLabel, impact }) => {
                      const art =
                        (entry.coverAssetId && assetById.get(entry.coverAssetId)) ||
                        (entry.portraitAssetId && assetById.get(entry.portraitAssetId));
                      const isEpoch = impact.toLowerCase().includes('epoch');
                      return (
                        <div key={entry.id} className="relative">
                          <span
                            className={`absolute -left-[22px] top-4 rounded-full border-2 border-[var(--world-canvas-bg)] ${
                              isEpoch ? 'w-4 h-4 -left-[24px] ring-4 ring-amber-500/25' : 'w-3 h-3'
                            }`}
                            style={{ backgroundColor: 'var(--world-accent)' }}
                          />
                          <button
                            onClick={() => onSelectEntry(entry.id)}
                            className="w-full text-left p-4 rounded-2xl border border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/45 hover:bg-[var(--world-canvas-muted)] transition flex items-start gap-4 cursor-pointer"
                          >
                            {art && (
                              <img
                                src={bridge.getAssetUrl(world.slug, art.relativePath)}
                                alt={entry.title}
                                className="w-20 h-20 rounded-xl object-cover shrink-0 border border-[var(--world-canvas-border)]"
                              />
                            )}
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="world-heading text-xl font-semibold">
                                  {entry.title}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {dateLabel && (
                                    <span className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-[11px] font-mono">
                                      {dateLabel}
                                    </span>
                                  )}
                                  {impact && (
                                    <span
                                      className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                                      style={{
                                        backgroundColor: 'var(--world-accent-soft)',
                                        color: 'var(--world-accent)',
                                      }}
                                    >
                                      {impact}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-[var(--studio-muted)] line-clamp-2">
                                {entry.excerpt || 'No summary yet…'}
                              </p>
                              {entry.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {entry.tags.slice(0, 4).map((t) => (
                                    <span
                                      key={t}
                                      className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[10px] text-[var(--studio-muted)]"
                                    >
                                      #{t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--world-canvas-border)] overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--world-canvas-border)] bg-[var(--world-canvas-muted)]/70 text-[var(--studio-muted)]">
                  <th className="py-2.5 px-4 font-semibold">Title</th>
                  {entityType.fields.slice(0, 3).map((f) => (
                    <th key={f.key} className="py-2.5 px-4 font-semibold">
                      {f.label}
                    </th>
                  ))}
                  <th className="py-2.5 px-4 font-semibold">Tags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => onSelectEntry(entry.id)}
                    className="border-b border-[var(--world-canvas-border)]/60 hover:bg-[var(--world-canvas-muted)]/50 transition cursor-pointer"
                  >
                    <td className="py-3 px-4 font-medium">{entry.title}</td>
                    {entityType.fields.slice(0, 3).map((f) => (
                      <td key={f.key} className="py-3 px-4 text-[var(--studio-muted)]">
                        {entry.properties[f.key] ? String(entry.properties[f.key]) : '—'}
                      </td>
                    ))}
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {entry.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[10px]"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
