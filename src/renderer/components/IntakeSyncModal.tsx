import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  FileDown,
  FileText,
  FolderPlus,
  FolderSync,
  Image as ImageIcon,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  NEEDS_TRIAGE_TAG,
  type ArtAsset,
  type ArtCategory,
  type EntrySummary,
  type IntakeSyncReport,
  type ReclassifyTriageReport,
  type WorldConfig,
} from '@shared/types';
import { generateWorldPromptFramework } from '@shared/prompt-framework';
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
  const [tab, setTab] = useState<'folders' | 'triage' | 'framework'>('folders');
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<IntakeSyncReport | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyReport, setReclassifyReport] = useState<ReclassifyTriageReport | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [selectedArtIds, setSelectedArtIds] = useState<Set<string>>(new Set());
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [savedPromptPath, setSavedPromptPath] = useState<string | null>(null);

  const promptFramework = useMemo(() => generateWorldPromptFramework(world), [world]);

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

  const handleReclassify = async () => {
    setReclassifying(true);
    try {
      const res = await bridge.reclassifyTriageItems(world.slug);
      setReclassifyReport(res);
      setSelectedEntryIds(new Set());
      setSelectedArtIds(new Set());
      await onRefreshWorld();
    } finally {
      setReclassifying(false);
    }
  };

  const handleSlotEntry = async (entry: EntrySummary, nextTypeId: string) => {
    await bridge.updateEntry({
      worldSlug: world.slug,
      id: entry.id,
      type: nextTypeId,
      tags: entry.tags.filter((t) => t !== NEEDS_TRIAGE_TAG),
    });
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
    await onRefreshWorld();
  };

  const handleBulkSlotEntries = async (nextTypeId: string) => {
    if (!nextTypeId || selectedEntryIds.size === 0) return;
    for (const entry of triageEntries) {
      if (!selectedEntryIds.has(entry.id)) continue;
      await bridge.updateEntry({
        worldSlug: world.slug,
        id: entry.id,
        type: nextTypeId,
        tags: entry.tags.filter((t) => t !== NEEDS_TRIAGE_TAG),
      });
    }
    setSelectedEntryIds(new Set());
    await onRefreshWorld();
  };

  const handleSlotArt = async (asset: ArtAsset, nextCategory: ArtCategory) => {
    await bridge.updateArtAsset(world.slug, asset.id, {
      category: nextCategory,
      tags: asset.tags.filter((t) => t !== NEEDS_TRIAGE_TAG),
    });
    setSelectedArtIds((prev) => {
      const next = new Set(prev);
      next.delete(asset.id);
      return next;
    });
    await onRefreshWorld();
  };

  const handleBulkSlotArt = async (nextCategory: ArtCategory) => {
    if (selectedArtIds.size === 0) return;
    for (const asset of triageArt) {
      if (!selectedArtIds.has(asset.id)) continue;
      await bridge.updateArtAsset(world.slug, asset.id, {
        category: nextCategory,
        tags: asset.tags.filter((t) => t !== NEEDS_TRIAGE_TAG),
      });
    }
    setSelectedArtIds(new Set());
    await onRefreshWorld();
  };

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(promptFramework);
    setCopiedPrompt(true);
    window.setTimeout(() => setCopiedPrompt(false), 2500);
  };

  const handleExportPrompt = async () => {
    const outPath = await bridge.exportWorldPromptFramework(world.slug);
    setSavedPromptPath(outPath);
  };

  const toggleEntrySelect = (id: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleArtSelect = (id: string) => {
    setSelectedArtIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <div className="flex items-center gap-2 border-b border-[var(--studio-border)] pb-2 shrink-0 flex-wrap">
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
          <button
            onClick={() => setTab('framework')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
              tab === 'framework'
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI Prompt Framework
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
                    <code>.txt</code>, or concept art images into it, Loreloom automatically sorts
                    them into your World's collections and art gallery.
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
          ) : tab === 'triage' ? (
            <div className="space-y-3">
              {/* Triage Toolbar */}
              {totalTriage > 0 && (
                <div className="flex items-center justify-between gap-2 flex-wrap p-3 rounded-xl border border-[var(--studio-border)] bg-black/3 dark:bg-white/3">
                  <div className="text-xs text-[var(--studio-muted)]">
                    Triage clears automatically on all synced PCs via OneDrive.
                  </div>
                  <button
                    onClick={handleReclassify}
                    disabled={reclassifying}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer disabled:opacity-50"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                    {reclassifying ? 'Re-sorting…' : 'Re-run Auto-Sorter'}
                  </button>
                </div>
              )}

              {reclassifyReport && (
                <div className="px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400">
                  Auto-sorted <strong>{reclassifyReport.reclassifiedEntries}</strong> lore{' '}
                  {reclassifyReport.reclassifiedEntries === 1 ? 'entry' : 'entries'} and{' '}
                  <strong>{reclassifyReport.reclassifiedArt}</strong> art{' '}
                  {reclassifyReport.reclassifiedArt === 1 ? 'asset' : 'assets'}.{' '}
                  {reclassifyReport.remainingTriage} remaining.
                </div>
              )}

              {/* Bulk Action Bars */}
              {selectedEntryIds.size > 0 && (
                <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25">
                  <span className="text-xs font-medium">
                    {selectedEntryIds.size} lore {selectedEntryIds.size === 1 ? 'entry' : 'entries'} selected
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) handleBulkSlotEntries(e.target.value);
                    }}
                    className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1 text-xs outline-none"
                  >
                    <option value="">Bulk assign slot…</option>
                    {world.entityTypes.map((et) => (
                      <option key={et.id} value={et.id}>
                        {et.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedArtIds.size > 0 && (
                <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25">
                  <span className="text-xs font-medium">
                    {selectedArtIds.size} concept art {selectedArtIds.size === 1 ? 'file' : 'files'} selected
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) handleBulkSlotArt(e.target.value as ArtCategory);
                    }}
                    className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1 text-xs capitalize outline-none"
                  >
                    <option value="">Bulk assign art slot…</option>
                    {ART_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
                        <input
                          type="checkbox"
                          checked={selectedEntryIds.has(entry.id)}
                          onChange={() => toggleEntrySelect(entry.id)}
                          className="accent-amber-600 shrink-0"
                        />
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
                        <input
                          type="checkbox"
                          checked={selectedArtIds.has(asset.id)}
                          onChange={() => toggleArtSelect(asset.id)}
                          className="accent-amber-600 shrink-0"
                        />
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
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-[var(--studio-muted)]">
                  Paste into your Gemini Gem, ChatGPT Project, or Claude Project for{' '}
                  <strong>{world.name}</strong> so future outputs auto-sort with zero triage.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportPrompt}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--studio-border)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    Save .md to World
                  </button>
                  <button
                    onClick={handleCopyPrompt}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
                  >
                    {copiedPrompt ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy Prompt
                      </>
                    )}
                  </button>
                </div>
              </div>

              {savedPromptPath && (
                <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-400 truncate">
                  Saved to {savedPromptPath}
                </div>
              )}

              <pre className="p-4 rounded-xl border border-[var(--studio-border)] bg-black/3 dark:bg-white/3 text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-80 leading-relaxed">
                {promptFramework}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
