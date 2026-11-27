import {
  Columns2,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Map as MapIcon,
  Network,
  Plus,
  X,
} from 'lucide-react';
import type { EntrySummary, WorldConfig } from '@shared/types';
import type { WorkspaceTab } from '@shared/tab-utils';
import type { ActiveView } from './Sidebar';

interface WorkspaceTabBarProps {
  world: WorldConfig;
  entries: EntrySummary[];
  tabs: WorkspaceTab[];
  activeTabId: string;
  splitOpen: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onToggleSplit: () => void;
}

export function getViewLabel(
  view: ActiveView,
  world: WorldConfig,
  entries: EntrySummary[]
): string {
  switch (view.kind) {
    case 'overview':
      return 'Overview';
    case 'art':
      return 'Concept Art';
    case 'graph':
      return 'Lore Graph';
    case 'maps':
      return 'Maps';
    case 'moodboards':
      return 'Moodboards';
    case 'collection':
      return world.entityTypes.find((t) => t.id === view.typeId)?.pluralName ?? 'Collection';
    case 'entry':
      return entries.find((e) => e.id === view.entryId)?.title ?? 'Entry';
  }
}

function ViewIcon({ view }: { view: ActiveView }) {
  switch (view.kind) {
    case 'overview':
      return <LayoutGrid className="w-3.5 h-3.5 shrink-0" />;
    case 'art':
      return <ImageIcon className="w-3.5 h-3.5 shrink-0" />;
    case 'graph':
      return <Network className="w-3.5 h-3.5 shrink-0" />;
    case 'maps':
      return <MapIcon className="w-3.5 h-3.5 shrink-0" />;
    case 'moodboards':
      return <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />;
    default:
      return <FileText className="w-3.5 h-3.5 shrink-0" />;
  }
}

export function WorkspaceTabBar({
  world,
  entries,
  tabs,
  activeTabId,
  splitOpen,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleSplit,
}: WorkspaceTabBarProps) {
  return (
    <div className="h-10 shrink-0 flex items-center justify-between gap-2 px-2 border-b border-[var(--studio-border)] bg-[var(--studio-sidebar)] select-none">
      <div className="flex items-center gap-1 overflow-x-auto min-w-0 py-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const label = getViewLabel(tab.view, world, entries);
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs max-w-[190px] transition cursor-pointer shrink-0 ${
                active
                  ? 'bg-[var(--studio-surface)] text-[var(--studio-text)] font-medium shadow-xs border border-[var(--studio-border)]'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <ViewIcon view={tab.view} />
              <span className="truncate">{label}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                  title="Close Tab"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={onNewTab}
          title="Open New Tab"
          className="p-1.5 rounded-lg text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <button
        onClick={onToggleSplit}
        title={splitOpen ? 'Close Split View' : 'Open Side-by-Side Split View'}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer shrink-0 ${
          splitOpen
            ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
            : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        <Columns2 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{splitOpen ? 'Split On' : 'Split'}</span>
      </button>
    </div>
  );
}
