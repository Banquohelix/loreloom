import { useState } from 'react';
import { BookOpen, CheckCircle2, ExternalLink, FileDown, X } from 'lucide-react';
import type {
  ExportWorldBibleResult,
  StudioAppearance,
  WorldConfig,
} from '@shared/types';
import { getBridge } from '../lib/bridge';

interface ExportBibleModalProps {
  world: WorldConfig;
  defaultAppearance: StudioAppearance;
  onClose: () => void;
}

export function ExportBibleModal({
  world,
  defaultAppearance,
  onClose,
}: ExportBibleModalProps) {
  const bridge = getBridge();
  const [format, setFormat] = useState<'html' | 'pdf'>('pdf');
  const [appearance, setAppearance] = useState<StudioAppearance>(defaultAppearance);
  const [includeArtGallery, setIncludeArtGallery] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(world.entityTypes.filter((t) => t.id !== 'template').map((t) => t.id))
  );
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportWorldBibleResult | null>(null);

  const toggleType = (id: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    setError(null);
    setExporting(true);
    try {
      const res = await bridge.exportWorldBible({
        worldSlug: world.slug,
        format,
        includedTypeIds: Array.from(selectedTypes),
        includeArtGallery,
        appearance,
      });
      if (res) setResult(res);
    } catch (err) {
      setError((err as Error).message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="max-w-lg w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-amber-600" />
            <div>
              <h2 className="text-base font-semibold">Export World Bible — {world.name}</h2>
              <p className="text-xs text-[var(--studio-muted)]">
                Styled with your World Theme, embedded concept art & internal links
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

        {result ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">World Bible Exported!</div>
                <p className="text-xs text-[var(--studio-muted)] mt-0.5">
                  Included <strong>{result.entryCount}</strong> entries and{' '}
                  <strong>{result.artCount}</strong> concept art pieces.
                </p>
                <p className="text-[11px] font-mono text-[var(--studio-muted)] truncate mt-1">
                  {result.outputPath}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs border border-[var(--studio-border)] cursor-pointer"
              >
                Done
              </button>
              <button
                onClick={() => bridge.openLocalFile(result.outputPath)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open File
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Format */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setFormat('pdf')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  format === 'pdf'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-[var(--studio-border)]'
                }`}
              >
                <div className="text-xs font-semibold">Print-Ready PDF</div>
                <div className="text-[11px] text-[var(--studio-muted)] mt-0.5">
                  Ideal for pitch decks, TTRPG sourcebooks & sharing
                </div>
              </button>
              <button
                onClick={() => setFormat('html')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  format === 'html'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-[var(--studio-border)]'
                }`}
              >
                <div className="text-xs font-semibold">Standalone HTML Wiki</div>
                <div className="text-[11px] text-[var(--studio-muted)] mt-0.5">
                  Single portable file with TOC & clickable wikilinks
                </div>
              </button>
            </div>

            {/* Theme Mode */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--studio-muted)]">Page Theme Mode</span>
              <div className="flex items-center gap-1.5">
                {(['light', 'dark'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setAppearance(mode)}
                    className={`px-3 py-1 rounded-lg border capitalize cursor-pointer ${
                      appearance === mode
                        ? 'border-amber-500 bg-amber-500/10 font-medium'
                        : 'border-[var(--studio-border)]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Included Collections */}
            <div className="space-y-2">
              <div className="text-xs text-[var(--studio-muted)]">Collections to Include</div>
              <div className="flex flex-wrap gap-1.5">
                {world.entityTypes.map((et) => {
                  const active = selectedTypes.has(et.id);
                  return (
                    <button
                      key={et.id}
                      onClick={() => toggleType(et.id)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition cursor-pointer ${
                        active
                          ? 'border-amber-500 bg-amber-500/15 font-medium'
                          : 'border-[var(--studio-border)] text-[var(--studio-muted)]'
                      }`}
                    >
                      {active ? '✓ ' : '+ '}
                      {et.pluralName}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center justify-between p-3 rounded-xl border border-[var(--studio-border)] cursor-pointer">
              <div>
                <div className="text-xs font-medium">Include Concept Art Gallery</div>
                <div className="text-[11px] text-[var(--studio-muted)]">
                  Adds an illustrated visual showcase section at the end
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeArtGallery}
                onChange={(e) => setIncludeArtGallery(e.target.checked)}
                className="accent-amber-600 w-4 h-4"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs border border-[var(--studio-border)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || selectedTypes.size === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-40 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                {exporting ? 'Generating World Bible…' : `Export ${format.toUpperCase()}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
