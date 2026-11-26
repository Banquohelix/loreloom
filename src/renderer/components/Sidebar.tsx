import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderInput,
  FolderSync,
  Image as ImageIcon,
  LayoutGrid,
  Moon,
  Palette,
  Plus,
  Search,
  Settings2,
  Sun,
} from 'lucide-react';
import type { EntrySummary, StudioAppearance, WorldConfig } from '@shared/types';
import { EntityIcon } from './IconBadge';

export type ActiveView =
  | { kind: 'overview' }
  | { kind: 'art' }
  | { kind: 'collection'; typeId: string }
  | { kind: 'entry'; entryId: string };

interface SidebarProps {
  worlds: WorldConfig[];
  activeWorld: WorldConfig | null;
  entries: EntrySummary[];
  artCount: number;
  triageCount: number;
  appVersion: string;
  updateAvailableVersion?: string;
  activeView: ActiveView;
  studioAppearance: StudioAppearance;
  workspacePath: string;
  onSelectWorld: (slug: string) => void;
  onOpenCreateWorld: () => void;
  onSelectView: (view: ActiveView) => void;
  onCreateEntry: (typeId?: string) => void;
  onOpenEntityTypeModal: () => void;
  onOpenThemeDrawer: () => void;
  onOpenImportModal: () => void;
  onOpenIntakeModal: () => void;
  onOpenUpdateModal: () => void;
  onOpenQuickSwitcher: () => void;
  onToggleAppearance: () => void;
  onChangeWorkspaceFolder: () => void;
}

export function Sidebar({
  worlds,
  activeWorld,
  entries,
  artCount,
  triageCount,
  appVersion,
  updateAvailableVersion,
  activeView,
  studioAppearance,
  workspacePath,
  onSelectWorld,
  onOpenCreateWorld,
  onSelectView,
  onCreateEntry,
  onOpenEntityTypeModal,
  onOpenThemeDrawer,
  onOpenImportModal,
  onOpenIntakeModal,
  onOpenUpdateModal,
  onOpenQuickSwitcher,
  onToggleAppearance,
  onChangeWorkspaceFolder,
}: SidebarProps) {
  const [worldMenuOpen, setWorldMenuOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  const countsByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      map[e.type] = (map[e.type] || 0) + 1;
    }
    return map;
  }, [entries]);

  const folderGroups = useMemo(() => {
    const groups = new Map<string, EntrySummary[]>();
    for (const e of entries) {
      const key = e.folder || 'Root';
      const arr = groups.get(key) ?? [];
      arr.push(e);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folder]: !prev[folder] }));
  };

  return (
    <aside className="w-64 shrink-0 h-full flex flex-col border-r border-[var(--studio-border)] bg-[var(--studio-sidebar)] select-none">
      {/* World Switcher */}
      <div className="p-3 border-b border-[var(--studio-border)] relative">
        <button
          onClick={() => setWorldMenuOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition text-left cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: activeWorld?.theme.accentColor ?? '#d97706' }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {activeWorld ? activeWorld.name : 'Select a World'}
              </div>
              <div className="text-[11px] text-[var(--studio-muted)] truncate">
                {activeWorld ? activeWorld.medium.replace('-', ' ') : 'No worlds yet'}
              </div>
            </div>
          </div>
          <ChevronDown className="w-4 h-4 text-[var(--studio-muted)] shrink-0" />
        </button>

        {worldMenuOpen && (
          <div className="absolute left-3 right-3 top-16 z-40 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-lg p-1.5">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
              Worlds & Projects
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {worlds.map((w) => (
                <button
                  key={w.slug}
                  onClick={() => {
                    onSelectWorld(w.slug);
                    setWorldMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition cursor-pointer ${
                    activeWorld?.slug === w.slug
                      ? 'bg-black/8 dark:bg-white/10 font-medium'
                      : 'hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: w.theme.accentColor }}
                  />
                  <span className="truncate">{w.name}</span>
                </button>
              ))}
            </div>
            <div className="my-1.5 border-t border-[var(--studio-border)]" />
            <button
              onClick={() => {
                setWorldMenuOpen(false);
                onOpenCreateWorld();
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New World / Project
            </button>
          </div>
        )}
      </div>

      {/* Quick Search & New Entry */}
      <div className="p-2.5 flex items-center gap-1.5">
        <button
          onClick={onOpenQuickSwitcher}
          className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] transition cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" />
            Quick find…
          </span>
          <kbd className="text-[10px] px-1 py-0.5 rounded bg-black/5 dark:bg-white/10">Ctrl K</kbd>
        </button>
        {activeWorld && (
          <button
            onClick={() => onCreateEntry('page')}
            title="New Lore Entry"
            className="p-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Nav */}
      {activeWorld && (
        <div className="flex-1 overflow-y-auto px-2.5 pb-4 space-y-5">
          {/* Studio Views */}
          <div className="space-y-0.5">
            <button
              onClick={() => onSelectView({ kind: 'overview' })}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition cursor-pointer ${
                activeView.kind === 'overview'
                  ? 'bg-black/8 dark:bg-white/10 font-medium'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Overview
            </button>
            <button
              onClick={() => onSelectView({ kind: 'art' })}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition cursor-pointer ${
                activeView.kind === 'art'
                  ? 'bg-black/8 dark:bg-white/10 font-medium'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <ImageIcon className="w-4 h-4" />
                Concept Art
              </span>
              <span className="text-xs text-[var(--studio-muted)]">{artCount}</span>
            </button>
          </div>

          {/* Collections */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
                Collections
              </span>
              <button
                onClick={onOpenEntityTypeModal}
                title="Add Custom Entity Type"
                className="p-0.5 rounded hover:bg-black/8 dark:hover:bg-white/10 text-[var(--studio-muted)] hover:text-[var(--studio-text)] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {activeWorld.entityTypes.map((et) => {
                const isActive =
                  activeView.kind === 'collection' && activeView.typeId === et.id;
                return (
                  <button
                    key={et.id}
                    onClick={() => onSelectView({ kind: 'collection', typeId: et.id })}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition cursor-pointer ${
                      isActive
                        ? 'bg-black/8 dark:bg-white/10 font-medium'
                        : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <span style={{ color: et.color }}>
                        <EntityIcon name={et.icon} className="w-4 h-4" />
                      </span>
                      <span className="truncate">{et.pluralName}</span>
                    </span>
                    <span className="text-xs text-[var(--studio-muted)]">
                      {countsByType[et.id] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lore Tree */}
          <div>
            <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
              Lore Tree
            </div>
            {folderGroups.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-[var(--studio-muted)]">
                No entries yet. Click + to write your first page.
              </div>
            ) : (
              <div className="space-y-1">
                {folderGroups.map(([folder, items]) => {
                  const collapsed = Boolean(collapsedFolders[folder]);
                  return (
                    <div key={folder}>
                      <button
                        onClick={() => toggleFolder(folder)}
                        className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-[var(--studio-muted)] hover:text-[var(--studio-text)] cursor-pointer"
                      >
                        {collapsed ? (
                          <ChevronRight className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                        <Folder className="w-3.5 h-3.5 opacity-70" />
                        <span className="truncate">{folder}</span>
                      </button>
                      {!collapsed && (
                        <div className="pl-4 space-y-0.5 mt-0.5">
                          {items.map((item) => {
                            const isActive =
                              activeView.kind === 'entry' && activeView.entryId === item.id;
                            return (
                              <button
                                key={item.id}
                                onClick={() => onSelectView({ kind: 'entry', entryId: item.id })}
                                className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs text-left truncate transition cursor-pointer ${
                                  isActive
                                    ? 'bg-black/8 dark:bg-white/10 font-medium text-[var(--studio-text)]'
                                    : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
                                }`}
                              >
                                <span className="truncate">{item.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="p-2.5 border-t border-[var(--studio-border)] space-y-1">
        {activeWorld && (
          <>
            <button
              onClick={onOpenIntakeModal}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <FolderSync className="w-3.5 h-3.5" />
                Intake Folder Sync
              </span>
              {triageCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-amber-500 text-white">
                  {triageCount}
                </span>
              )}
            </button>
            <button
              onClick={onOpenThemeDrawer}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              <Palette className="w-3.5 h-3.5" />
              World Theme & Style
            </button>
          </>
        )}
        <button
          onClick={onOpenImportModal}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
        >
          <FolderInput className="w-3.5 h-3.5" />
          Import Obsidian Vault
        </button>
        <button
          onClick={onOpenUpdateModal}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Download className="w-3.5 h-3.5" />
            Check for Updates
          </span>
          {updateAvailableVersion ? (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-emerald-600 text-white">
              v{updateAvailableVersion}
            </span>
          ) : (
            <span className="text-[10px] opacity-60">v{appVersion}</span>
          )}
        </button>
        <div className="flex items-center justify-between pt-1 px-1">
          <button
            onClick={onChangeWorkspaceFolder}
            title={workspacePath}
            className="flex items-center gap-1.5 text-[11px] text-[var(--studio-muted)] hover:text-[var(--studio-text)] truncate max-w-[165px] cursor-pointer"
          >
            <Settings2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{workspacePath.split(/[\\/]/).pop() || 'Workspace'}</span>
          </button>
          <button
            onClick={onToggleAppearance}
            title={`Switch to ${studioAppearance === 'dark' ? 'Light' : 'Dark'} mode`}
            className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-[var(--studio-muted)] hover:text-[var(--studio-text)] cursor-pointer"
          >
            {studioAppearance === 'dark' ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
