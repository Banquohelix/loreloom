import { useState } from 'react';
import { Cloud, FolderOpen, Sparkles, ShieldCheck, Layers } from 'lucide-react';
import { getBridge } from '../lib/bridge';

interface SetupWorkspaceViewProps {
  onWorkspaceSelected: (rootPath: string) => Promise<void>;
}

export function SetupWorkspaceView({ onWorkspaceSelected }: SetupWorkspaceViewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChooseFolder = async () => {
    setError(null);
    try {
      const folder = await getBridge().pickFolder(
        'Choose your OneDrive or Google Drive folder for Loreloom'
      );
      if (!folder) return;
      setLoading(true);
      await onWorkspaceSelected(folder);
    } catch (err) {
      setError((err as Error).message || 'Could not open workspace folder.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--studio-bg)]">
      <div className="max-w-xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-amber-600/15 text-amber-600 flex items-center justify-center">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to Loreloom</h1>
            <p className="text-sm text-[var(--studio-muted)]">
              Clean worldbuilding studio & concept art archive
            </p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-[var(--studio-muted)] mb-6">
          Choose a folder inside your synced <strong className="text-[var(--studio-text)]">OneDrive</strong> or{' '}
          <strong className="text-[var(--studio-text)]">Google Drive</strong> directory. Loreloom stores every lore
          page as a clean Markdown file and keeps your concept art in an organized <code className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">assets/</code> folder so any PC stays in sync safely.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-7">
          <div className="rounded-xl border border-[var(--studio-border)] p-3.5">
            <Cloud className="w-4 h-4 text-amber-600 mb-2" />
            <div className="text-xs font-medium mb-0.5">Multi-PC Sync</div>
            <div className="text-xs text-[var(--studio-muted)]">
              OneDrive & Google Drive safe file-per-entry format
            </div>
          </div>
          <div className="rounded-xl border border-[var(--studio-border)] p-3.5">
            <Layers className="w-4 h-4 text-amber-600 mb-2" />
            <div className="text-xs font-medium mb-0.5">Multi-World</div>
            <div className="text-xs text-[var(--studio-muted)]">
              Separate themes, collections & galleries per IP
            </div>
          </div>
          <div className="rounded-xl border border-[var(--studio-border)] p-3.5">
            <ShieldCheck className="w-4 h-4 text-amber-600 mb-2" />
            <div className="text-xs font-medium mb-0.5">Zero Lock-In</div>
            <div className="text-xs text-[var(--studio-muted)]">
              Human-readable Markdown & Obsidian vault import
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={handleChooseFolder}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium text-sm py-3 px-4 hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
        >
          <FolderOpen className="w-4 h-4" />
          {loading ? 'Initializing Workspace…' : 'Select OneDrive / Google Drive Workspace Folder'}
        </button>
      </div>
    </div>
  );
}
