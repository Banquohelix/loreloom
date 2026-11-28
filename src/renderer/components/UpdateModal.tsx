import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import type { UpdateCheckResult } from '@shared/types';
import { getBridge } from '../lib/bridge';
import { useModalA11y } from '../lib/use-modal-a11y';

interface UpdateModalProps {
  currentVersion: string;
  initialResult: UpdateCheckResult | null;
  onResultUpdated: (result: UpdateCheckResult) => void;
  onClose: () => void;
}

export function UpdateModal({
  currentVersion,
  initialResult,
  onResultUpdated,
  onClose,
}: UpdateModalProps) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);
  const bridge = getBridge();
  const [result, setResult] = useState<UpdateCheckResult | null>(initialResult);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenBox, setShowTokenBox] = useState(false);

  const runCheck = async () => {
    setError(null);
    setChecking(true);
    try {
      const res = await bridge.checkForUpdates();
      setResult(res);
      onResultUpdated(res);
      if (res.status === 'auth-required') {
        setShowTokenBox(true);
      }
    } catch (err) {
      setError((err as Error).message || 'Could not check for updates.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    bridge.hasUpdateToken().then(setHasToken).catch(() => {});
    if (!initialResult) {
      runCheck();
    }
  }, []);

  const handleSaveToken = async () => {
    await bridge.setUpdateToken(tokenInput.trim() || null);
    setHasToken(Boolean(tokenInput.trim()));
    setTokenInput('');
    setShowTokenBox(false);
    await runCheck();
  };

  const handleClearToken = async () => {
    await bridge.setUpdateToken(null);
    setHasToken(false);
  };

  const handleInstall = async () => {
    if (!result?.installerApiUrl || !result.installerFilename) {
      await bridge.openExternalUrl(result?.releaseUrl || 'https://github.com/Banquohelix/loreloom/releases');
      return;
    }
    setError(null);
    setInstalling(true);
    try {
      await bridge.downloadAndInstallUpdate(result.installerApiUrl, result.installerFilename);
    } catch (err) {
      setError((err as Error).message || 'Download failed.');
      setInstalling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Loreloom updates"
        tabIndex={-1}
        className="max-w-lg w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-amber-600" />
            <div>
              <h2 className="text-base font-semibold">Loreloom Updates</h2>
              <p className="text-xs text-[var(--studio-muted)]">
                Installed version: <strong>v{currentVersion}</strong>
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

        {checking ? (
          <div className="py-8 text-center text-xs text-[var(--studio-muted)] flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Checking GitHub Releases…
          </div>
        ) : result?.status === 'update-available' ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 space-y-1">
              <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                Update Available: v{result.latestVersion}
              </div>
              <p className="text-xs text-[var(--studio-muted)]">
                Your workspace, worlds, and settings will be preserved during upgrade.
              </p>
            </div>

            {result.releaseNotes && (
              <div className="p-3 rounded-xl border border-[var(--studio-border)] bg-black/3 dark:bg-white/3 max-h-40 overflow-y-auto text-xs whitespace-pre-wrap text-[var(--studio-muted)]">
                {result.releaseNotes}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => bridge.openExternalUrl(result.releaseUrl)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--studio-border)] text-xs cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on GitHub
              </button>
              <button
                onClick={handleInstall}
                disabled={installing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                {installing ? 'Downloading Installer…' : `Download & Install v${result.latestVersion}`}
              </button>
            </div>
          </div>
        ) : result?.status === 'up-to-date' ? (
          <div className="p-4 rounded-xl border border-[var(--studio-border)] flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="text-xs">
              <div className="font-medium">You're up to date!</div>
              <div className="text-[var(--studio-muted)]">{result.message}</div>
            </div>
          </div>
        ) : result ? (
          <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-3">
            <p className="text-xs text-[var(--studio-muted)] leading-relaxed">{result.message}</p>
            <button
              onClick={() => bridge.openExternalUrl(result.releaseUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] text-xs font-medium cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open GitHub Releases Page
            </button>
          </div>
        ) : null}

        {/* Private Repo Token Configuration */}
        <div className="pt-3 border-t border-[var(--studio-border)] space-y-2.5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowTokenBox((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {hasToken ? 'Private Repo Token Saved (Change)' : 'Configure Private Repo Token'}
            </button>
            <button
              onClick={runCheck}
              disabled={checking}
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 hover:underline cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
              Check Again
            </button>
          </div>

          {showTokenBox && (
            <div className="space-y-2 p-3 rounded-xl border border-[var(--studio-border)] bg-black/3 dark:bg-white/3">
              <p className="text-[11px] text-[var(--studio-muted)]">
                Stored only on this PC in AppData (never synced). Use a fine-grained GitHub token with <strong>Contents: Read-only</strong> on <code>Banquohelix/loreloom</code>.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="github_pat_..."
                  className="flex-1 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none"
                />
                <button
                  onClick={handleSaveToken}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
                >
                  Save
                </button>
                {hasToken && (
                  <button
                    onClick={handleClearToken}
                    className="px-2.5 py-1.5 rounded-lg border border-[var(--studio-border)] text-xs text-red-500 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
