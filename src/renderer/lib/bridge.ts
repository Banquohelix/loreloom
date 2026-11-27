import { cloneStarterEntityTypes } from '@shared/starter-types';
import type {
  ArtAsset,
  ArtCategory,
  BacklinkRef,
  CollectionQuery,
  CreateEntryInput,
  CreateWorldInput,
  DesktopBridge,
  Entry,
  EntrySummary,
  ImportReport,
  SearchHit,
  UpdateEntryInput,
  VaultScanPreview,
  WorldConfig,
  WorkspaceConfig,
  WorkspaceState,
} from '@shared/types';
import { getDefaultWorldTheme } from '@core/theme-engine';

declare global {
  interface Window {
    loreloom?: DesktopBridge;
  }
}

/**
 * In-browser fallback adapter used only when running `vite` in a regular browser
 * outside Electron (for rapid UI preview). In Electron, `window.loreloom` is always provided.
 */
function createBrowserPreviewBridge(): DesktopBridge {
  let config: WorkspaceConfig = {
    name: 'Loreloom Preview Workspace',
    activeWorldSlug: 'shattered-crown',
    studioAppearance: 'light',
    createdAt: new Date().toISOString(),
  };

  let worlds: WorldConfig[] = [
    {
      id: 'w-1',
      slug: 'shattered-crown',
      name: 'Shattered Crown',
      subtitle: 'Dark fantasy TTRPG & novel setting',
      medium: 'ttrpg',
      theme: getDefaultWorldTheme('parchment-lorebook'),
      entityTypes: cloneStarterEntityTypes(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'w-2',
      slug: 'helion-drift',
      name: 'Helion Drift',
      subtitle: 'Deep-space salvage sci-fi game concept',
      medium: 'video-game',
      theme: getDefaultWorldTheme('scifi-slate'),
      entityTypes: cloneStarterEntityTypes(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  let entries: Entry[] = [
    {
      id: 'e-1',
      worldSlug: 'shattered-crown',
      title: 'Kael Vorn',
      slug: 'kael-vorn',
      type: 'character',
      folder: 'characters',
      relativePath: 'characters/kael-vorn.md',
      tags: ['protagonist', 'exile'],
      properties: { role: 'Disgraced Warden', faction: 'Ashbound Order', status: 'Alive' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      excerpt: 'Exiled from Iron Citadel after refusing the Cinder Edict.',
      body: 'Exiled from [[Iron Citadel]] after refusing the Cinder Edict.\n\n## Background\nKael once commanded the northern watchtowers before the sky cracked above the Ash Sea.',
    },
    {
      id: 'e-2',
      worldSlug: 'shattered-crown',
      title: 'Iron Citadel',
      slug: 'iron-citadel',
      type: 'location',
      folder: 'locations',
      relativePath: 'locations/iron-citadel.md',
      tags: ['fortress', 'capital'],
      properties: { region: 'Northern Spire', climate: 'Ash-Swept Alpine', ruler: 'Cinder Regency' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      excerpt: 'A towering black-iron bastion suspended over the Ash Sea.',
      body: 'A towering black-iron bastion suspended over the Ash Sea.\n\n> Built upon the ribs of an older, forgotten colossus.',
    },
  ];

  let artAssets: ArtAsset[] = [];
  let maps: import('@shared/types').WorldMapDef[] = [];

  const toSummary = (e: Entry): EntrySummary => ({
    id: e.id,
    worldSlug: e.worldSlug,
    title: e.title,
    slug: e.slug,
    type: e.type,
    secondaryTypes: e.secondaryTypes ?? [],
    folder: e.folder,
    relativePath: e.relativePath,
    tags: e.tags,
    properties: e.properties,
    coverAssetId: e.coverAssetId,
    portraitAssetId: e.portraitAssetId,
    updatedAt: e.updatedAt,
    excerpt: e.body.slice(0, 140),
  });

  return {
    getSavedWorkspacePath: async () => 'Preview://OneDrive/Loreloom',
    pickFolder: async () => 'Preview://OneDrive/Loreloom',
    pickImageFiles: async () => [],
    openWorkspace: async (rootPath): Promise<WorkspaceState> => ({ rootPath, config, worlds }),
    updateWorkspaceConfig: async (patch) => {
      config = { ...config, ...patch };
      return config;
    },
    rebuildIndex: async () => ({ indexedEntries: entries.length, indexedWorlds: worlds.length }),
    createWorld: async (input: CreateWorldInput) => {
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'world';
      const created: WorldConfig = {
        id: crypto.randomUUID(),
        slug,
        name: input.name,
        subtitle: input.subtitle ?? '',
        medium: input.medium,
        theme: getDefaultWorldTheme(input.preset ?? 'parchment-lorebook'),
        entityTypes: cloneStarterEntityTypes(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      worlds = [...worlds, created];
      return created;
    },
    updateWorld: async (worldSlug, patch) => {
      worlds = worlds.map((w) =>
        w.slug === worldSlug ? { ...w, ...patch, updatedAt: new Date().toISOString() } : w
      );
      return worlds.find((w) => w.slug === worldSlug)!;
    },
    deleteWorld: async (worldSlug) => {
      worlds = worlds.filter((w) => w.slug !== worldSlug);
    },
    listEntries: async (query: CollectionQuery) =>
      entries
        .filter((e) => e.worldSlug === query.worldSlug)
        .filter((e) =>
          !query.type || query.type === 'all'
            ? true
            : e.type === query.type || (e.secondaryTypes ?? []).includes(query.type)
        )
        .filter((e) =>
          query.search
            ? e.title.toLowerCase().includes(query.search.toLowerCase()) ||
              e.body.toLowerCase().includes(query.search.toLowerCase())
            : true
        )
        .map(toSummary),
    readEntry: async (worldSlug, id) =>
      entries.find((e) => e.worldSlug === worldSlug && e.id === id) ?? null,
    createEntry: async (input: CreateEntryInput) => {
      const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'untitled';
      const created: Entry = {
        id: crypto.randomUUID(),
        worldSlug: input.worldSlug,
        title: input.title,
        slug,
        type: input.type ?? 'page',
        folder: input.folder ?? '',
        relativePath: input.folder ? `${input.folder}/${slug}.md` : `${slug}.md`,
        tags: input.tags ?? [],
        properties: input.properties ?? {},
        coverAssetId: input.coverAssetId,
        portraitAssetId: input.portraitAssetId,
        body: input.body ?? '',
        excerpt: (input.body ?? '').slice(0, 140),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      entries = [created, ...entries];
      return created;
    },
    updateEntry: async (input: UpdateEntryInput) => {
      entries = entries.map((e) => {
        if (e.id !== input.id) return e;
        const body = input.body ?? e.body;
        return {
          ...e,
          title: input.title ?? e.title,
          type: input.type ?? e.type,
          secondaryTypes: input.secondaryTypes ?? e.secondaryTypes,
          folder: input.folder ?? e.folder,
          tags: input.tags ?? e.tags,
          properties: input.properties ?? e.properties,
          coverAssetId:
            input.coverAssetId === null ? undefined : input.coverAssetId ?? e.coverAssetId,
          portraitAssetId:
            input.portraitAssetId === null ? undefined : input.portraitAssetId ?? e.portraitAssetId,
          body,
          excerpt: body.slice(0, 140),
          updatedAt: new Date().toISOString(),
        };
      });
      return entries.find((e) => e.id === input.id)!;
    },
    deleteEntry: async (_worldSlug, id) => {
      entries = entries.filter((e) => e.id !== id);
    },
    getBacklinks: async (worldSlug, entryId): Promise<BacklinkRef[]> => {
      const target = entries.find((e) => e.id === entryId);
      if (!target) return [];
      return entries
        .filter(
          (e) =>
            e.worldSlug === worldSlug &&
            e.id !== entryId &&
            e.body.toLowerCase().includes(`[[${target.title.toLowerCase()}]]`)
        )
        .map((e) => ({
          sourceId: e.id,
          sourceTitle: e.title,
          sourceType: e.type,
          context: e.excerpt,
        }));
    },
    getWorldGraph: async (worldSlug) => {
      const worldEntries = entries.filter((e) => e.worldSlug === worldSlug);
      return {
        nodes: worldEntries.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          connectionCount: 0,
        })),
        edges: [],
      };
    },
    searchGlobal: async (query): Promise<SearchHit[]> =>
      entries
        .filter(
          (e) =>
            e.title.toLowerCase().includes(query.toLowerCase()) ||
            e.body.toLowerCase().includes(query.toLowerCase())
        )
        .map((e) => ({
          entryId: e.id,
          worldSlug: e.worldSlug,
          worldName: worlds.find((w) => w.slug === e.worldSlug)?.name ?? e.worldSlug,
          title: e.title,
          type: e.type,
          snippet: e.excerpt,
        })),
    listArtAssets: async (query) =>
      artAssets.filter(
        (a) =>
          a.worldSlug === query.worldSlug &&
          (!query.category || query.category === 'all' || a.category === query.category)
      ),
    importArtFiles: async () => [],
    saveArtFromBuffer: async (worldSlug, filename, base64Data, category?: ArtCategory) => {
      const asset: ArtAsset = {
        id: crypto.randomUUID(),
        worldSlug,
        filename,
        relativePath: `data:image/png;base64,${base64Data}`,
        title: filename.replace(/\.[^.]+$/, ''),
        category: category ?? 'other',
        tags: [],
        caption: '',
        createdAt: new Date().toISOString(),
      };
      artAssets = [asset, ...artAssets];
      return asset;
    },
    updateArtAsset: async (_worldSlug, assetId, patch) => {
      artAssets = artAssets.map((a) => (a.id === assetId ? { ...a, ...patch } : a));
      return artAssets.find((a) => a.id === assetId)!;
    },
    deleteArtAsset: async (_worldSlug, assetId) => {
      artAssets = artAssets.filter((a) => a.id !== assetId);
    },
    getArtLinkedEntries: async (worldSlug, assetId) =>
      entries
        .filter(
          (e) =>
            e.worldSlug === worldSlug &&
            (e.coverAssetId === assetId || e.portraitAssetId === assetId)
        )
        .map(toSummary),
    getAssetUrl: (_worldSlug, relativePath) => relativePath,
    listMaps: async (worldSlug) => maps.filter((m) => m.worldSlug === worldSlug),
    createMap: async (worldSlug, title, assetId) => {
      const now = new Date().toISOString();
      const created = {
        id: crypto.randomUUID(),
        worldSlug,
        title,
        assetId,
        pins: [],
        createdAt: now,
        updatedAt: now,
      };
      maps = [...maps, created];
      return created;
    },
    updateMap: async (_worldSlug, mapId, patch) => {
      maps = maps.map((m) =>
        m.id === mapId ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m
      );
      return maps.find((m) => m.id === mapId)!;
    },
    deleteMap: async (_worldSlug, mapId) => {
      maps = maps.filter((m) => m.id !== mapId);
    },
    scanObsidianVault: async (vaultPath): Promise<VaultScanPreview> => ({
      vaultPath,
      vaultName: 'Sample Vault',
      noteCount: 0,
      imageCount: 0,
      folderCount: 0,
      sampleFolders: [],
      frontmatterKeys: [],
    }),
    importObsidianVault: async (): Promise<ImportReport> => ({
      worldSlug: 'shattered-crown',
      worldName: 'Shattered Crown',
      importedNotes: 0,
      copiedAssets: 0,
      resolvedLinks: 0,
      unresolvedLinks: [],
      warnings: ['Obsidian import requires the Electron desktop runtime.'],
    }),
    onWorkspaceChanged: () => () => {},
    getWorldIntakeFolders: async () => [],
    setWorldIntakeFolders: async (_slug, folders) => folders,
    runWorldIntakeSync: async (worldSlug) => ({
      worldSlug,
      foldersScanned: 0,
      importedEntries: 0,
      updatedEntries: 0,
      importedArt: 0,
      needsTriageCount: 0,
      skippedUnchanged: 0,
      items: [],
      warnings: [],
      syncedAt: new Date().toISOString(),
    }),
    reclassifyTriageItems: async () => ({
      reclassifiedEntries: 0,
      reclassifiedArt: 0,
      remainingTriage: 0,
    }),
    exportWorldPromptFramework: async (worldSlug) =>
      `Preview://OneDrive/Loreloom/worlds/${worldSlug}/AI-PROMPT-FRAMEWORK.md`,
    onIntakeSynced: () => () => {},
    getAppVersion: async () => '0.4.0',
    checkForUpdates: async () => ({
      status: 'up-to-date',
      currentVersion: '0.3.0',
      latestVersion: '0.3.0',
      releaseUrl: 'https://github.com/Banquohelix/loreloom/releases',
      message: 'Preview mode is up to date.',
    }),
    downloadAndInstallUpdate: async () => {},
    hasUpdateToken: async () => false,
    setUpdateToken: async () => {},
    openExternalUrl: async (url) => {
      window.open(url, '_blank');
    },
  };
}

let cachedBridge: DesktopBridge | null = null;

export function getBridge(): DesktopBridge {
  if (typeof window !== 'undefined' && window.loreloom) {
    return window.loreloom;
  }
  if (!cachedBridge) {
    cachedBridge = createBrowserPreviewBridge();
  }
  return cachedBridge;
}

export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.loreloom);
}
