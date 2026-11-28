import { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import chokidar, { type FSWatcher } from 'chokidar';
import { WorkspaceStore } from '../src/core/workspace-store';
import { IndexEngine } from '../src/core/index-engine';
import { ObsidianImporter } from '../src/core/obsidian-importer';
import { IntakeEngine } from '../src/core/intake-engine';
import { KeyedMutex } from '../src/core/keyed-mutex';
import { checkLatestGitHubRelease } from '../src/core/update-checker';
import {
  findArtLinkSuggestions,
  findDuplicateGroups,
  mergeDuplicateEntries,
} from '../src/core/world-hygiene';
import { buildWorldBibleHtml } from '../src/core/bible-exporter';
import { generateWorldPromptFramework } from '../src/shared/prompt-framework';
import type {
  ArtCategory,
  ArtQuery,
  CollectionQuery,
  CreateEntryInput,
  CreateWorldInput,
  IntakeSyncReport,
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
const intakeWatchers = new Map<string, FSWatcher>();
const importer = new ObsidianImporter();
const intakeEngine = new IntakeEngine();
/** One intake sync per World at a time (launch catch-up, watcher, and manual runs used to race). */
const intakeLocks = new KeyedMutex();
let closeAfterFlush = false;
const wikilinkRepairDone = new Set<string>();

interface AppSettings {
  workspacePath?: string;
  worldIntakeFolders?: Record<string, string[]>;
  githubUpdateToken?: string;
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

async function runWorldIntakeSyncAndNotify(worldSlug: string): Promise<IntakeSyncReport> {
  return intakeLocks.run(`intake:${worldSlug}`, () => runWorldIntakeSyncUnlocked(worldSlug));
}

async function runWorldIntakeSyncUnlocked(worldSlug: string): Promise<IntakeSyncReport> {
  const s = requireStore();
  const idx = requireIndex();
  const settings = await readAppSettings();
  const folders = settings.worldIntakeFolders?.[worldSlug] ?? [];
  const worlds = await s.listWorlds();
  const world = worlds.find((w) => w.slug === worldSlug);
  if (!world) {
    throw new Error(`World not found: ${worldSlug}`);
  }

  const report = await intakeEngine.syncWorldIntake(s, world, folders);
  if (report.importedEntries > 0 || report.updatedEntries > 0) {
    await idx.syncWorld(s, world);
  }
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    (report.importedEntries > 0 || report.updatedEntries > 0 || report.importedArt > 0)
  ) {
    mainWindow.webContents.send('intake:synced', report);
  }
  return report;
}

async function refreshIntakeWatchers(): Promise<void> {
  for (const w of intakeWatchers.values()) {
    await w.close();
  }
  intakeWatchers.clear();

  if (!store) return;
  const settings = await readAppSettings();
  const map = settings.worldIntakeFolders ?? {};

  for (const [worldSlug, folders] of Object.entries(map)) {
    if (!folders || folders.length === 0) continue;
    let debounceTimer: NodeJS.Timeout | null = null;
    const w = chokidar.watch(folders, {
      ignoreInitial: true,
      ignored: /(^|[/\\])(\.|node_modules|_imported)|\.tmp$/,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 150 },
    });

    const trigger = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        runWorldIntakeSyncAndNotify(worldSlug).catch(() => {});
      }, 650);
    };

    w.on('add', trigger);
    w.on('change', trigger);
    intakeWatchers.set(worldSlug, w);
  }
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

    // Repair `\[\[wikilinks\]\]` escaped by the <= 0.6.5 editor before indexing or intake runs
    if (!wikilinkRepairDone.has(rootPath)) {
      wikilinkRepairDone.add(rootPath);
      for (const world of state.worlds) {
        await store.repairEscapedWikilinksInWorld(world.slug).catch(() => 0);
      }
    }
    const existingSettings = await readAppSettings();
    await writeAppSettings({ ...existingSettings, workspacePath: rootPath });

    if (indexEngine) {
      indexEngine.close();
    }
    indexEngine = new IndexEngine(getIndexDbPath());
    await indexEngine.rebuildWorkspace(store);
    await startWorkspaceWatcher(rootPath);
    await refreshIntakeWatchers();

    // Catch-up intake sync on launch for any Worlds with linked drop folders
    const intakeMap = existingSettings.worldIntakeFolders ?? {};
    for (const world of state.worlds) {
      if ((intakeMap[world.slug]?.length ?? 0) > 0) {
        runWorldIntakeSyncAndNotify(world.slug).catch(() => {});
      }
    }

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
    const s = requireStore();
    const updated = await s.updateEntry(input);
    const worlds = await s.listWorlds();
    const world = worlds.find((w) => w.slug === input.worldSlug);
    requireIndex().upsertEntry(updated, world);
    if (updated.conflictCopy) {
      const copy = await s.readEntryById(input.worldSlug, updated.conflictCopy.id);
      if (copy) requireIndex().upsertEntry(copy, world);
    }
    return updated;
  });

  ipcMain.handle('entry:delete', async (_e, worldSlug: string, id: string) => {
    await requireStore().deleteEntry(worldSlug, id);
    requireIndex().removeEntry(id);
  });

  ipcMain.handle('entry:backlinks', async (_e, worldSlug: string, entryId: string) => {
    return requireIndex().getBacklinks(worldSlug, entryId);
  });

  ipcMain.handle('world:graph', async (_e, worldSlug: string) => {
    return requireIndex().getWorldGraph(worldSlug);
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

  ipcMain.handle('map:list', async (_e, worldSlug: string) => {
    return requireStore().listMaps(worldSlug);
  });

  ipcMain.handle('map:create', async (_e, worldSlug: string, title: string, assetId: string) => {
    return requireStore().createMap(worldSlug, title, assetId);
  });

  ipcMain.handle('map:update', async (_e, worldSlug: string, mapId: string, patch) => {
    return requireStore().updateMap(worldSlug, mapId, patch);
  });

  ipcMain.handle('map:delete', async (_e, worldSlug: string, mapId: string) => {
    await requireStore().deleteMap(worldSlug, mapId);
  });

  ipcMain.handle('board:list', async (_e, worldSlug: string) => {
    return requireStore().listBoards(worldSlug);
  });

  ipcMain.handle('board:create', async (_e, worldSlug: string, title: string) => {
    return requireStore().createBoard(worldSlug, title);
  });

  ipcMain.handle('board:update', async (_e, worldSlug: string, boardId: string, patch) => {
    return requireStore().updateBoard(worldSlug, boardId, patch);
  });

  ipcMain.handle('board:delete', async (_e, worldSlug: string, boardId: string) => {
    await requireStore().deleteBoard(worldSlug, boardId);
  });

  ipcMain.handle('bible:export', async (_e, options) => {
    const s = requireStore();
    const world = (await s.listWorlds()).find((w) => w.slug === options.worldSlug);
    if (!world) throw new Error(`World not found: ${options.worldSlug}`);

    const ext = options.format === 'pdf' ? 'pdf' : 'html';
    const saveRes = await dialog.showSaveDialog({
      title: `Export ${world.name} World Bible`,
      defaultPath: `${world.slug}-world-bible.${ext}`,
      filters:
        options.format === 'pdf'
          ? [{ name: 'PDF Document', extensions: ['pdf'] }]
          : [{ name: 'Standalone HTML', extensions: ['html'] }],
    });
    if (saveRes.canceled || !saveRes.filePath) return null;

    const rendered = await buildWorldBibleHtml(s, world, options);

    if (options.format === 'html') {
      await fs.writeFile(saveRes.filePath, rendered.html, 'utf8');
    } else {
      const tempHtmlPath = path.join(os.tmpdir(), `loreloom-bible-${Date.now()}.html`);
      await fs.writeFile(tempHtmlPath, rendered.html, 'utf8');
      const win = new BrowserWindow({ show: false, width: 1000, height: 1200 });
      try {
        await win.loadFile(tempHtmlPath);
        const pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          margins: { marginType: 'default' },
        });
        await fs.writeFile(saveRes.filePath, pdfBuffer);
      } finally {
        win.destroy();
        await fs.unlink(tempHtmlPath).catch(() => {});
      }
    }

    return {
      outputPath: saveRes.filePath,
      entryCount: rendered.entryCount,
      artCount: rendered.artCount,
    };
  });

  ipcMain.handle('shell:open-local-file', async (_e, filePath: string) => {
    await shell.openPath(filePath);
  });

  ipcMain.handle('world:export-zip', async (_e, worldSlug: string) => {
    const s = requireStore();
    const world = (await s.listWorlds()).find((w) => w.slug === worldSlug);
    if (!world) throw new Error(`World not found: ${worldSlug}`);

    const dateStamp = new Date().toISOString().slice(0, 10);
    const saveRes = await dialog.showSaveDialog({
      title: `Backup ${world.name} as ZIP`,
      defaultPath: `${world.slug}-backup-${dateStamp}.zip`,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (saveRes.canceled || !saveRes.filePath) return null;

    const worldDir = s.worldDir(world.slug);
    const destZip = saveRes.filePath;
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path "${worldDir}\\*" -DestinationPath "${destZip}" -Force`,
      ]);
    } else {
      await execFileAsync('zip', ['-r', destZip, '.'], { cwd: worldDir });
    }
    return { outputPath: destZip };
  });

  ipcMain.handle('hygiene:duplicates', async (_e, worldSlug: string) => {
    const entries = await requireStore().listAllEntriesInWorld(worldSlug);
    return findDuplicateGroups(entries);
  });

  ipcMain.handle(
    'hygiene:merge',
    async (_e, worldSlug: string, keepEntryId: string, removeEntryIds: string[]) => {
      const s = requireStore();
      const idx = requireIndex();
      const merged = await mergeDuplicateEntries(s, worldSlug, keepEntryId, removeEntryIds);
      const world = (await s.listWorlds()).find((w) => w.slug === worldSlug);
      if (world) await idx.syncWorld(s, world);
      return merged;
    }
  );

  ipcMain.handle('hygiene:art-suggestions', async (_e, worldSlug: string) => {
    const s = requireStore();
    const [entries, assets] = await Promise.all([
      s.listAllEntriesInWorld(worldSlug),
      s.listArtAssets(worldSlug),
    ]);
    return findArtLinkSuggestions(entries, assets);
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

  ipcMain.handle('intake:get-folders', async (_e, worldSlug: string) => {
    const settings = await readAppSettings();
    return settings.worldIntakeFolders?.[worldSlug] ?? [];
  });

  ipcMain.handle('intake:set-folders', async (_e, worldSlug: string, folders: string[]) => {
    const settings = await readAppSettings();
    const nextMap = { ...(settings.worldIntakeFolders ?? {}), [worldSlug]: folders };
    await writeAppSettings({ ...settings, worldIntakeFolders: nextMap });
    await refreshIntakeWatchers();
    return folders;
  });

  ipcMain.handle('intake:run-sync', async (_e, worldSlug: string) => {
    return runWorldIntakeSyncAndNotify(worldSlug);
  });

  ipcMain.handle('intake:reclassify-triage', async (_e, worldSlug: string) => {
    const s = requireStore();
    const idx = requireIndex();
    const world = (await s.listWorlds()).find((w) => w.slug === worldSlug);
    if (!world) throw new Error(`World not found: ${worldSlug}`);
    const report = await intakeEngine.reclassifyTriageItems(s, world);
    if (report.reclassifiedEntries > 0) {
      await idx.syncWorld(s, world);
    }
    return report;
  });

  ipcMain.handle('intake:export-prompt-framework', async (_e, worldSlug: string) => {
    const s = requireStore();
    const world = (await s.listWorlds()).find((w) => w.slug === worldSlug);
    if (!world) throw new Error(`World not found: ${worldSlug}`);
    const markdown = generateWorldPromptFramework(world);
    const outPath = path.join(s.worldDir(world.slug), 'AI-PROMPT-FRAMEWORK.md');
    await fs.writeFile(outPath, markdown, 'utf8');
    return outPath;
  });

  ipcMain.handle('update:get-version', async () => {
    return app.getVersion();
  });

  ipcMain.handle('update:has-token', async () => {
    const settings = await readAppSettings();
    return Boolean(settings.githubUpdateToken && settings.githubUpdateToken.trim());
  });

  ipcMain.handle('update:set-token', async (_e, token: string | null) => {
    const settings = await readAppSettings();
    const updated: AppSettings = { ...settings };
    if (token && token.trim()) {
      updated.githubUpdateToken = token.trim();
    } else {
      delete updated.githubUpdateToken;
    }
    await writeAppSettings(updated);
  });

  ipcMain.handle('update:check', async () => {
    const settings = await readAppSettings();
    return checkLatestGitHubRelease({
      currentVersion: app.getVersion(),
      token: settings.githubUpdateToken ?? null,
    });
  });

  ipcMain.handle('update:download-install', async (_e, installerApiUrl: string, filename: string) => {
    const settings = await readAppSettings();
    const headers: Record<string, string> = {
      Accept: 'application/octet-stream',
      'User-Agent': `Loreloom/${app.getVersion()}`,
    };
    if (settings.githubUpdateToken?.trim()) {
      headers.Authorization = `Bearer ${settings.githubUpdateToken.trim()}`;
    }

    const res = await fetch(installerApiUrl, { headers, redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Could not download installer (HTTP ${res.status}).`);
    }

    const arrayBuf = await res.arrayBuffer();
    const safeName = path.basename(filename || 'Loreloom-Setup.exe');
    const outDir = path.join(os.tmpdir(), 'loreloom-update');
    await fs.mkdir(outDir, { recursive: true });
    const installerPath = path.join(outDir, safeName);
    await fs.writeFile(installerPath, Buffer.from(arrayBuf));

    const openErr = await shell.openPath(installerPath);
    if (openErr) {
      throw new Error(`Downloaded installer, but could not launch it: ${openErr}`);
    }
    setTimeout(() => app.quit(), 400);
  });

  ipcMain.handle('app:close-ready', async () => {
    closeAfterFlush = true;
    mainWindow?.close();
  });

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      await shell.openExternal(url);
    }
  });
}

function createWindow(): void {
  const iconPath = path.join(__dirname, '../../build/icon.png');
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Loreloom',
    icon: iconPath,
    backgroundColor: '#18181b',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Never let a dropped file or clicked link replace the app (and lose unsaved edits)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) {
        shell.openExternal(url).catch(() => {});
      }
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  // Ask the renderer to flush debounced saves before closing; force-close after a timeout
  mainWindow.on('close', (event) => {
    if (closeAfterFlush || !mainWindow || mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    mainWindow.webContents.send('app:before-close');
    setTimeout(() => {
      if (!closeAfterFlush) {
        closeAfterFlush = true;
        mainWindow?.close();
      }
    }, 4000);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  const isDevFlag = process.argv.includes('--dev') || Boolean(process.env.VITE_DEV_SERVER_URL);
  if (isDevFlag && !app.isPackaged) {
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
  for (const w of intakeWatchers.values()) await w.close();
  if (indexEngine) indexEngine.close();
  if (process.platform !== 'darwin') app.quit();
});
