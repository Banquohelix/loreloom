import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Sparkles, X } from 'lucide-react';
import {
  NEEDS_TRIAGE_TAG,
  type ArtAsset,
  type BacklinkRef,
  type CreateWorldInput,
  type EntityTypeDef,
  type Entry,
  type EntrySummary,
  type StudioAppearance,
  type UpdateCheckResult,
  type WorldConfig,
  type WorldTheme,
  type WorkspaceState,
} from '@shared/types';
import {
  closeTabById,
  openViewInTabs,
  type WorkspaceTab,
} from '@shared/tab-utils';
import { resolveWorldTokens } from '@core/theme-engine';
import { getBridge } from './lib/bridge';
import { SetupWorkspaceView } from './components/SetupWorkspaceView';
import { Sidebar, type ActiveView } from './components/Sidebar';
import { WorkspaceTabBar } from './components/WorkspaceTabBar';
import { WorldOverview } from './components/WorldOverview';
import { EntryEditor } from './components/EntryEditor';
import { EntryInspector } from './components/EntryInspector';
import { CollectionView } from './components/CollectionView';
import { ArtGalleryView } from './components/ArtGalleryView';
import { WorldGraphView } from './components/WorldGraphView';
import { MapsView } from './components/MapsView';
import { MoodboardView } from './components/MoodboardView';
import { WorldThemeDrawer } from './components/WorldThemeDrawer';
import { EntityTypeModal } from './components/EntityTypeModal';
import { ObsidianImportModal } from './components/ObsidianImportModal';
import { IntakeSyncModal } from './components/IntakeSyncModal';
import { WorldToolsModal } from './components/WorldToolsModal';
import { ExportBibleModal } from './components/ExportBibleModal';
import { UpdateModal } from './components/UpdateModal';
import { QuickSwitcherModal } from './components/QuickSwitcherModal';
import { CreateWorldModal } from './components/CreateWorldModal';

export default function App() {
  const bridge = getBridge();
  const [booting, setBooting] = useState(true);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [activeWorldSlug, setActiveWorldSlug] = useState<string | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: 'tab-initial', view: { kind: 'overview' } },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-initial');
  const [splitView, setSplitView] = useState<ActiveView | null>(null);
  const [splitEntry, setSplitEntry] = useState<Entry | null>(null);

  const activeView: ActiveView = useMemo(
    () => tabs.find((t) => t.id === activeTabId)?.view ?? { kind: 'overview' },
    [tabs, activeTabId]
  );

  const setActiveView = useCallback(
    (view: ActiveView, openInNewTab = false) => {
      setTabs((prevTabs) => {
        const res = openViewInTabs(prevTabs, activeTabId, view, openInNewTab);
        setActiveTabId(res.activeTabId);
        return res.tabs;
      });
    },
    [activeTabId]
  );

  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [artAssets, setArtAssets] = useState<ArtAsset[]>([]);
  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkRef[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const [themeDrawerOpen, setThemeDrawerOpen] = useState(false);
  const [entityTypeModalOpen, setEntityTypeModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [worldToolsModalOpen, setWorldToolsModalOpen] = useState(false);
  const [exportBibleModalOpen, setExportBibleModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [createWorldModalOpen, setCreateWorldModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('0.3.0');
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

  const triageCount = useMemo(
    () =>
      entries.filter((e) => e.tags.includes(NEEDS_TRIAGE_TAG)).length +
      artAssets.filter((a) => a.tags.includes(NEEDS_TRIAGE_TAG)).length,
    [entries, artAssets]
  );

  const appearance: StudioAppearance = workspace?.config.studioAppearance ?? 'light';

  const activeWorld: WorldConfig | null = useMemo(() => {
    if (!workspace || !activeWorldSlug) return null;
    return workspace.worlds.find((w) => w.slug === activeWorldSlug) ?? null;
  }, [workspace, activeWorldSlug]);

  // Apply light/dark class on root
  useEffect(() => {
    document.documentElement.classList.toggle('dark', appearance === 'dark');
  }, [appearance]);

  // Apply active WorldTheme CSS variables
  useEffect(() => {
    if (!activeWorld) return;
    const tokens = resolveWorldTokens(activeWorld.theme, appearance);
    for (const [k, v] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(k, v);
    }
  }, [activeWorld, appearance]);

  // Global Ctrl+K quick-switcher
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickSwitcherOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadWorkspace = useCallback(
    async (rootPath: string) => {
      const state = await bridge.openWorkspace(rootPath);
      setWorkspace(state);
      const preferred =
        (state.config.activeWorldSlug &&
          state.worlds.find((w) => w.slug === state.config.activeWorldSlug)?.slug) ||
        state.worlds[0]?.slug ||
        null;
      setActiveWorldSlug(preferred);
      setActiveView({ kind: 'overview' });
    },
    [bridge]
  );

  // Boot: restore saved workspace path + check version/updates
  useEffect(() => {
    (async () => {
      try {
        const [saved, ver] = await Promise.all([
          bridge.getSavedWorkspacePath(),
          bridge.getAppVersion(),
        ]);
        setAppVersion(ver);
        if (saved) {
          await loadWorkspace(saved);
        }
        bridge
          .checkForUpdates()
          .then((res) => {
            if (res.status === 'update-available') setUpdateResult(res);
          })
          .catch(() => {});
      } finally {
        setBooting(false);
      }
    })();
  }, [bridge, loadWorkspace]);

  const refreshWorldData = useCallback(
    async (worldSlug: string) => {
      const [list, art] = await Promise.all([
        bridge.listEntries({ worldSlug, sortBy: 'updatedAt', sortDir: 'desc' }),
        bridge.listArtAssets({ worldSlug }),
      ]);
      setEntries(list);
      setArtAssets(art);
    },
    [bridge]
  );

  useEffect(() => {
    if (!activeWorldSlug) {
      setEntries([]);
      setArtAssets([]);
      return;
    }
    refreshWorldData(activeWorldSlug);
  }, [activeWorldSlug, refreshWorldData]);

  // Load full entry + backlinks when viewing an entry
  useEffect(() => {
    if (!activeWorldSlug || activeView.kind !== 'entry') {
      setCurrentEntry(null);
      setBacklinks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [entry, bl] = await Promise.all([
        bridge.readEntry(activeWorldSlug, activeView.entryId),
        bridge.getBacklinks(activeWorldSlug, activeView.entryId),
      ]);
      if (!cancelled) {
        setCurrentEntry(entry);
        setBacklinks(bl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWorldSlug, activeView, bridge]);

  // Load secondary split pane entry when split view shows an entry
  useEffect(() => {
    if (!activeWorldSlug || !splitView || splitView.kind !== 'entry') {
      setSplitEntry(null);
      return;
    }
    let cancelled = false;
    bridge
      .readEntry(activeWorldSlug, splitView.entryId)
      .then((e) => {
        if (!cancelled) setSplitEntry(e);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeWorldSlug, splitView, bridge]);

  // Live refresh when OneDrive/Google Drive syncs external file changes
  useEffect(() => {
    return bridge.onWorkspaceChanged(async (evt) => {
      if (workspace && evt.kind === 'world') {
        const state = await bridge.openWorkspace(workspace.rootPath);
        setWorkspace(state);
      }
      if (activeWorldSlug && (!evt.worldSlug || evt.worldSlug === activeWorldSlug)) {
        await refreshWorldData(activeWorldSlug);
      }
    });
  }, [bridge, workspace, activeWorldSlug, refreshWorldData]);

  // Live notification & refresh when a World's Intake Folder syncs new AI notes/art
  useEffect(() => {
    return bridge.onIntakeSynced(async (report) => {
      if (activeWorldSlug && report.worldSlug === activeWorldSlug) {
        await refreshWorldData(activeWorldSlug);
      }
      const parts: string[] = [];
      if (report.importedEntries > 0) parts.push(`${report.importedEntries} new lore`);
      if (report.updatedEntries > 0) parts.push(`${report.updatedEntries} updated`);
      if (report.importedArt > 0) parts.push(`${report.importedArt} art`);
      if (parts.length > 0) {
        setToastMessage(`Intake Sync: imported ${parts.join(', ')}`);
        window.setTimeout(() => setToastMessage(null), 5000);
      }
    });
  }, [bridge, activeWorldSlug, refreshWorldData]);

  const handleSelectWorld = async (slug: string) => {
    setActiveWorldSlug(slug);
    const resetTab: WorkspaceTab = { id: `tab-${Date.now()}`, view: { kind: 'overview' } };
    setTabs([resetTab]);
    setActiveTabId(resetTab.id);
    setSplitView(null);
    await bridge.updateWorkspaceConfig({ activeWorldSlug: slug });
  };

  const handleCreateWorld = async (input: CreateWorldInput) => {
    const created = await bridge.createWorld(input);
    setWorkspace((prev) =>
      prev ? { ...prev, worlds: [...prev.worlds, created] } : prev
    );
    await handleSelectWorld(created.slug);
  };

  const handleCreateEntry = async (
    typeId = 'page',
    initialProperties?: Record<string, import('@shared/types').EntryPropertyValue>
  ) => {
    if (!activeWorld) return;
    const et = activeWorld.entityTypes.find((t) => t.id === typeId);
    const created = await bridge.createEntry({
      worldSlug: activeWorld.slug,
      title: `Untitled ${et?.name ?? 'Entry'}`,
      type: typeId,
      folder: typeId === 'page' ? 'lore' : `${typeId}s`,
      properties: initialProperties,
    });
    await refreshWorldData(activeWorld.slug);
    setActiveView({ kind: 'entry', entryId: created.id });
  };

  const handleMoveEntryProperty = async (entryId: string, key: string, value: string) => {
    if (!activeWorld) return;
    const existing = await bridge.readEntry(activeWorld.slug, entryId);
    if (!existing) return;
    const nextProps = { ...existing.properties };
    if (value) nextProps[key] = value;
    else delete nextProps[key];
    await bridge.updateEntry({
      worldSlug: activeWorld.slug,
      id: entryId,
      properties: nextProps,
    });
    await refreshWorldData(activeWorld.slug);
  };

  const handleCreateStubEntry = async (title: string) => {
    if (!activeWorld) return;
    const created = await bridge.createEntry({
      worldSlug: activeWorld.slug,
      title,
      type: 'page',
      folder: 'lore',
      body: `# ${title}\n\n`,
    });
    await refreshWorldData(activeWorld.slug);
    setActiveView({ kind: 'entry', entryId: created.id });
  };

  const handleUpdateCurrentEntry = async (
    patch: Parameters<typeof bridge.updateEntry>[0] extends infer P
      ? Omit<P, 'worldSlug' | 'id'>
      : never
  ) => {
    if (!activeWorld || !currentEntry) return;
    const updated = await bridge.updateEntry({
      worldSlug: activeWorld.slug,
      id: currentEntry.id,
      ...patch,
    });
    setCurrentEntry(updated);
    await refreshWorldData(activeWorld.slug);
    const bl = await bridge.getBacklinks(activeWorld.slug, updated.id);
    setBacklinks(bl);
  };

  const handleUpdateSplitEntry = async (
    patch: Parameters<typeof bridge.updateEntry>[0] extends infer P
      ? Omit<P, 'worldSlug' | 'id'>
      : never
  ) => {
    if (!activeWorld || !splitEntry) return;
    const updated = await bridge.updateEntry({
      worldSlug: activeWorld.slug,
      id: splitEntry.id,
      ...patch,
    });
    setSplitEntry(updated);
    if (currentEntry && currentEntry.id === updated.id) {
      setCurrentEntry(updated);
    }
    await refreshWorldData(activeWorld.slug);
  };

  const handleCloseTab = (tabId: string) => {
    const res = closeTabById(tabs, activeTabId, tabId);
    setTabs(res.tabs);
    setActiveTabId(res.activeTabId);
  };

  const handleNewTab = () => {
    const next: WorkspaceTab = { id: `tab-${Date.now()}`, view: { kind: 'overview' } };
    setTabs((prev) => [...prev, next]);
    setActiveTabId(next.id);
  };

  const handleToggleSplit = () => {
    if (splitView) {
      setSplitView(null);
    } else {
      setSplitView(activeView.kind === 'maps' ? { kind: 'art' } : { kind: 'maps' });
    }
  };

  const handleSwapSplit = () => {
    if (!splitView) return;
    const primary = activeView;
    const secondary = splitView;
    setActiveView(secondary);
    setSplitView(primary);
  };

  const handleDeleteCurrentEntry = async () => {
    if (!activeWorld || !currentEntry) return;
    await bridge.deleteEntry(activeWorld.slug, currentEntry.id);
    await refreshWorldData(activeWorld.slug);
    setActiveView({ kind: 'overview' });
  };

  const handleChangeWorldTheme = async (theme: WorldTheme) => {
    if (!activeWorld) return;
    const updated = await bridge.updateWorld(activeWorld.slug, { theme });
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            worlds: prev.worlds.map((w) => (w.slug === updated.slug ? updated : w)),
          }
        : prev
    );
  };

  const handleAddEntityType = async (entityType: EntityTypeDef) => {
    if (!activeWorld) return;
    const updated = await bridge.updateWorld(activeWorld.slug, {
      entityTypes: [...activeWorld.entityTypes, entityType],
    });
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            worlds: prev.worlds.map((w) => (w.slug === updated.slug ? updated : w)),
          }
        : prev
    );
    setActiveView({ kind: 'collection', typeId: entityType.id });
  };

  const handleToggleAppearance = async () => {
    if (!workspace) return;
    const next: StudioAppearance = appearance === 'dark' ? 'light' : 'dark';
    const updated = await bridge.updateWorkspaceConfig({ studioAppearance: next });
    setWorkspace({ ...workspace, config: updated });
  };

  const handleChangeWorkspaceFolder = async () => {
    const folder = await bridge.pickFolder('Switch OneDrive / Google Drive Workspace Folder');
    if (folder) await loadWorkspace(folder);
  };

  if (booting) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-[var(--studio-muted)]">
        Opening Loreloom…
      </div>
    );
  }

  if (!workspace) {
    return <SetupWorkspaceView onWorkspaceSelected={loadWorkspace} />;
  }

  const activeCollectionType =
    activeWorld && activeView.kind === 'collection'
      ? activeWorld.entityTypes.find((t) => t.id === activeView.typeId) ?? null
      : null;

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[var(--studio-bg)] text-[var(--studio-text)]">
      <Sidebar
        worlds={workspace.worlds}
        activeWorld={activeWorld}
        entries={entries}
        artCount={artAssets.length}
        triageCount={triageCount}
        appVersion={appVersion}
        updateAvailableVersion={
          updateResult?.status === 'update-available' ? updateResult.latestVersion : undefined
        }
        activeView={activeView}
        studioAppearance={appearance}
        workspacePath={workspace.rootPath}
        onSelectWorld={handleSelectWorld}
        onOpenCreateWorld={() => setCreateWorldModalOpen(true)}
        onSelectView={setActiveView}
        onCreateEntry={handleCreateEntry}
        onOpenEntityTypeModal={() => setEntityTypeModalOpen(true)}
        onOpenThemeDrawer={() => setThemeDrawerOpen(true)}
        onOpenImportModal={() => setImportModalOpen(true)}
        onOpenIntakeModal={() => setIntakeModalOpen(true)}
        onOpenWorldToolsModal={() => setWorldToolsModalOpen(true)}
        onOpenExportBibleModal={() => setExportBibleModalOpen(true)}
        onOpenUpdateModal={() => setUpdateModalOpen(true)}
        onOpenQuickSwitcher={() => setQuickSwitcherOpen(true)}
        onToggleAppearance={handleToggleAppearance}
        onChangeWorkspaceFolder={handleChangeWorkspaceFolder}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {activeWorld && (
          <WorkspaceTabBar
            world={activeWorld}
            entries={entries}
            tabs={tabs}
            activeTabId={activeTabId}
            splitOpen={Boolean(splitView)}
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
            onNewTab={handleNewTab}
            onToggleSplit={handleToggleSplit}
          />
        )}

        <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
        {!activeWorld ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-semibold">Create Your First World</h1>
            <p className="text-sm text-[var(--studio-muted)] max-w-md">
              Start a new setting for your game, TTRPG, novel, or film — or import an existing Obsidian story vault.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCreateWorldModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
              >
                New World / Project
              </button>
              <button
                onClick={() => setImportModalOpen(true)}
                className="px-4 py-2.5 rounded-xl border border-[var(--studio-border)] text-xs font-medium cursor-pointer"
              >
                Import Obsidian Vault
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Primary Pane */}
            <div className="flex-1 flex min-w-0 h-full overflow-hidden">
              {activeView.kind === 'overview' ? (
                <WorldOverview
                  world={activeWorld}
                  entries={entries}
                  artAssets={artAssets}
                  onCreateEntry={handleCreateEntry}
                  onSelectEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                  onOpenArtGallery={() => setActiveView({ kind: 'art' }, true)}
                  onOpenThemeDrawer={() => setThemeDrawerOpen(true)}
                />
              ) : activeView.kind === 'art' ? (
                <ArtGalleryView
                  world={activeWorld}
                  artAssets={artAssets}
                  onRefreshArt={() => refreshWorldData(activeWorld.slug)}
                  onNavigateEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                />
              ) : activeView.kind === 'graph' ? (
                <WorldGraphView
                  world={activeWorld}
                  onSelectEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                />
              ) : activeView.kind === 'maps' ? (
                <MapsView
                  world={activeWorld}
                  entries={entries}
                  artAssets={artAssets}
                  onRefreshArt={() => refreshWorldData(activeWorld.slug)}
                  onNavigateEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                />
              ) : activeView.kind === 'moodboards' ? (
                <MoodboardView
                  world={activeWorld}
                  artAssets={artAssets}
                  onRefreshArt={() => refreshWorldData(activeWorld.slug)}
                />
              ) : activeView.kind === 'collection' && activeCollectionType ? (
                <CollectionView
                  world={activeWorld}
                  entityType={activeCollectionType}
                  entries={entries}
                  artAssets={artAssets}
                  onCreateEntry={handleCreateEntry}
                  onSelectEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                  onMoveEntryProperty={handleMoveEntryProperty}
                />
              ) : activeView.kind === 'entry' && currentEntry ? (
                <>
                  <EntryEditor
                    world={activeWorld}
                    entry={currentEntry}
                    allEntries={entries}
                    artAssets={artAssets}
                    inspectorOpen={inspectorOpen && !splitView}
                    onToggleInspector={() => setInspectorOpen((v) => !v)}
                    onSaveEntry={handleUpdateCurrentEntry}
                    onNavigateEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                    onCreateStubEntry={handleCreateStubEntry}
                  />
                  {inspectorOpen && !splitView && (
                    <EntryInspector
                      world={activeWorld}
                      entry={currentEntry}
                      allEntries={entries}
                      backlinks={backlinks}
                      onChangeType={(type) => handleUpdateCurrentEntry({ type })}
                      onChangeSecondaryTypes={(secondaryTypes) =>
                        handleUpdateCurrentEntry({ secondaryTypes })
                      }
                      onChangeFolder={(folder) => handleUpdateCurrentEntry({ folder })}
                      onUpdateProperties={(properties) =>
                        handleUpdateCurrentEntry({ properties })
                      }
                      onNavigateEntry={(entryId) =>
                        setActiveView({ kind: 'entry', entryId }, true)
                      }
                      onCreateStubEntry={handleCreateStubEntry}
                      onDeleteEntry={handleDeleteCurrentEntry}
                    />
                  )}
                </>
              ) : null}
            </div>

            {/* Secondary Side-by-Side Split Pane */}
            {splitView && (
              <div className="w-1/2 shrink-0 flex flex-col min-w-0 h-full border-l border-[var(--studio-border)] overflow-hidden">
                <div className="h-9 shrink-0 px-3 flex items-center justify-between gap-2 border-b border-[var(--studio-border)] bg-[var(--studio-sidebar)]">
                  <select
                    value={
                      splitView.kind === 'entry'
                        ? `entry:${splitView.entryId}`
                        : splitView.kind === 'collection'
                          ? `collection:${splitView.typeId}`
                          : splitView.kind
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith('entry:')) {
                        setSplitView({ kind: 'entry', entryId: v.slice(6) });
                      } else if (v.startsWith('collection:')) {
                        setSplitView({ kind: 'collection', typeId: v.slice(11) });
                      } else {
                        setSplitView({ kind: v as 'overview' | 'art' | 'graph' | 'maps' | 'moodboards' });
                      }
                    }}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2 py-1 text-xs outline-none max-w-[240px]"
                  >
                    <optgroup label="Studio Views">
                      <option value="maps">Maps</option>
                      <option value="moodboards">Moodboards</option>
                      <option value="art">Concept Art</option>
                      <option value="graph">Lore Graph</option>
                      <option value="overview">Overview</option>
                    </optgroup>
                    <optgroup label="Collections">
                      {activeWorld.entityTypes.map((et) => (
                        <option key={et.id} value={`collection:${et.id}`}>
                          {et.pluralName}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Lore Entries">
                      {entries.slice(0, 60).map((e) => (
                        <option key={e.id} value={`entry:${e.id}`}>
                          {e.title}
                        </option>
                      ))}
                    </optgroup>
                  </select>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleSwapSplit}
                      title="Swap Left & Right Panes"
                      className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-[var(--studio-muted)] cursor-pointer"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setSplitView(null)}
                      title="Close Split Pane"
                      className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-[var(--studio-muted)] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
                  {splitView.kind === 'maps' ? (
                    <MapsView
                      world={activeWorld}
                      entries={entries}
                      artAssets={artAssets}
                      onRefreshArt={() => refreshWorldData(activeWorld.slug)}
                      onNavigateEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                    />
                  ) : splitView.kind === 'moodboards' ? (
                    <MoodboardView
                      world={activeWorld}
                      artAssets={artAssets}
                      onRefreshArt={() => refreshWorldData(activeWorld.slug)}
                    />
                  ) : splitView.kind === 'art' ? (
                    <ArtGalleryView
                      world={activeWorld}
                      artAssets={artAssets}
                      onRefreshArt={() => refreshWorldData(activeWorld.slug)}
                      onNavigateEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                    />
                  ) : splitView.kind === 'graph' ? (
                    <WorldGraphView
                      world={activeWorld}
                      onSelectEntry={(entryId) => setActiveView({ kind: 'entry', entryId }, true)}
                    />
                  ) : splitView.kind === 'overview' ? (
                    <WorldOverview
                      world={activeWorld}
                      entries={entries}
                      artAssets={artAssets}
                      onCreateEntry={handleCreateEntry}
                      onSelectEntry={(entryId) => setSplitView({ kind: 'entry', entryId })}
                      onOpenArtGallery={() => setSplitView({ kind: 'art' })}
                      onOpenThemeDrawer={() => setThemeDrawerOpen(true)}
                    />
                  ) : splitView.kind === 'collection' ? (
                    (() => {
                      const colType = activeWorld.entityTypes.find(
                        (t) => t.id === splitView.typeId
                      );
                      return colType ? (
                        <CollectionView
                          world={activeWorld}
                          entityType={colType}
                          entries={entries}
                          artAssets={artAssets}
                          onCreateEntry={handleCreateEntry}
                          onSelectEntry={(entryId) => setSplitView({ kind: 'entry', entryId })}
                          onMoveEntryProperty={handleMoveEntryProperty}
                        />
                      ) : null;
                    })()
                  ) : splitView.kind === 'entry' && splitEntry ? (
                    <EntryEditor
                      world={activeWorld}
                      entry={splitEntry}
                      allEntries={entries}
                      artAssets={artAssets}
                      inspectorOpen={false}
                      onToggleInspector={() => {}}
                      onSaveEntry={handleUpdateSplitEntry}
                      onNavigateEntry={(entryId) => setSplitView({ kind: 'entry', entryId })}
                      onCreateStubEntry={handleCreateStubEntry}
                    />
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </main>

      {/* Modals & Drawers */}
      {themeDrawerOpen && activeWorld && (
        <WorldThemeDrawer
          world={activeWorld}
          onChangeTheme={handleChangeWorldTheme}
          onClose={() => setThemeDrawerOpen(false)}
        />
      )}

      {entityTypeModalOpen && activeWorld && (
        <EntityTypeModal
          onSave={handleAddEntityType}
          onClose={() => setEntityTypeModalOpen(false)}
        />
      )}

      {importModalOpen && (
        <ObsidianImportModal
          worlds={workspace.worlds}
          onImported={async (worldSlug) => {
            const refreshed = await bridge.openWorkspace(workspace.rootPath);
            setWorkspace(refreshed);
            setActiveWorldSlug(worldSlug);
            setActiveView({ kind: 'overview' });
          }}
          onClose={() => setImportModalOpen(false)}
        />
      )}

      {quickSwitcherOpen && (
        <QuickSwitcherModal
          onSelectHit={async (worldSlug, entryId) => {
            if (worldSlug !== activeWorldSlug) {
              setActiveWorldSlug(worldSlug);
            }
            setActiveView({ kind: 'entry', entryId });
          }}
          onClose={() => setQuickSwitcherOpen(false)}
        />
      )}

      {intakeModalOpen && activeWorld && (
        <IntakeSyncModal
          world={activeWorld}
          entries={entries}
          artAssets={artAssets}
          onRefreshWorld={() => refreshWorldData(activeWorld.slug)}
          onNavigateEntry={(entryId) => setActiveView({ kind: 'entry', entryId })}
          onClose={() => setIntakeModalOpen(false)}
        />
      )}

      {worldToolsModalOpen && activeWorld && (
        <WorldToolsModal
          world={activeWorld}
          onRefreshWorld={() => refreshWorldData(activeWorld.slug)}
          onClose={() => setWorldToolsModalOpen(false)}
        />
      )}

      {exportBibleModalOpen && activeWorld && (
        <ExportBibleModal
          world={activeWorld}
          defaultAppearance={appearance}
          onClose={() => setExportBibleModalOpen(false)}
        />
      )}

      {updateModalOpen && (
        <UpdateModal
          currentVersion={appVersion}
          initialResult={updateResult}
          onResultUpdated={setUpdateResult}
          onClose={() => setUpdateModalOpen(false)}
        />
      )}

      {createWorldModalOpen && (
        <CreateWorldModal
          onCreate={handleCreateWorld}
          onClose={() => setCreateWorldModalOpen(false)}
        />
      )}

      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium shadow-xl">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
