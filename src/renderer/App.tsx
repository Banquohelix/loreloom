import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type UpdateEntryResult,
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
import { flushAllPendingSaves } from './lib/pending-saves';
import { friendlyErrorMessage, onNotice } from './lib/notify';
import { useKeyedDebouncedSaver } from './lib/debounced-saver';
import { SetupWorkspaceView } from './components/SetupWorkspaceView';
import { Sidebar, type ActiveView } from './components/Sidebar';
import { WorkspaceTabBar } from './components/WorkspaceTabBar';
import { WorldOverview } from './components/WorldOverview';
import { EntryEditor, type EntrySavePatch } from './components/EntryEditor';
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
import { TrashModal } from './components/TrashModal';
import { AiAssistantsModal } from './components/AiAssistantsModal';
import { ExportBibleModal } from './components/ExportBibleModal';
import { UpdateModal } from './components/UpdateModal';
import { QuickSwitcherModal, type PaletteCommand } from './components/QuickSwitcherModal';
import { CreateWorldModal } from './components/CreateWorldModal';
import { NewEntryModal, type NewEntryChoice } from './components/NewEntryModal';
import { TEMPLATE_TYPE_DEF, TEMPLATE_TYPE_ID, applyTemplate, templateFromEntry, templatesForType } from '@shared/templates';

/** "Open Questions" → "open-questions" (used as the default folder for a type's new entries). */
function folderNameForType(pluralName: string): string {
  return (
    pluralName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'lore'
  );
}

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

  // Refs hold the latest tab state so setActiveView has a stable identity: callbacks created in
  // earlier renders (palette commands, loadWorkspace) can never act on an outdated tab list.
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const applyTabs = useCallback((nextTabs: WorkspaceTab[], nextActiveId: string) => {
    tabsRef.current = nextTabs;
    activeTabIdRef.current = nextActiveId;
    setTabs(nextTabs);
    setActiveTabId(nextActiveId);
  }, []);
  const setActiveView = useCallback(
    (view: ActiveView, openInNewTab = false) => {
      const res = openViewInTabs(tabsRef.current, activeTabIdRef.current, view, openInNewTab);
      applyTabs(res.tabs, res.activeTabId);
    },
    [applyTabs]
  );
  /** Closes every tab (and the split pane) showing this entry, e.g. after it was deleted. */
  const closeTabsForEntry = useCallback(
    (entryId: string) => {
      const keep = tabsRef.current.filter((t) => !(t.view.kind === 'entry' && t.view.entryId === entryId));
      if (keep.length === 0) {
        const fresh: WorkspaceTab = { id: `tab-${Date.now()}`, view: { kind: 'overview' } };
        applyTabs([fresh], fresh.id);
      } else {
        const activeStillOpen = keep.some((t) => t.id === activeTabIdRef.current);
        applyTabs(keep, activeStillOpen ? activeTabIdRef.current : keep[keep.length - 1].id);
      }
      setSplitView((sv) => (sv && sv.kind === 'entry' && sv.entryId === entryId ? null : sv));
    },
    [applyTabs]
  );

  const [entries, setEntries] = useState<EntrySummary[]>([]);
  /** Set when the active tab's entry no longer exists (deleted here, on another PC, or in a sync). */
  const [missingEntryId, setMissingEntryId] = useState<string | null>(null);
  const [artAssets, setArtAssets] = useState<ArtAsset[]>([]);
  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkRef[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const [themeDrawerOpen, setThemeDrawerOpen] = useState(false);
  /** null = closed; 'new' = create; otherwise the id of the EntityType being edited */
  const [entityTypeModal, setEntityTypeModal] = useState<'new' | string | null>(null);
  const [newEntryRequest, setNewEntryRequest] = useState<{
    typeId: string;
    initialProperties?: Record<string, import('@shared/types').EntryPropertyValue>;
  } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [worldToolsModalOpen, setWorldToolsModalOpen] = useState(false);
  const [trashModalOpen, setTrashModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [exportBibleModalOpen, setExportBibleModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [createWorldModalOpen, setCreateWorldModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((message: string, ms = 5000, isError = /^could not|failed|error/i.test(message)) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastIsError(isError);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), ms);
  }, []);

  // Surface failures instead of swallowing them: component notices, plus any unhandled rejection
  useEffect(() => {
    const offNotice = onNotice((n) => showToast(n.message, n.durationMs ?? (n.kind === 'error' ? 9000 : 5000), n.kind === 'error'));
    const onUnhandled = (e: PromiseRejectionEvent) => {
      showToast(`Something went wrong: ${friendlyErrorMessage(e.reason)}`, 9000, true);
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => {
      offNotice();
      window.removeEventListener('unhandledrejection', onUnhandled);
    };
  }, [showToast]);
  const saveQueueRef = useRef(new Map<string, Promise<UpdateEntryResult | null>>());
  const currentEntryRef = useRef<Entry | null>(null);
  const entriesRef = useRef<EntrySummary[]>([]);
  const splitEntryRef = useRef<Entry | null>(null);
  const activeWorldSlugRef = useRef<string | null>(null);
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

  currentEntryRef.current = currentEntry;
  entriesRef.current = entries;
  splitEntryRef.current = splitEntry;
  activeWorldSlugRef.current = activeWorldSlug;

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
    [bridge, setActiveView]
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
          try {
            await loadWorkspace(saved);
          } catch (err) {
            // e.g. OneDrive not signed in yet, folder moved, or drive disconnected
            setBootError(
              `Loreloom couldn't open your saved workspace at "${saved}": ${friendlyErrorMessage(err)}. ` +
                'Check that the folder exists and OneDrive / Google Drive is running, or choose the folder again.'
            );
          }
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
      const entryId = activeView.entryId;
      const [entry, bl] = await Promise.all([
        bridge.readEntry(activeWorldSlug, entryId).catch(() => null),
        bridge.getBacklinks(activeWorldSlug, entryId).catch(() => []),
      ]);
      if (!cancelled) {
        setCurrentEntry(entry);
        setBacklinks(bl);
        setMissingEntryId(entry ? null : entryId);
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
        if (cancelled) return;
        setSplitEntry(e);
        if (!e) {
          setSplitView(null);
          showToast('That entry no longer exists, so the split pane was closed.');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeWorldSlug, splitView, bridge, showToast]);

  // Re-read open entries so edits synced from another PC (or intake) reach the editor.
  // The editor only applies them when it has no unsaved local edits.
  const reloadOpenEntries = useCallback(
    async (worldSlug: string) => {
      const reload = async (prev: Entry | null, set: (e: Entry) => void, onMissing: (id: string) => void) => {
        if (!prev || prev.worldSlug !== worldSlug) return;
        const fresh = await bridge.readEntry(worldSlug, prev.id).catch(() => undefined);
        if (fresh === null) {
          onMissing(prev.id);
          return;
        }
        if (fresh && (fresh.body !== prev.body || fresh.title !== prev.title || fresh.updatedAt !== prev.updatedAt)) {
          set(fresh);
        }
      };
      await Promise.all([
        reload(
          currentEntryRef.current,
          (fresh) => setCurrentEntry((cur) => (cur && cur.id === fresh.id ? fresh : cur)),
          (id) => {
            setCurrentEntry((cur) => (cur && cur.id === id ? null : cur));
            setMissingEntryId(id);
          }
        ),
        reload(
          splitEntryRef.current,
          (fresh) => setSplitEntry((cur) => (cur && cur.id === fresh.id ? fresh : cur)),
          (id) => {
            setSplitEntry((cur) => (cur && cur.id === id ? null : cur));
            setSplitView((sv) => (sv && sv.kind === 'entry' && sv.entryId === id ? null : sv));
          }
        ),
      ]);
    },
    [bridge]
  );

  // Live refresh when OneDrive/Google Drive syncs external file changes
  useEffect(() => {
    return bridge.onWorkspaceChanged(async (evt) => {
      if (workspace && evt.kind === 'world') {
        const worlds = await bridge.listWorlds().catch(() => null);
        if (worlds) setWorkspace((prev) => (prev ? { ...prev, worlds } : prev));
      }
      if (activeWorldSlug && (!evt.worldSlug || evt.worldSlug === activeWorldSlug)) {
        await refreshWorldData(activeWorldSlug);
        if (evt.kind === 'entry') await reloadOpenEntries(activeWorldSlug);
      }
    });
  }, [bridge, workspace, activeWorldSlug, refreshWorldData, reloadOpenEntries]);

  // An AI assistant changed something over MCP: refresh, reload open entries, and say what happened
  useEffect(() => {
    return bridge.onMcpActivity(async (activity) => {
      const who = activity.client && !/bridge|node|undici/i.test(activity.client) ? activity.client : 'An AI assistant';
      showToast(`${who} ${activity.action} "${activity.title}"`);
      if (activeWorldSlug && activity.worldSlug === activeWorldSlug) {
        await refreshWorldData(activeWorldSlug);
        if (activity.kind === 'entry') await reloadOpenEntries(activeWorldSlug);
      }
    });
  }, [bridge, activeWorldSlug, refreshWorldData, reloadOpenEntries, showToast]);

  // Flush debounced editor saves before the window closes
  useEffect(() => bridge.onBeforeClose(() => flushAllPendingSaves()), [bridge]);

  // Live notification & refresh when a World's Intake Folder syncs new AI notes/art
  useEffect(() => {
    return bridge.onIntakeSynced(async (report) => {
      if (activeWorldSlug && report.worldSlug === activeWorldSlug) {
        await refreshWorldData(activeWorldSlug);
        await reloadOpenEntries(activeWorldSlug);
      }
      const parts: string[] = [];
      if (report.importedEntries > 0) parts.push(`${report.importedEntries} new lore`);
      if (report.updatedEntries > 0) parts.push(`${report.updatedEntries} updated`);
      if (report.importedArt > 0) parts.push(`${report.importedArt} art`);
      if (parts.length > 0) {
        showToast(`Intake Sync: imported ${parts.join(', ')}`);
      }
    });
  }, [bridge, activeWorldSlug, refreshWorldData, reloadOpenEntries, showToast]);

  /** Switches World: tabs and the split pane belong to a World, so they reset; the choice is remembered. */
  const switchWorld = useCallback(
    async (slug: string, initialView: ActiveView = { kind: 'overview' }) => {
      setActiveWorldSlug(slug);
      const resetTab: WorkspaceTab = { id: `tab-${Date.now()}`, view: initialView };
      applyTabs([resetTab], resetTab.id);
      setSplitView(null);
      setMissingEntryId(null);
      await bridge.updateWorkspaceConfig({ activeWorldSlug: slug }).catch(() => {});
    },
    [applyTabs, bridge]
  );
  const handleSelectWorld = (slug: string) => switchWorld(slug);

  const handleCreateWorld = async (input: CreateWorldInput) => {
    const created = await bridge.createWorld(input);
    setWorkspace((prev) =>
      prev ? { ...prev, worlds: [...prev.worlds, created] } : prev
    );
    await handleSelectWorld(created.slug);
  };

  /** Creates the entry right away, optionally copying a template, and opens it. */
  const createEntryNow = async (
    choice: NewEntryChoice,
    initialProperties?: Record<string, import('@shared/types').EntryPropertyValue>
  ) => {
    if (!activeWorld) return;
    const et = activeWorld.entityTypes.find((t) => t.id === choice.typeId);
    const template = choice.templateId ? await bridge.readEntry(activeWorld.slug, choice.templateId) : null;
    const fromTemplate = template
      ? applyTemplate(template, { title: choice.title, typeId: choice.typeId, typeName: et?.name ?? 'Entry' })
      : {};
    const created = await bridge.createEntry({
      worldSlug: activeWorld.slug,
      title: choice.title,
      type: choice.typeId,
      folder:
        choice.typeId === 'page'
          ? 'lore'
          : choice.typeId === TEMPLATE_TYPE_ID
            ? 'templates'
            : folderNameForType(et?.pluralName ?? `${choice.typeId}s`),
      ...fromTemplate,
      properties: { ...(fromTemplate.properties ?? {}), ...(initialProperties ?? {}) },
    });
    await refreshWorldData(activeWorld.slug);
    setActiveView({ kind: 'entry', entryId: created.id });
  };

  /** New entry of a type: opens the template picker when that type has templates, else creates a blank one. */
  const handleCreateEntry = async (
    typeId = 'page',
    initialProperties?: Record<string, import('@shared/types').EntryPropertyValue>
  ) => {
    if (!activeWorld) return;
    if (typeId !== TEMPLATE_TYPE_ID && templatesForType(entries, typeId).length > 0) {
      setNewEntryRequest({ typeId, initialProperties });
      return;
    }
    const et = activeWorld.entityTypes.find((t) => t.id === typeId);
    await createEntryNow({ typeId, title: `Untitled ${et?.name ?? 'Entry'}`, templateId: null }, initialProperties);
  };

  /** Copies the open entry into the Templates collection (created on first use). */
  const handleSaveAsTemplate = async () => {
    if (!activeWorld || !currentEntry) return;
    if (!activeWorld.entityTypes.some((t) => t.id === TEMPLATE_TYPE_ID)) {
      await saveEntityTypes([...activeWorld.entityTypes, TEMPLATE_TYPE_DEF]);
    }
    const typeName = activeWorld.entityTypes.find((t) => t.id === currentEntry.type)?.name ?? 'Entry';
    const created = await bridge.createEntry({ worldSlug: activeWorld.slug, ...templateFromEntry(currentEntry, typeName) });
    await refreshWorldData(activeWorld.slug);
    showToast(`Saved "${created.title}". New ${typeName} entries can now start from it.`);
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

  /**
   * Saves a patch to a specific entry. Saves to the same entry are queued so they never interleave,
   * and the reply only updates panes that still show that entry (no jumping back to a stale page).
   */
  const updateEntryById = useCallback(
    (worldSlug: string, entryId: string, patch: EntrySavePatch): Promise<UpdateEntryResult | null> => {
      const queue = saveQueueRef.current;
      const key = `${worldSlug}:${entryId}`;
      const previous = queue.get(key) ?? Promise.resolve(null);
      const run = previous
        .catch(() => null)
        .then(async () => {
          try {
            // Links still resolve by the old title until the save lands, so count them first
            const previousTitle = entriesRef.current.find((e) => e.id === entryId)?.title;
            const isRename =
              patch.title !== undefined && previousTitle !== undefined && patch.title.trim() !== previousTitle;
            const linksToOldTitle = isRename
              ? await bridge.getBacklinks(worldSlug, entryId).catch(() => [])
              : [];

            const updated = await bridge.updateEntry({ worldSlug, id: entryId, ...patch });
            const { conflictCopy, ...entry } = updated;
            setCurrentEntry((cur) => (cur && cur.id === entry.id ? entry : cur));
            setSplitEntry((cur) => (cur && cur.id === entry.id ? entry : cur));
            if (conflictCopy) {
              showToast(
                `"${entry.title}" changed on another device. Your edit was saved as "${conflictCopy.title}".`,
                9000
              );
            }

            if (isRename && previousTitle && linksToOldTitle.length > 0) {
              const sources = new Set(linksToOldTitle.map((b) => b.sourceId)).size;
              const ok = window.confirm(
                `Update links to the renamed page?\n\n${sources} ${sources === 1 ? 'page links' : 'pages link'} to [[${previousTitle}]]. Change them to [[${entry.title}]]?`
              );
              if (ok) {
                const res = await bridge.renameEntryLinks(worldSlug, entryId, previousTitle);
                showToast(`Updated links in ${res.updatedEntries} ${res.updatedEntries === 1 ? 'page' : 'pages'}.`);
              }
            }

            if (activeWorldSlugRef.current === worldSlug) {
              if (conflictCopy || isRename) {
                await refreshWorldData(worldSlug);
              } else {
                // Patch the one summary instead of re-fetching every entry and art asset per keystroke
                const { body: _body, createdAt: _createdAt, extraFrontmatter: _extra, ...summary } = entry;
                setEntries((prev) => [summary, ...prev.filter((e) => e.id !== summary.id)]);
              }
              if (currentEntryRef.current?.id === entryId) {
                const bl = await bridge.getBacklinks(worldSlug, entryId);
                if (currentEntryRef.current?.id === entryId) setBacklinks(bl);
              }
            }
            return updated;
          } catch (err) {
            showToast(`Could not save: ${(err as Error).message}`, 9000);
            return null;
          }
        });
      queue.set(key, run);
      run.finally(() => {
        if (queue.get(key) === run) queue.delete(key);
      });
      return run;
    },
    [bridge, refreshWorldData, showToast]
  );

  const handleUpdateCurrentEntry = async (patch: EntrySavePatch) => {
    if (!currentEntry) return;
    await updateEntryById(currentEntry.worldSlug, currentEntry.id, patch);
  };

  const handleCloseTab = (tabId: string) => {
    const res = closeTabById(tabsRef.current, activeTabIdRef.current, tabId);
    applyTabs(res.tabs, res.activeTabId);
  };

  const handleNewTab = () => {
    const next: WorkspaceTab = { id: `tab-${Date.now()}`, view: { kind: 'overview' } };
    applyTabs([...tabsRef.current, next], next.id);
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
    const ok = window.confirm(
      `Delete "${currentEntry.title}"?\n\nIt moves to this World's Trash, where you can restore it.`
    );
    if (!ok) return;
    const deletedId = currentEntry.id;
    await bridge.deleteEntry(activeWorld.slug, deletedId);
    await refreshWorldData(activeWorld.slug);
    closeTabsForEntry(deletedId);
    showToast(`Moved "${currentEntry.title}" to the Trash.`);
  };

  // Theme changes apply instantly; dragging the colour picker writes world.yaml once you pause
  const scheduleThemeSave = useKeyedDebouncedSaver<WorldTheme>(
    (worldSlug, theme) => bridge.updateWorld(worldSlug, { theme }),
    350,
    (err) => showToast(`Could not save the World theme: ${(err as Error).message}`, 8000)
  );
  const handleChangeWorldTheme = async (theme: WorldTheme) => {
    if (!activeWorld) return;
    const slug = activeWorld.slug;
    setWorkspace((prev) =>
      prev ? { ...prev, worlds: prev.worlds.map((w) => (w.slug === slug ? { ...w, theme } : w)) } : prev
    );
    scheduleThemeSave(slug, theme);
  };

  const saveEntityTypes = async (nextTypes: EntityTypeDef[]) => {
    if (!activeWorld) return;
    const updated = await bridge.updateWorld(activeWorld.slug, { entityTypes: nextTypes });
    setWorkspace((prev) =>
      prev ? { ...prev, worlds: prev.worlds.map((w) => (w.slug === updated.slug ? updated : w)) } : prev
    );
  };

  const handleSaveEntityType = async (entityType: EntityTypeDef) => {
    if (!activeWorld) return;
    const exists = activeWorld.entityTypes.some((t) => t.id === entityType.id);
    await saveEntityTypes(
      exists
        ? activeWorld.entityTypes.map((t) => (t.id === entityType.id ? entityType : t))
        : [...activeWorld.entityTypes, entityType]
    );
    if (!exists) setActiveView({ kind: 'collection', typeId: entityType.id });
  };

  const handleDeleteEntityType = async (typeId: string) => {
    if (!activeWorld) return;
    await saveEntityTypes(activeWorld.entityTypes.filter((t) => t.id !== typeId));
    if (activeView.kind === 'collection' && activeView.typeId === typeId) setActiveView({ kind: 'overview' });
    showToast('Type deleted. Entries that used it keep their files and text.');
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

  const handleExportWorldZip = async () => {
    if (!activeWorld) return;
    const res = await bridge.exportWorldZip(activeWorld.slug);
    if (res) {
      showToast(`Backed up ${activeWorld.name} to ${res.outputPath.split(/[\\/]/).pop()}`);
    }
  };

  // Built fresh on each render while the palette is open, so commands never use stale handlers
  const buildPaletteCommands = (): PaletteCommand[] => {
    const list: PaletteCommand[] = [];
    if (activeWorld) {
      list.push(
        { id: 'new-entry', label: 'Create New Lore Page', category: 'Create', run: () => handleCreateEntry('page') },
        {
          id: 'new-from-template',
          label: 'New Entry from Template…',
          category: 'Create',
          run: () =>
            setNewEntryRequest({
              typeId: activeView.kind === 'collection' && activeView.typeId !== TEMPLATE_TYPE_ID ? activeView.typeId : 'page',
            }),
        },
        { id: 'toggle-split', label: splitView ? 'Close Split-Pane View' : 'Open Side-by-Side Split View', category: 'Layout', run: handleToggleSplit },
        { id: 'go-overview', label: 'Go to World Overview', category: 'Navigate', run: () => setActiveView({ kind: 'overview' }) },
        { id: 'go-art', label: 'Go to Concept Art Gallery', category: 'Navigate', run: () => setActiveView({ kind: 'art' }) },
        { id: 'go-graph', label: 'Go to Interactive Lore Graph', category: 'Navigate', run: () => setActiveView({ kind: 'graph' }) },
        { id: 'go-maps', label: 'Go to Interactive Pin Maps', category: 'Navigate', run: () => setActiveView({ kind: 'maps' }) },
        { id: 'go-moodboards', label: 'Go to Visual Moodboards', category: 'Navigate', run: () => setActiveView({ kind: 'moodboards' }) },
        { id: 'intake', label: 'Open Intake Folder Sync & AI Framework', category: 'Tools', run: () => setIntakeModalOpen(true) },
        { id: 'hygiene', label: 'Open World Cleanup & Art Auto-Linker', category: 'Tools', run: () => setWorldToolsModalOpen(true) },
        { id: 'trash', label: 'Open Trash (restore deleted items)', category: 'Tools', run: () => setTrashModalOpen(true) },
        { id: 'ai-assistants', label: 'AI Assistants (connect Claude, Cursor, OpenCode, Grok Build, ChatGPT)', category: 'Tools', run: () => setAiModalOpen(true) },
        { id: 'export-bible', label: 'Export Illustrated World Bible (PDF / HTML)', category: 'Export', run: () => setExportBibleModalOpen(true) },
        { id: 'backup-zip', label: `Backup "${activeWorld.name}" as .zip Snapshot`, category: 'Export', run: handleExportWorldZip },
        { id: 'theme', label: 'Customize World Theme & Style', category: 'Appearance', run: () => setThemeDrawerOpen(true) }
      );
    }
    list.push(
      { id: 'new-world', label: 'Create New World / Project', category: 'Workspace', run: () => setCreateWorldModalOpen(true) },
      { id: 'import-obsidian', label: 'Import Obsidian Story Vault', category: 'Workspace', run: () => setImportModalOpen(true) },
      { id: 'toggle-appearance', label: `Switch to ${appearance === 'dark' ? 'Light' : 'Dark'} Mode`, category: 'Appearance', run: handleToggleAppearance },
      { id: 'check-updates', label: 'Check for Loreloom Updates', category: 'App', run: () => setUpdateModalOpen(true) }
    );
    return list;
  };

  if (booting) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-[var(--studio-muted)]">
        Opening Loreloom…
      </div>
    );
  }

  if (!workspace) {
    return <SetupWorkspaceView onWorkspaceSelected={loadWorkspace} initialError={bootError} />;
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
        onOpenEntityTypeModal={() => setEntityTypeModal('new')}
        onOpenThemeDrawer={() => setThemeDrawerOpen(true)}
        onOpenImportModal={() => setImportModalOpen(true)}
        onOpenIntakeModal={() => setIntakeModalOpen(true)}
        onOpenWorldToolsModal={() => setWorldToolsModalOpen(true)}
        onOpenTrash={() => setTrashModalOpen(true)}
        onOpenAiAssistants={() => setAiModalOpen(true)}
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
            onSelectTab={(tabId) => applyTabs(tabsRef.current, tabId)}
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
                  onEditType={(typeId) => setEntityTypeModal(typeId)}
                />
              ) : activeView.kind === 'entry' && !currentEntry && missingEntryId === activeView.entryId ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <p className="text-sm font-medium">This entry no longer exists.</p>
                  <p className="text-xs text-[var(--studio-muted)] max-w-sm">
                    It was deleted or moved, here or on another device. Deleted entries can be restored
                    from the World's Trash.
                  </p>
                  <button
                    onClick={() => closeTabsForEntry(activeView.entryId)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
                  >
                    Close tab
                  </button>
                </div>
              ) : activeView.kind === 'entry' && currentEntry ? (
                <>
                  <EntryEditor
                    key={`primary-${currentEntry.id}`}
                    world={activeWorld}
                    entry={currentEntry}
                    allEntries={entries}
                    artAssets={artAssets}
                    inspectorOpen={inspectorOpen && !splitView}
                    onToggleInspector={() => setInspectorOpen((v) => !v)}
                    onSaveEntry={(patch) =>
                      updateEntryById(currentEntry.worldSlug, currentEntry.id, patch)
                    }
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
                      onUpdateRelationships={(relationships) =>
                        handleUpdateCurrentEntry({ relationships })
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
                      onSaveAsTemplate={handleSaveAsTemplate}
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
                      {[...entries].sort((a, b) => a.title.localeCompare(b.title)).map((e) => (
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
                  onEditType={(typeId) => setEntityTypeModal(typeId)}
                        />
                      ) : null;
                    })()
                  ) : splitView.kind === 'entry' && splitEntry ? (
                    <EntryEditor
                      key={`split-${splitEntry.id}`}
                      world={activeWorld}
                      entry={splitEntry}
                      allEntries={entries}
                      artAssets={artAssets}
                      inspectorOpen={false}
                      onToggleInspector={() => {}}
                      onSaveEntry={(patch) =>
                        updateEntryById(splitEntry.worldSlug, splitEntry.id, patch)
                      }
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

      {entityTypeModal && activeWorld && (
        <EntityTypeModal
          key={entityTypeModal}
          initial={entityTypeModal === 'new' ? undefined : activeWorld.entityTypes.find((t) => t.id === entityTypeModal)}
          existingTypes={activeWorld.entityTypes}
          usageCount={
            entityTypeModal === 'new'
              ? 0
              : entries.filter((e) => e.type === entityTypeModal || (e.secondaryTypes ?? []).includes(entityTypeModal)).length
          }
          onSave={handleSaveEntityType}
          onDelete={handleDeleteEntityType}
          onClose={() => setEntityTypeModal(null)}
        />
      )}

      {importModalOpen && (
        <ObsidianImportModal
          worlds={workspace.worlds}
          onImported={async (worldSlug) => {
            const worlds = await bridge.listWorlds();
            setWorkspace((prev) => (prev ? { ...prev, worlds } : prev));
            await switchWorld(worldSlug);
          }}
          onClose={() => setImportModalOpen(false)}
        />
      )}

      {quickSwitcherOpen && (
        <QuickSwitcherModal
          commands={buildPaletteCommands()}
          onSelectHit={async (worldSlug, entryId) => {
            if (worldSlug !== activeWorldSlug) {
              // Opening an entry in another World resets the tabs to that World
              await switchWorld(worldSlug, { kind: 'entry', entryId });
            } else {
              setActiveView({ kind: 'entry', entryId }, true);
            }
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

      {newEntryRequest && activeWorld && (
        <NewEntryModal
          world={activeWorld}
          entries={entries}
          initialTypeId={newEntryRequest.typeId}
          onCreate={async (choice) => {
            await createEntryNow(choice, newEntryRequest.initialProperties);
            setNewEntryRequest(null);
          }}
          onClose={() => setNewEntryRequest(null)}
        />
      )}

      {aiModalOpen && <AiAssistantsModal onClose={() => setAiModalOpen(false)} />}

      {trashModalOpen && activeWorld && (
        <TrashModal
          world={activeWorld}
          onRestored={async (result) => {
            if (result.kind === 'type') {
              const worlds = await bridge.listWorlds().catch(() => null);
              if (worlds) setWorkspace((prev) => (prev ? { ...prev, worlds } : prev));
            }
            await refreshWorldData(activeWorld.slug);
          }}
          onOpenEntry={(entryId) => setActiveView({ kind: 'entry', entryId })}
          onClose={() => setTrashModalOpen(false)}
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
        <div
          role={toastIsError ? 'alert' : 'status'}
          aria-live={toastIsError ? 'assertive' : 'polite'}
          className={`fixed bottom-5 right-5 z-50 max-w-md flex items-start gap-3 px-4 py-2.5 rounded-xl text-xs font-medium shadow-xl ${
            toastIsError
              ? 'bg-red-600 text-white'
              : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
          }`}
        >
          <span className="flex-1">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            aria-label="Dismiss notification"
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
