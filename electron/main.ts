import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chokidar, { type FSWatcher } from 'chokidar';
import { WorkspaceStore } from '../src/core/workspace-store';
import { IndexEngine } from '../src/core/index-engine';
import { ObsidianImporter } from '../src/core/obsidian-importer';
import type {
  ArtCategory,
  ArtQuery,
  CollectionQuery,
  CreateEntryInput,
  CreateWorldInput,
  UpdateEntryInput,
  WorldConfig,
  WorldMedium,
  WorldThemePresetId,
  WorkspaceConfig,
  WorkspaceExternalChangeEvent,
} from '../src/shared/types';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'loreloom-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let store: WorkspaceStore | null = null;
let indexEngine: IndexEngine | null = null;
let watcher: FSWatcher | null = null;
const importer = new ObsidianImporter();

interface AppSettings {
  workspacePath?: string;
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getIndexDbPath(): string {
  return path.join(app.getPath('userData'), 'index.db');
}

async function readAppSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    return JSON.parse(raw) as AppSettings;
  } catch {
    return {};
  }
}

async function writeAppSettings(settings: AppSettings): Promise<void> {
  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function requireStore(): WorkspaceStore {
  if (!store) throw new Error('Workspace not opened');
  return store;
}

function requireIndex(): IndexEngine {
  if (!indexEngine) throw new Error('LocalIndex not initialized');
  return indexEngine;
}

async function startWorkspaceWatcher(rootPath: string): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }

  let debounceTimer: NodeJS.Timeout | null = null;
  watcher = chokidar.watch(path.join(rootPath, 'worlds'), {
    ignoreInitial: true,
    ignored: /(^|[/\\])\..|\.tmp$/,
    awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 },
  });

  const handleChange = (changedPath: string) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (!store || !indexEngine) return;
      const rel = path.relative(rootPath, changedPath).replace(/\\/g, '/');
      const parts = rel.split('/');
      const worldSlug = parts[0] === 'worlds' && parts[1] ? parts[1] : undefined;

      let kind: WorkspaceExternalChangeEvent['kind'] = 'entry';
      if (rel.endsWith('world.yaml')) kind = 'world';
      else if (rel.includes('/assets/') || rel.endsWith('art-manifest.yaml')) kind = 'art';

      try {
        await indexEngine.rebuildWorkspace(store);
      } catch {
        // Ignore transient OneDrive/Google Drive lock errors
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('workspace:external-change', {
          worldSlug,
          kind,
          relativePath: rel,
        } satisfies WorkspaceExternalChangeEvent);
      }
    }, 450);
  };

  watcher.on('add', handleChange);
  watcher.on('change', handleChange);
  watcher.on('unlink', handleChange);
}

function registerIpcHandlers(): void {
  ipcMain.handle('workspace:get-saved-path', async () => {
    const settings = await readAppSettings();
    return settings.workspacePath ?? null;
  });

  ipcMain.handle('dialog:pick-folder', async (_e, title?: string) => {
    const res = await dialog.showOpenDialog({
      title: title || 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:pick-images', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select Concept Art Images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('workspace:open', async (_e, rootPath: string) => {
    store = new WorkspaceStore(rootPath);
    const state = await store.ensureInitialized();
    await writeAppSettings({ workspacePath: rootPath });

    if (indexEngine) {
      indexEngine.close();
    }
    indexEngine = new IndexEngine(getIndexDbPath());
    await indexEngine.rebuildWorkspace(store);
    await startWorkspaceWatcher(rootPath);
    return state;
  });

  ipcMain.handle('workspace:update-config', async (_e, patch: Partial<WorkspaceConfig>) => {
    return requireStore().updateWorkspaceConfig(patch);
  });

  ipcMain.handle('workspace:rebuild-index', async () => {
    return requireIndex().rebuildWorkspace(requireStore());
  });

  ipcMain.handle('world:create', async (_e, input: CreateWorldInput) => {
    const created = await requireStore().createWorld(input);
    await requireIndex().syncWorld(requireStore(), created);
    return created;
  });

  ipcMain.handle(
    'world:update',
    async (
      _e,
      worldSlug: string,
      patch: Partial<Pick<WorldConfig, 'name' | 'subtitle' | 'medium' | 'coverAssetId' | 'theme' | 'entityTypes'>>
    ) => {
      const updated = await requireStore().updateWorld(worldSlug, patch);
      await requireIndex().syncWorld(requireStore(), updated);
      return updated;
    }
  );

  ipcMain.handle('world:delete', async (_e, worldSlug: string) => {
    await requireStore().deleteWorld(worldSlug);
    requireIndex().removeWorld(worldSlug);
  });

  ipcMain.handle('entry:list', async (_e, query: CollectionQuery) => {
    return requireIndex().queryCollection(query);
  });

  ipcMain.handle('entry:read', async (_e, worldSlug: string, id: string) => {
    return requireStore().readEntryById(worldSlug, id);
  });

  ipcMain.handle('entry:create', async (_e, input: CreateEntryInput) => {
    const created = await requireStore().createEntry(input);
    const worlds = await requireStore().listWorlds();
    const world = worlds.find((w) => w.slug === input.worldSlug);
    requireIndex().upsertEntry(created, world);
    return created;
  });

  ipcMain.handle('entry:update', async (_e, input: UpdateEntryInput) => {
    const updated = await requireStore().updateEntry(input);
    const worlds = await requireStore().listWorlds();
    const world = worlds.find((w) => w.slug === input.worldSlug);
    requireIndex().upsertEntry(updated, world);
    return updated;
  });

  ipcMain.handle('entry:delete', async (_e, worldSlug: string, id: string) => {
    await requireStore().deleteEntry(worldSlug, id);
    requireIndex().removeEntry(id);
  });

  ipcMain.handle('entry:backlinks', async (_e, worldSlug: string, entryId: string) => {
    return requireIndex().getBacklinks(worldSlug, entryId);
  });

  ipcMain.handle('search:global', async (_e, query: string) => {
    return requireIndex().searchGlobal(query);
  });

  ipcMain.handle('art:list', async (_e, query: ArtQuery) => {
    let assets = await requireStore().listArtAssets(query.worldSlug);
    if (query.category && query.category !== 'all') {
      assets = assets.filter((a) => a.category === query.category);
    }
    if (query.tag && query.tag.trim()) {
      const t = query.tag.trim().toLowerCase();
      assets = assets.filter((a) => a.tags.some((x) => x.toLowerCase() === t));
    }
    if (query.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      assets = assets.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.caption.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return assets;
  });

  ipcMain.handle('art:import-files', async (_e, worldSlug: string, filePaths: string[], category?: ArtCategory) => {
    const saved = [];
    for (const fp of filePaths) {
      saved.push(await requireStore().saveArtAssetFromPath(worldSlug, fp, category ?? 'other'));
    }
    return saved;
  });

  ipcMain.handle(
    'art:save-buffer',
    async (_e, worldSlug: string, filename: string, base64Data: string, category?: ArtCategory) => {
      const buffer = Buffer.from(base64Data, 'base64');
      return requireStore().saveArtAssetFromBuffer(worldSlug, filename, buffer, category ?? 'other');
    }
  );

  ipcMain.handle('art:update', async (_e, worldSlug: string, assetId: string, patch) => {
    return requireStore().updateArtAsset(worldSlug, assetId, patch);
  });

  ipcMain.handle('art:delete', async (_e, worldSlug: string, assetId: string) => {
    await requireStore().deleteArtAsset(worldSlug, assetId);
  });

  ipcMain.handle('art:linked-entries', async (_e, worldSlug: string, assetId: string) => {
    const assets = await requireStore().listArtAssets(worldSlug);
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return [];
    return requireIndex().getEntriesLinkingAsset(worldSlug, assetId, asset.filename);
  });

  ipcMain.handle('obsidian:scan', async (_e, vaultPath: string) => {
    return importer.scanVault(vaultPath);
  });

  ipcMain.handle(
    'obsidian:import',
    async (
      _e,
      options: {
        vaultPath: string;
        targetWorldSlug?: string;
        newWorldName?: string;
        newWorldMedium?: WorldMedium;
        newWorldPreset?: WorldThemePresetId;
      }
    ) => {
      const report = await importer.importVault(requireStore(), options);
      await requireIndex().rebuildWorkspace(requireStore());
      return report;
    }
  );
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Loreloom',
    backgroundColor: '#18181b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  protocol.handle('loreloom-asset', (request) => {
    try {
      if (!store) return new Response('No workspace open', { status: 404 });
      const url = new URL(request.url);
      const worldSlug = decodeURIComponent(url.hostname);
      const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const absPath = store.resolveAssetAbsolutePath(worldSlug, relPath);
      return net.fetch(pathToFileURL(absPath).toString());
    } catch {
      return new Response('Asset not found', { status: 404 });
    }
  });

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  if (watcher) await watcher.close();
  if (indexEngine) indexEngine.close();
  if (process.platform !== 'darwin') app.quit();
});
