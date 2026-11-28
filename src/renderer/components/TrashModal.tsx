import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Image as ImageIcon, LayoutGrid, Map as MapIcon, RotateCcw, Shapes, Trash2, X } from 'lucide-react';
import type { TrashItem, TrashKind, TrashRestoreResult, WorldConfig } from '@shared/types';
import { getBridge } from '../lib/bridge';
import { useModalA11y } from '../lib/use-modal-a11y';
import { notify, notifyError } from '../lib/notify';

interface TrashModalProps {
  world: WorldConfig;
  onRestored: (result: TrashRestoreResult) => Promise<void> | void;
  onOpenEntry: (entryId: string) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<TrashKind, string> = {
  entry: 'Entry',
  art: 'Concept art',
  map: 'Map',
  board: 'Moodboard',
  type: 'Entity type',
};

const KIND_ICON: Record<TrashKind, typeof FileText> = {
  entry: FileText,
  art: ImageIcon,
  map: MapIcon,
  board: LayoutGrid,
  type: Shapes,
};

const FILTERS: Array<{ id: TrashKind | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'entry', label: 'Entries' },
  { id: 'art', label: 'Art' },
  { id: 'map', label: 'Maps' },
  { id: 'board', label: 'Moodboards' },
  { id: 'type', label: 'Types' },
];

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

/** Deleted entries, art, maps, moodboards and types for one World, with Restore. */
export function TrashModal({ world, onRestored, onOpenEntry, onClose }: TrashModalProps) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);
  const bridge = getBridge();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TrashKind | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastRestored, setLastRestored] = useState<TrashRestoreResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await bridge.listTrash(world.slug));
    } catch (err) {
      notifyError('Could not read the Trash', err);
    } finally {
      setLoading(false);
    }
  }, [bridge, world.slug]);

  useEffect(() => {
    load();
  }, [load]);

  // The last item of the filtered kind was restored or deleted: its tab is gone, so show everything
  const activeFilter = filter !== 'all' && !items.some((i) => i.kind === filter) ? 'all' : filter;
  const visible = useMemo(
    () => (activeFilter === 'all' ? items : items.filter((i) => i.kind === activeFilter)),
    [items, activeFilter]
  );
  const counts = useMemo(() => {
    const c: Partial<Record<TrashKind | 'all', number>> = { all: items.length };
    for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [items]);

  const handleRestore = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      const result = await bridge.restoreTrashItem(world.slug, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setLastRestored(result);
      await onRestored(result);
      notify(
        result.renamed
          ? `Restored "${result.title}" under a new name, because the old one is in use.`
          : `Restored "${result.title}".`
      );
    } catch (err) {
      notifyError(`Could not restore "${item.title}"`, err);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteForever = async (item: TrashItem) => {
    const ok = window.confirm(
      `Delete "${item.title}" forever?\n\nThis removes it from the Trash permanently and cannot be undone.`
    );
    if (!ok) return;
    setBusyId(item.id);
    try {
      await bridge.deleteTrashItemForever(world.slug, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      notifyError(`Could not delete "${item.title}"`, err);
    } finally {
      setBusyId(null);
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
        aria-label={`Trash for ${world.name}`}
        tabIndex={-1}
        className="max-w-2xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-4 max-h-[86vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Trash2 className="w-5 h-5 text-[var(--studio-muted)]" />
            <div>
              <h2 className="text-base font-semibold">Trash — {world.name}</h2>
              <p className="text-xs text-[var(--studio-muted)]">
                Deleted items stay here, in the World's synced <code>.trash</code> folder, until you delete them forever.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div role="tablist" aria-label="Filter by kind" className="flex flex-wrap gap-1.5 shrink-0">
          {FILTERS.filter((f) => f.id === 'all' || counts[f.id]).map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={activeFilter === f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeFilter === f.id
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {f.label} ({counts[f.id] ?? 0})
            </button>
          ))}
        </div>

        {lastRestored?.kind === 'entry' && lastRestored.restoredId && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs shrink-0">
            <span>Restored "{lastRestored.title}".</span>
            <button
              onClick={() => {
                onOpenEntry(lastRestored.restoredId);
                onClose();
              }}
              className="font-medium underline underline-offset-2 cursor-pointer"
            >
              Open it
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {loading ? (
            <p className="text-xs text-[var(--studio-muted)] py-8 text-center">Reading the Trash…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-[var(--studio-muted)] py-10 text-center">The Trash is empty.</p>
          ) : (
            <ul className="divide-y divide-[var(--studio-border)]" aria-label="Deleted items">
              {visible.map((item) => {
                const Icon = KIND_ICON[item.kind];
                const busy = busyId === item.id;
                return (
                  <li key={item.id} className="flex items-center gap-3 py-2.5">
                    <Icon className="w-4 h-4 shrink-0 text-[var(--studio-muted)]" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-[11px] text-[var(--studio-muted)] truncate">
                        {KIND_LABEL[item.kind]} · deleted {timeAgo(item.deletedAt)} ·{' '}
                        <span title={item.originalName}>{item.originalName}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={busy}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-[var(--studio-border)] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore
                    </button>
                    <button
                      onClick={() => handleDeleteForever(item)}
                      disabled={busy}
                      aria-label={`Delete ${item.title} forever`}
                      title="Delete forever"
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
