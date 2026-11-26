import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  FolderPlus,
  FolderSync,
  Image as ImageIcon,
  FileText,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  NEEDS_TRIAGE_TAG,
  type ArtAsset,
  type ArtCategory,
  type EntrySummary,
  type IntakeSyncReport,
  type WorldConfig,
} from '@shared/types';
import { getBridge } from '../lib/bridge';

const ART_CATEGORIES: ArtCategory[] = ['character', 'environment', 'prop', 'mood', 'map', 'other'];

interface IntakeSyncModalProps {
  world: WorldConfig;
  entries: EntrySummary[];
  artAssets: ArtAsset[];
  onRefreshWorld: () => Promise<void>;
  onNavigateEntry: (entryId: string) => void;
  onClose: () => void;
}

export function IntakeSyncModal({
  world,
  entries,
  artAssets,
  onRefreshWorld,
  onNavigateEntry,
  onClose,
}: IntakeSyncModalProps) {
  const bridge = getBridge();
  const [folders, setFolders] = useState<string[]>([]);
  const [tab, setTab] = useState<'folders' | 'triage'>('folders');
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<IntakeSyncReport | null>(null);

  const triageEntries = useMemo(
    () => entries.filter((e) => e.tags.includes(NEEDS_TRIAGE_TAG)),
    [entries]
  );
  const triageArt = useMemo(
    () => artAssets.filter((a) => a.tags.includes(NEEDS_TRIAGE_TAG)),
    [artAssets]
  );
  const totalTriage = triageEntries.length + triageArt.length;

  useEffect(() => {
    bridge.getWorldIntakeFolders(world.slug).then(setFolders).catch(() => {});
  }, [bridge, world.slug]);

  const handleAddFolder = async () => {
    const picked = await bridge.pickFolder(`Select Drop Folder for ${world.name} (e.g. Brimstone)`);
    if (!picked || folders.includes(picked)) return;
    const next = [...folders, picked];
    await bridge.setWorldIntakeFolders(world.slug, next);
    setFolders(next);
  };

  const handleRemoveFolder = async (folder: string) => {
    const next = folders.filter((f) => f !== folder);
    await bridge.setWorldIntakeFolders(world.slug, next);
    setFolders(next);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await bridge.runWorldIntakeSync(world.slug);
      setReport(res);
      await onRefreshWorld();
    } finally {
      setSyncing(false);
    }
  };

  const handleSlotEntry = async (entry: EntrySummary, nextTypeId: string) => {
    await bridge.updateEntry({
      worldSlug: world.slug,
      id: entry.id,
      type: nextTypeId,
      tags: entry.tags.filter((t) => t !== NEEDS_TRIAGE_TAG),
    });
    await onRefreshWorld();
  };

  const handleSlotArt = async (asset: ArtAsset, nextCategory: ArtCategory) => {
    await bridge.updateArtAsset(world.slug, asset.id, {
      category: nextCategory,
      tags: asset.tags.filter((t) => t !== NEEDS_TRIAGE_TAG),
    });
    await onRefreshWorld();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="max-w-2xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <FolderSync className="w-5 h-5 text-amber-600" />
            <div>
              <h2 className="text-base font-semibold">Intake Folder Sync — {world.name}</h2>
              <p className="text-xs text-[var(--studio-muted)]">
                Auto-import & sort Gemini, ChatGPT, Claude notes & art from watched project folders
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-[var(--studio-border)] pb-2 shrink-0">
          <button
            onClick={() => setTab('folders')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              tab === 'folders'
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
            }`}
          >
            Watched Folders ({folders.length})
          </button>
          <button
            onClick={() => setTab('triage')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
              tab === 'triage'
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
            }`}
          >
            Needs Triage
            {totalTriage > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-semibold">
                {totalTriage}
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {tab === 'folders' ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--studio-muted)]">
                  Drop folders are watched live and synced non-destructively (originals untouched).
                </span>
                <button
                  onClick={handleAddFolder}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--studio-border)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer shrink-0"
                >
                  <FolderPlus className="w-3.5 h-3.5" /> Add Folder
                </button>
              </div>

              {folders.length === 0 ? (
                <div className="py-10 text-center rounded-2xl border border-dashed border-[var(--studio-border)] space-y-2">
                  <p className="text-xs text-[var(--studio-muted)] max-w-md mx-auto">
                    Link your project staging folder (e.g. <strong>Brimstone</strong> or{' '}
                    <strong>Neon Ash</strong>). Whenever you drop new <code>.md</code>,{' '}
                    <code>.txt</code>, or concept art images into it, Loreloom automatically sorts them into Characters, Locations, Factions, Items, Maps, or Environments.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {folders.map((folder) => (
                    <div
                      key={folder}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border border-[var(--studio-border)] bg-black/3 dark:bg-white/3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">
                          {folder.split(/[\\/]/).pop()}
                        </div>
                        <div className="text-[11px] text-[var(--studio-muted)] truncate">
                          {folder}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveFolder(folder)}
                        title="Stop watching folder"
                        className="p-1.5 text-[var(--studio-muted)] hover:text-red-500 cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {report && (
                <div className="p-4 rounded-xl border border-emerald-500/25 bg-emerald-500/8 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Sync Complete
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2 rounded-lg bg-[var(--studio-surface)] border border-[var(--studio-border)]">
                      <div className="font-semibold text-sm">{report.importedEntries}</div>
                      <div className="text-[10px] text-[var(--studio-muted)]">New Lore</div>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--studio-surface)] border border-[var(--studio-border)]">
                      <div className="font-semibold text-sm">{report.updatedEntries}</div>
                      <div className="text-[10px] text-[var(--studio-muted)]">Updated</div>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--studio-surface)] border border-[var(--studio-border)]">
                      <div className="font-semibold text-sm">{report.importedArt}</div>
                      <div className="text-[10px] text-[var(--studio-muted)]">New Art</div>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--studio-surface)] border border-[var(--studio-border)]">
                      <div className="font-semibold text-sm">{report.skippedUnchanged}</div>
                      <div className="text-[10px] text-[var(--studio-muted)]">Unchanged</div>
                    </div>
                  </div>
                  {report.items.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 pt-1">
                      {report.items.map((item) => (
                        <div
                          key={`${item.kind}-${item.id}`}
                          className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-[var(--studio-surface)]/80"
                        >
                          <span className="truncate font-medium">{item.title}</span>
                          <span className="text-[var(--studio-muted)] shrink-0 ml-2">
                            → {item.assignedCategory}
                            {item.needsTriage ? ' (needs triage)' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={handleSyncNow}
                  disabled={syncing || folders.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium disabled:opacity-40 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Syncing Drop Folders…' : 'Sync Now'}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {totalTriage === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--studio-muted)]">
                  All synced notes and concept art are sorted into their slots!
                </div>
              ) : (
                <>
                  {triageEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--studio-border)]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-amber-600 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{entry.title}</div>
                          <div className="text-[11px] text-[var(--studio-muted)] truncate">
                            {entry.excerpt || entry.relativePath}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) handleSlotEntry(entry, e.target.value);
                          }}
                          className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none"
                        >
                          <option value="">Assign slot…</option>
                          {world.entityTypes.map((et) => (
                            <option key={et.id} value={et.id}>
                              {et.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            onClose();
                            onNavigateEntry(entry.id);
                          }}
                          title="Open Entry"
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {triageArt.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--studio-border)]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={bridge.getAssetUrl(world.slug, asset.relativePath)}
                          alt={asset.title}
                          className="w-10 h-10 rounded-lg object-cover shrink-0 border border-[var(--studio-border)]"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate flex items-center gap-1">
                            <ImageIcon className="w-3 h-3 text-amber-600" />
                            {asset.title}
                          </div>
                          <div className="text-[11px] text-[var(--studio-muted)] truncate">
                            {asset.filename}
                          </div>
                        </div>
                      </div>
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) handleSlotArt(asset, e.target.value as ArtCategory);
                        }}
                        className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs capitalize outline-none shrink-0"
                      >
                        <option value="">Assign art slot…</option>
                        {ART_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
