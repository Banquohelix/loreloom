import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderInput, FolderOpen, X } from 'lucide-react';
import type {
  ImportReport,
  VaultScanPreview,
  WorldConfig,
  WorldMedium,
  WorldThemePresetId,
} from '@shared/types';
import { listWorldThemePresets } from '@core/theme-engine';
import { getBridge } from '../lib/bridge';

interface ObsidianImportModalProps {
  worlds: WorldConfig[];
  onImported: (worldSlug: string) => Promise<void>;
  onClose: () => void;
}

export function ObsidianImportModal({ worlds, onImported, onClose }: ObsidianImportModalProps) {
  const bridge = getBridge();
  const presets = listWorldThemePresets();

  const [preview, setPreview] = useState<VaultScanPreview | null>(null);
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [newWorldName, setNewWorldName] = useState('');
  const [newWorldMedium, setNewWorldMedium] = useState<WorldMedium>('novel');
  const [newWorldPreset, setNewWorldPreset] = useState<WorldThemePresetId>('parchment-lorebook');
  const [targetWorldSlug, setTargetWorldSlug] = useState(worlds[0]?.slug ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const handlePickVault = async () => {
    setError(null);
    try {
      const folder = await bridge.pickFolder('Select Obsidian Story Vault Folder');
      if (!folder) return;
      setBusy(true);
      const scanned = await bridge.scanObsidianVault(folder);
      setPreview(scanned);
      setNewWorldName(scanned.vaultName);
    } catch (err) {
      setError((err as Error).message || 'Could not scan Obsidian vault.');
    } finally {
      setBusy(false);
    }
  };

  const handleRunImport = async () => {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const res = await bridge.importObsidianVault({
        vaultPath: preview.vaultPath,
        targetWorldSlug: targetMode === 'existing' ? targetWorldSlug : undefined,
        newWorldName: targetMode === 'new' ? newWorldName.trim() || preview.vaultName : undefined,
        newWorldMedium,
        newWorldPreset,
      });
      setReport(res);
      await onImported(res.worldSlug);
    } catch (err) {
      setError((err as Error).message || 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="max-w-xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FolderInput className="w-5 h-5 text-amber-600" />
            <div>
              <h2 className="text-base font-semibold">Import Obsidian Story Vault</h2>
              <p className="text-xs text-[var(--studio-muted)]">
                Non-destructive copy into your synced Loreloom workspace
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {report ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold">Imported into {report.worldName}</div>
                <p className="text-xs text-[var(--studio-muted)] mt-0.5">
                  Your original Obsidian vault was left untouched.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-xl border border-[var(--studio-border)]">
                <div className="text-xl font-semibold">{report.importedNotes}</div>
                <div className="text-[11px] text-[var(--studio-muted)]">Notes Imported</div>
              </div>
              <div className="p-3 rounded-xl border border-[var(--studio-border)]">
                <div className="text-xl font-semibold">{report.copiedAssets}</div>
                <div className="text-[11px] text-[var(--studio-muted)]">Art Assets Copied</div>
              </div>
              <div className="p-3 rounded-xl border border-[var(--studio-border)]">
                <div className="text-xl font-semibold">{report.resolvedLinks}</div>
                <div className="text-[11px] text-[var(--studio-muted)]">Wikilinks Resolved</div>
              </div>
            </div>

            {report.unresolvedLinks.length > 0 && (
              <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {report.unresolvedLinks.length} Unresolved Link(s)
                </div>
                <div className="max-h-28 overflow-y-auto text-[11px] text-[var(--studio-muted)] space-y-0.5">
                  {report.unresolvedLinks.slice(0, 15).map((u, i) => (
                    <div key={i}>
                      <strong>{u.sourceTitle}</strong> → <code>[[{u.target}]]</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 cursor-pointer"
              >
                Open World
              </button>
            </div>
          </div>
        ) : !preview ? (
          <div className="py-10 text-center rounded-2xl border border-dashed border-[var(--studio-border)] space-y-3">
            <p className="text-xs text-[var(--studio-muted)] max-w-sm mx-auto">
              Select the root folder of your Obsidian story vault. Loreloom will preserve folders, YAML frontmatter, <code className="opacity-80">[[wikilinks]]</code>, <code className="opacity-80">#tags</code>, and embedded concept art.
            </p>
            <button
              onClick={handlePickVault}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
              {busy ? 'Scanning Vault…' : 'Choose Obsidian Vault Folder'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl border border-[var(--studio-border)] bg-black/3 dark:bg-white/3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{preview.vaultName}</span>
                <button
                  onClick={handlePickVault}
                  className="text-xs text-amber-600 hover:underline cursor-pointer"
                >
                  Change folder
                </button>
              </div>
              <div className="flex items-center gap-4 text-xs text-[var(--studio-muted)]">
                <span><strong>{preview.noteCount}</strong> Markdown notes</span>
                <span><strong>{preview.imageCount}</strong> images</span>
                <span><strong>{preview.folderCount}</strong> folders</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTargetMode('new')}
                className={`py-2 rounded-lg border text-xs font-medium cursor-pointer ${
                  targetMode === 'new' ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--studio-border)]'
                }`}
              >
                Create New World
              </button>
              <button
                onClick={() => setTargetMode('existing')}
                disabled={worlds.length === 0}
                className={`py-2 rounded-lg border text-xs font-medium cursor-pointer disabled:opacity-40 ${
                  targetMode === 'existing' ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--studio-border)]'
                }`}
              >
                Import into Existing World
              </button>
            </div>

            {targetMode === 'new' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--studio-muted)] mb-1">World Name</label>
                  <input
                    value={newWorldName}
                    onChange={(e) => setNewWorldName(e.target.value)}
                    className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--studio-muted)] mb-1">Medium</label>
                    <select
                      value={newWorldMedium}
                      onChange={(e) => setNewWorldMedium(e.target.value as WorldMedium)}
                      className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-2 text-xs outline-none"
                    >
                      <option value="novel">Novel / Story</option>
                      <option value="ttrpg">Tabletop RPG</option>
                      <option value="video-game">Video Game</option>
                      <option value="film">Film / Screenplay</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--studio-muted)] mb-1">Theme Preset</label>
                    <select
                      value={newWorldPreset}
                      onChange={(e) => setNewWorldPreset(e.target.value as WorldThemePresetId)}
                      className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-2 text-xs outline-none"
                    >
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-[var(--studio-muted)] mb-1">Target World</label>
                <select
                  value={targetWorldSlug}
                  onChange={(e) => setTargetWorldSlug(e.target.value)}
                  className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-3 py-2 text-xs outline-none"
                >
                  {worlds.map((w) => (
                    <option key={w.slug} value={w.slug}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs border border-[var(--studio-border)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRunImport}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Importing Vault…' : `Import ${preview.noteCount} Notes & ${preview.imageCount} Images`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
