import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { SearchHit } from '@shared/types';
import { getBridge } from '../lib/bridge';

interface QuickSwitcherModalProps {
  onSelectHit: (worldSlug: string, entryId: string) => void;
  onClose: () => void;
}

export function QuickSwitcherModal({ onSelectHit, onClose }: QuickSwitcherModalProps) {
  const bridge = getBridge();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      if (!query.trim()) {
        setHits([]);
        return;
      }
      const res = await bridge.searchGlobal(query);
      if (active) setHits(res);
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, bridge]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-24 p-4"
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
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && hits[0]) {
                onSelectHit(hits[0].worldSlug, hits[0].entryId);
                onClose();
              }
            }}
            placeholder="Search lore, characters, locations across all Worlds…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <button onClick={onClose} className="p-1 text-[var(--studio-muted)] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="py-10 text-center text-xs text-[var(--studio-muted)]">
              Type to search full-text across every World in your Workspace.
            </div>
          ) : hits.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--studio-muted)]">
              No matching entries for "{query}".
            </div>
          ) : (
            <div className="space-y-1">
              {hits.map((hit) => (
                <button
                  key={`${hit.worldSlug}-${hit.entryId}`}
                  onClick={() => {
                    onSelectHit(hit.worldSlug, hit.entryId);
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{hit.title}</span>
                    <span className="text-[10px] text-[var(--studio-muted)] shrink-0">
                      {hit.worldName} · {hit.type}
                    </span>
                  </div>
                  {hit.snippet && (
                    <div className="text-xs text-[var(--studio-muted)] truncate mt-0.5">
                      {hit.snippet}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
