import { useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderInput,
  FolderSync,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Map as MapIcon,
  Moon,
  Network,
  Palette,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  Bot,
  Sun,
} from 'lucide-react';
import type { EntrySummary, StudioAppearance, WorldConfig } from '@shared/types';
import type { ActiveView } from '@shared/tab-utils';
import { EntityIcon } from './IconBadge';


const FOLDER_PAGE = 150;
/** Recent pages shown in the sidebar (more are kept for Ctrl+K). */
const SIDEBAR_RECENTS = 5;
export type { ActiveView };

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
  /** Favorited pages of the active World, in the order they were added */
  favoriteEntries: EntrySummary[];
  /** Recently opened pages of the active World, newest first */
  recentEntries: EntrySummary[];
  onToggleFavorite: (entryId: string) => void;
  onCreateEntry: (typeId?: string) => void;
  onOpenEntityTypeModal: () => void;
  onOpenThemeDrawer: () => void;
  onOpenImportModal: () => void;
  onOpenIntakeModal: () => void;
  onOpenWorldToolsModal: () => void;
  onOpenTrash: () => void;
  onOpenAiAssistants: () => void;
  onOpenExportBibleModal: () => void;
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
  favoriteEntries,
  recentEntries,
  onToggleFavorite,
  onCreateEntry,
  onOpenEntityTypeModal,
  onOpenThemeDrawer,
  onOpenImportModal,
  onOpenIntakeModal,
  onOpenWorldToolsModal,
  onOpenTrash,
  onOpenAiAssistants,
  onOpenExportBibleModal,
  onOpenUpdateModal,
  onOpenQuickSwitcher,
  onToggleAppearance,
  onChangeWorkspaceFolder,
}: SidebarProps) {
  const [worldMenuOpen, setWorldMenuOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  /** Large folders render the first FOLDER_PAGE entries until expanded (keeps the tree fast at 1000s of entries). */
  const [fullyShownFolders, setFullyShownFolders] = useState<Record<string, boolean>>({});

  const countsByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      map[e.type] = (map[e.type] || 0) + 1;
      for (const sec of e.secondaryTypes ?? []) {
        if (sec !== e.type) {
          map[sec] = (map[sec] || 0) + 1;
        }
      }
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

  const favoriteIds = useMemo(() => new Set(favoriteEntries.map((e) => e.id)), [favoriteEntries]);
  const typeById = useMemo(() => new Map((activeWorld?.entityTypes ?? []).map((t) => [t.id, t])), [activeWorld]);

  /** One page row in Favorites or Recent: type icon, title, and a star that appears on hover. */
  const pageRow = (entry: EntrySummary, section: string) => {
    const isActive = activeView.kind === 'entry' && activeView.entryId === entry.id;
    const isFavorite = favoriteIds.has(entry.id);
    const type = typeById.get(entry.type);
    return (
      <div
        key={`${section}-${entry.id}`}
        className={`group flex items-center rounded-lg transition ${
          isActive
            ? 'bg-black/8 dark:bg-white/10 font-medium text-[var(--studio-text)]'
            : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        <button
          onClick={() => onSelectView({ kind: 'entry', entryId: entry.id })}
          title={entry.title}
          className="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-left cursor-pointer"
        >
          <span className="shrink-0" style={{ color: type?.color }}>
            <EntityIcon name={type?.icon ?? 'FileText'} className="w-4 h-4" />
          </span>
          <span className="truncate">{entry.title}</span>
        </button>
        <button
          onClick={() => onToggleFavorite(entry.id)}
          title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
          aria-label={`${isFavorite ? 'Remove' : 'Add'} ${entry.title} ${isFavorite ? 'from' : 'to'} Favorites`}
          className={`shrink-0 mr-1 p-1 rounded cursor-pointer hover:bg-black/8 dark:hover:bg-white/10 focus:opacity-100 ${
            isFavorite && section === 'recent' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          } ${isFavorite ? 'text-amber-500' : ''}`}
        >
          <Star className="w-3.5 h-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

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
            <button
              onClick={() => onSelectView({ kind: 'graph' })}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition cursor-pointer ${
                activeView.kind === 'graph'
                  ? 'bg-black/8 dark:bg-white/10 font-medium'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <Network className="w-4 h-4" />
              Lore Graph
            </button>
            <button
              onClick={() => onSelectView({ kind: 'maps' })}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition cursor-pointer ${
                activeView.kind === 'maps'
                  ? 'bg-black/8 dark:bg-white/10 font-medium'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <MapIcon className="w-4 h-4" />
              Maps
            </button>
            <button
              onClick={() => onSelectView({ kind: 'moodboards' })}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition cursor-pointer ${
                activeView.kind === 'moodboards'
                  ? 'bg-black/8 dark:bg-white/10 font-medium'
                  : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Moodboards
            </button>
          </div>

          {favoriteEntries.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
                Favorites
              </div>
              <div className="space-y-0.5">{favoriteEntries.map((e) => pageRow(e, 'favorite'))}</div>
            </div>
          )}

          {recentEntries.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
                Recent
              </div>
              <div className="space-y-0.5">{recentEntries.slice(0, SIDEBAR_RECENTS).map((e) => pageRow(e, 'recent'))}</div>
            </div>
          )}

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
                          {(fullyShownFolders[folder] ? items : items.slice(0, FOLDER_PAGE)).map((item) => {
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
                          {!fullyShownFolders[folder] && items.length > FOLDER_PAGE && (
                            <button
                              onClick={() => setFullyShownFolders((prev) => ({ ...prev, [folder]: true }))}
                              className="w-full px-2 py-1 rounded-md text-xs text-left text-amber-600 hover:underline cursor-pointer"
                            >
                              Show all {items.length} entries
                            </button>
                          )}
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
              onClick={onOpenWorldToolsModal}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Cleanup & Auto-Link
            </button>
            <button
              onClick={onOpenTrash}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Trash
            </button>
            <button
              onClick={onOpenAiAssistants}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              <Bot className="w-3.5 h-3.5" />
              AI Assistants
            </button>
            <button
              onClick={onOpenExportBibleModal}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Export World Bible
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
