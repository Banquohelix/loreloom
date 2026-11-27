import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CopyCheck,
  Image as ImageIcon,
  Link2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import type { ArtLinkSuggestion, DuplicateGroup, WorldConfig } from '@shared/types';
import { getBridge } from '../lib/bridge';

interface WorldToolsModalProps {
  world: WorldConfig;
  onRefreshWorld: () => Promise<void>;
  onClose: () => void;
}

export function WorldToolsModal({ world, onRefreshWorld, onClose }: WorldToolsModalProps) {
  const bridge = getBridge();
  const [tab, setTab] = useState<'duplicates' | 'art'>('duplicates');
  const [loading, setLoading] = useState(true);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [keepChoice, setKeepChoice] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<ArtLinkSuggestion[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    try {
      const [dups, art] = await Promise.all([
        bridge.findDuplicates(world.slug),
        bridge.findArtLinkSuggestions(world.slug),
      ]);
      setDuplicates(dups);
      const defaults: Record<string, string> = {};
      for (const g of dups) {
        if (g.entries[0]) defaults[g.key] = g.entries[0].id;
      }
      setKeepChoice(defaults);
      setSuggestions(art);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    scan();
  }, [world.slug]);

  const handleMergeGroup = async (group: DuplicateGroup) => {
    const keepId = keepChoice[group.key] || group.entries[0]?.id;
    if (!keepId) return;
    const removeIds = group.entries.map((e) => e.id).filter((id) => id !== keepId);
    setBusyKey(group.key);
    try {
      await bridge.mergeDuplicates(world.slug, keepId, removeIds);
      await onRefreshWorld();
      await scan();
    } finally {
      setBusyKey(null);
    }
  };

  const handleMergeAll = async () => {
    setBusyKey('all-dups');
    try {
      for (const group of duplicates) {
        const keepId = keepChoice[group.key] || group.entries[0]?.id;
        if (!keepId) continue;
        const removeIds = group.entries.map((e) => e.id).filter((id) => id !== keepId);
        await bridge.mergeDuplicates(world.slug, keepId, removeIds);
      }
      await onRefreshWorld();
      await scan();
    } finally {
      setBusyKey(null);
    }
  };

  const handleApplyArtLink = async (s: ArtLinkSuggestion, slot?: 'cover' | 'portrait') => {
    const chosenSlot = slot ?? s.suggestedSlot;
    setBusyKey(`${s.entryId}::${s.assetId}`);
    try {
      await bridge.updateEntry({
        worldSlug: world.slug,
        id: s.entryId,
        ...(chosenSlot === 'portrait'
          ? { portraitAssetId: s.assetId }
          : { coverAssetId: s.assetId }),
      });
      await onRefreshWorld();
      await scan();
    } finally {
      setBusyKey(null);
    }
  };

  const handleApplyAllArt = async () => {
    setBusyKey('all-art');
    try {
      const usedEntries = new Set<string>();
      for (const s of suggestions) {
        const key = `${s.entryId}:${s.suggestedSlot}`;
        if (usedEntries.has(key)) continue;
        usedEntries.add(key);
        await bridge.updateEntry({
          worldSlug: world.slug,
          id: s.entryId,
          ...(s.suggestedSlot === 'portrait'
            ? { portraitAssetId: s.assetId }
            : { coverAssetId: s.assetId }),
        });
      }
      await onRefreshWorld();
      await scan();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="max-w-2xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-5 max-h-[86vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-amber-600" />
            <div>
              <h2 className="text-base font-semibold">World Cleanup & Auto-Link — {world.name}</h2>
              <p className="text-xs text-[var(--studio-muted)]">
                Merge duplicate notes safely and auto-attach matching concept art
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--studio-border)] pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('duplicates')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                tab === 'duplicates'
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
              }`}
            >
              <CopyCheck className="w-3.5 h-3.5" />
              Duplicates ({duplicates.length})
            </button>
            <button
              onClick={() => setTab('art')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                tab === 'art'
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Art Auto-Linker ({suggestions.length})
            </button>
          </div>
          <button
            onClick={scan}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Rescan
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--studio-muted)]">
              Scanning {world.name}…
            </div>
          ) : tab === 'duplicates' ? (
            duplicates.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <CheckCircle2 className="w-7 h-7 mx-auto text-emerald-600" />
                <p className="text-xs text-[var(--studio-muted)]">
                  No duplicate entries found in {world.name}.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--studio-muted)]">
                    Merging keeps all tags, properties, and unique prose from removed copies.
                  </span>
                  <button
                    onClick={handleMergeAll}
                    disabled={busyKey !== null}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer disabled:opacity-50"
                  >
                    Merge All ({duplicates.length})
                  </button>
                </div>

                {duplicates.map((group) => (
                  <div
                    key={group.key}
                    className="p-4 rounded-xl border border-[var(--studio-border)] space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{group.title}</span>
                      <button
                        onClick={() => handleMergeGroup(group)}
                        disabled={busyKey !== null}
                        className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-medium hover:opacity-90 cursor-pointer disabled:opacity-50"
                      >
                        {busyKey === group.key ? 'Merging…' : 'Merge & Clean Up'}
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      {group.entries.map((e) => (
                        <label
                          key={e.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[var(--studio-border)] bg-black/3 dark:bg-white/3 text-xs cursor-pointer"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="radio"
                              name={`keep-${group.key}`}
                              checked={(keepChoice[group.key] || group.entries[0].id) === e.id}
                              onChange={() =>
                                setKeepChoice((prev) => ({ ...prev, [group.key]: e.id }))
                              }
                              className="accent-amber-600"
                            />
                            <span className="truncate font-mono text-[11px]">{e.relativePath}</span>
                          </span>
                          <span className="text-[11px] text-[var(--studio-muted)] shrink-0">
                            {e.type} · {e.bodyLength} chars
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )
          ) : suggestions.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <CheckCircle2 className="w-7 h-7 mx-auto text-emerald-600" />
              <p className="text-xs text-[var(--studio-muted)]">
                No unlinked concept art matches found.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--studio-muted)]">
                  Attach matching concept art as Covers or Portraits in one click.
                </span>
                <button
                  onClick={handleApplyAllArt}
                  disabled={busyKey !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Auto-Link All ({suggestions.length})
                </button>
              </div>

              <div className="space-y-2">
                {suggestions.map((s) => (
                  <div
                    key={`${s.entryId}-${s.assetId}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--studio-border)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={bridge.getAssetUrl(world.slug, s.assetRelativePath)}
                        alt={s.assetTitle}
                        className="w-12 h-12 rounded-lg object-cover border border-[var(--studio-border)] shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">
                          {s.entryTitle}{' '}
                          <span className="font-normal text-[var(--studio-muted)]">
                            ← {s.assetTitle}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--studio-muted)] flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-medium ${
                              s.confidence === 'high'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {s.confidence}
                          </span>
                          <span className="truncate">{s.reason}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleApplyArtLink(s, 'cover')}
                        disabled={busyKey !== null}
                        className="px-2.5 py-1.5 rounded-lg border border-[var(--studio-border)] hover:bg-black/5 dark:hover:bg-white/5 text-[11px] font-medium cursor-pointer"
                      >
                        Cover
                      </button>
                      <button
                        onClick={() => handleApplyArtLink(s, 'portrait')}
                        disabled={busyKey !== null}
                        className="px-2.5 py-1.5 rounded-lg border border-[var(--studio-border)] hover:bg-black/5 dark:hover:bg-white/5 text-[11px] font-medium cursor-pointer"
                      >
                        Portrait
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
