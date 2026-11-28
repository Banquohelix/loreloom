import { useEffect, useMemo, useState } from 'react';
import { Command, FileText, Search, X } from 'lucide-react';
import type { SearchHit } from '@shared/types';
import { getBridge } from '../lib/bridge';

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  run: () => void;
}

interface QuickSwitcherModalProps {
  commands: PaletteCommand[];
  onSelectHit: (worldSlug: string, entryId: string) => void;
  onClose: () => void;
}

export function QuickSwitcherModal({
  commands,
  onSelectHit,
  onClose,
}: QuickSwitcherModalProps) {
  const bridge = getBridge();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      if (!query.trim()) {
        setHits([]);
        return;
      }
      const res = await bridge.searchGlobal(query);
      if (active) setHits(res);
    }, 100);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, bridge]);

  const matchingCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  type PaletteRow =
    | { kind: 'command'; cmd: PaletteCommand }
    | { kind: 'hit'; hit: SearchHit };

  const rows: PaletteRow[] = useMemo(() => {
    const list: PaletteRow[] = [];
    for (const hit of hits) list.push({ kind: 'hit', hit });
    for (const cmd of matchingCommands) list.push({ kind: 'command', cmd });
    return list;
  }, [hits, matchingCommands]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, rows.length]);

  const executeRow = (row: PaletteRow | undefined) => {
    if (!row) return;
    if (row.kind === 'command') {
      onClose();
      row.cmd.run();
    } else {
      onSelectHit(row.hit.worldSlug, row.hit.entryId);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-20 p-4"
      onClick={onClose}
    >
      <div
        className="max-w-xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--studio-border)]">
          <Search className="w-4 h-4 text-[var(--studio-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => (rows.length > 0 ? (i + 1) % rows.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) =>
                  rows.length > 0 ? (i - 1 + rows.length) % rows.length : 0
                );
              } else if (e.key === 'Enter') {
                e.preventDefault();
                executeRow(rows[activeIndex]);
              }
            }}
            placeholder="Search lore across all Worlds or run a Studio command…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <button onClick={onClose} className="p-1 text-[var(--studio-muted)] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--studio-muted)]">
              No matching entries or commands for "{query}".
            </div>
          ) : (
            rows.map((row, idx) => {
              const selected = idx === activeIndex;
              if (row.kind === 'hit') {
                return (
                  <button
                    key={`hit-${row.hit.worldSlug}-${row.hit.entryId}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => executeRow(row)}
                    className={`w-full text-left px-3 py-2 rounded-xl transition cursor-pointer flex items-start gap-2.5 ${
                      selected ? 'bg-black/8 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <FileText className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{row.hit.title}</span>
                        <span className="text-[10px] text-[var(--studio-muted)] shrink-0">
                          {row.hit.worldName} · {row.hit.type}
                        </span>
                      </div>
                      {row.hit.snippet && (
                        <div className="text-xs text-[var(--studio-muted)] truncate mt-0.5">
                          {row.hit.snippet}
                        </div>
                      )}
                    </div>
                  </button>
                );
              }
              return (
                <button
                  key={`cmd-${row.cmd.id}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => executeRow(row)}
                  className={`w-full text-left px-3 py-2 rounded-xl transition cursor-pointer flex items-center justify-between gap-2 ${
                    selected ? 'bg-black/8 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2.5 text-xs font-medium">
                    <Command className="w-3.5 h-3.5 text-[var(--studio-muted)]" />
                    {row.cmd.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-[var(--studio-muted)]">
                    {row.cmd.category}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
