import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopBridge,
  IntakeSyncReport,
  WorkspaceExternalChangeEvent,
} from '../src/shared/types';

const bridge: DesktopBridge = {
  getSavedWorkspacePath: () => ipcRenderer.invoke('workspace:get-saved-path'),
  pickFolder: (title) => ipcRenderer.invoke('dialog:pick-folder', title),
  pickImageFiles: () => ipcRenderer.invoke('dialog:pick-images'),
  openWorkspace: (rootPath) => ipcRenderer.invoke('workspace:open', rootPath),
  updateWorkspaceConfig: (patch) => ipcRenderer.invoke('workspace:update-config', patch),
  listWorlds: () => ipcRenderer.invoke('workspace:list-worlds'),
  rebuildIndex: () => ipcRenderer.invoke('workspace:rebuild-index'),

  createWorld: (input) => ipcRenderer.invoke('world:create', input),
  updateWorld: (worldSlug, patch) => ipcRenderer.invoke('world:update', worldSlug, patch),
  deleteWorld: (worldSlug) => ipcRenderer.invoke('world:delete', worldSlug),

  listEntries: (query) => ipcRenderer.invoke('entry:list', query),
  readEntry: (worldSlug, id) => ipcRenderer.invoke('entry:read', worldSlug, id),
  createEntry: (input) => ipcRenderer.invoke('entry:create', input),
  updateEntry: (input) => ipcRenderer.invoke('entry:update', input),
  deleteEntry: (worldSlug, id) => ipcRenderer.invoke('entry:delete', worldSlug, id),
  renameEntryLinks: (worldSlug, entryId, oldTitle) =>
    ipcRenderer.invoke('entry:rename-links', worldSlug, entryId, oldTitle),
  getBacklinks: (worldSlug, entryId) => ipcRenderer.invoke('entry:backlinks', worldSlug, entryId),
  getWorldGraph: (worldSlug) => ipcRenderer.invoke('world:graph', worldSlug),
  searchGlobal: (query) => ipcRenderer.invoke('search:global', query),

  listArtAssets: (query) => ipcRenderer.invoke('art:list', query),
  importArtFiles: (worldSlug, filePaths, category) =>
    ipcRenderer.invoke('art:import-files', worldSlug, filePaths, category),
  saveArtFromBuffer: (worldSlug, filename, base64Data, category) =>
    ipcRenderer.invoke('art:save-buffer', worldSlug, filename, base64Data, category),
  updateArtAsset: (worldSlug, assetId, patch) =>
    ipcRenderer.invoke('art:update', worldSlug, assetId, patch),
  deleteArtAsset: (worldSlug, assetId) => ipcRenderer.invoke('art:delete', worldSlug, assetId),
  getArtLinkedEntries: (worldSlug, assetId) =>
    ipcRenderer.invoke('art:linked-entries', worldSlug, assetId),
  getAssetUrl: (worldSlug, relativePath) =>
    `loreloom-asset://${encodeURIComponent(worldSlug)}/${relativePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
  getThumbnailUrl: (worldSlug, relativePath, size) =>
    `loreloom-asset://${encodeURIComponent(worldSlug)}/${relativePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?thumb=${size}`,

  listMaps: (worldSlug) => ipcRenderer.invoke('map:list', worldSlug),
  createMap: (worldSlug, title, assetId) =>
    ipcRenderer.invoke('map:create', worldSlug, title, assetId),
  updateMap: (worldSlug, mapId, patch) =>
    ipcRenderer.invoke('map:update', worldSlug, mapId, patch),
  deleteMap: (worldSlug, mapId) => ipcRenderer.invoke('map:delete', worldSlug, mapId),

  listBoards: (worldSlug) => ipcRenderer.invoke('board:list', worldSlug),
  createBoard: (worldSlug, title) => ipcRenderer.invoke('board:create', worldSlug, title),
  updateBoard: (worldSlug, boardId, patch) =>
    ipcRenderer.invoke('board:update', worldSlug, boardId, patch),
  deleteBoard: (worldSlug, boardId) => ipcRenderer.invoke('board:delete', worldSlug, boardId),

  listFavorites: (worldSlug) => ipcRenderer.invoke('favorite:list', worldSlug),
  setFavorite: (worldSlug, entryId, favorite) => ipcRenderer.invoke('favorite:set', worldSlug, entryId, favorite),

  exportWorldBible: (options) => ipcRenderer.invoke('bible:export', options),
  exportWorldZip: (worldSlug) => ipcRenderer.invoke('world:export-zip', worldSlug),
  openLocalFile: (filePath) => ipcRenderer.invoke('shell:open-local-file', filePath),

  findDuplicates: (worldSlug) => ipcRenderer.invoke('hygiene:duplicates', worldSlug),
  mergeDuplicates: (worldSlug, keepEntryId, removeEntryIds) =>
    ipcRenderer.invoke('hygiene:merge', worldSlug, keepEntryId, removeEntryIds),
  findDuplicateIds: (worldSlug) => ipcRenderer.invoke('hygiene:id-conflicts', worldSlug),
  reassignEntryId: (worldSlug, relativePath) =>
    ipcRenderer.invoke('hygiene:reassign-id', worldSlug, relativePath),
  findArtLinkSuggestions: (worldSlug) => ipcRenderer.invoke('hygiene:art-suggestions', worldSlug),
  getMcpStatus: () => ipcRenderer.invoke('mcp:get-status'),
  updateMcpSettings: (patch) => ipcRenderer.invoke('mcp:update-settings', patch),
  regenerateMcpToken: () => ipcRenderer.invoke('mcp:regenerate-token'),
  updateMcpRemote: (patch) => ipcRenderer.invoke('mcp:update-remote', patch),
  regenerateMcpRemoteToken: () => ipcRenderer.invoke('mcp:regenerate-remote-token'),
  onMcpStatusChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('mcp:status-changed', handler);
    return () => ipcRenderer.removeListener('mcp:status-changed', handler);
  },
  onMcpActivity: (cb) => {
    const handler = (_e: unknown, activity: Parameters<typeof cb>[0]) => cb(activity);
    ipcRenderer.on('mcp:activity', handler);
    return () => ipcRenderer.removeListener('mcp:activity', handler);
  },
  listTrash: (worldSlug) => ipcRenderer.invoke('trash:list', worldSlug),
  restoreTrashItem: (worldSlug, itemId) => ipcRenderer.invoke('trash:restore', worldSlug, itemId),
  deleteTrashItemForever: (worldSlug, itemId) => ipcRenderer.invoke('trash:delete-forever', worldSlug, itemId),

  scanObsidianVault: (vaultPath) => ipcRenderer.invoke('obsidian:scan', vaultPath),
  importObsidianVault: (options) => ipcRenderer.invoke('obsidian:import', options),

  onWorkspaceChanged: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WorkspaceExternalChangeEvent) =>
      cb(payload);
    ipcRenderer.on('workspace:external-change', listener);
    return () => ipcRenderer.removeListener('workspace:external-change', listener);
  },

  getWorldIntakeFolders: (worldSlug) => ipcRenderer.invoke('intake:get-folders', worldSlug),
  setWorldIntakeFolders: (worldSlug, folders) =>
    ipcRenderer.invoke('intake:set-folders', worldSlug, folders),
  runWorldIntakeSync: (worldSlug) => ipcRenderer.invoke('intake:run-sync', worldSlug),
  reclassifyTriageItems: (worldSlug) =>
    ipcRenderer.invoke('intake:reclassify-triage', worldSlug),
  exportWorldPromptFramework: (worldSlug) =>
    ipcRenderer.invoke('intake:export-prompt-framework', worldSlug),
  onIntakeSynced: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: IntakeSyncReport) => cb(payload);
    ipcRenderer.on('intake:synced', listener);
    return () => ipcRenderer.removeListener('intake:synced', listener);
  },

  onBeforeClose: (cb) => {
    const listener = () => {
      cb()
        .catch(() => {})
        .finally(() => ipcRenderer.invoke('app:close-ready'));
    };
    ipcRenderer.on('app:before-close', listener);
    return () => ipcRenderer.removeListener('app:before-close', listener);
  },

  getAppVersion: () => ipcRenderer.invoke('update:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadAndInstallUpdate: (installerApiUrl, filename) =>
    ipcRenderer.invoke('update:download-install', installerApiUrl, filename),
  hasUpdateToken: () => ipcRenderer.invoke('update:has-token'),
  setUpdateToken: (token) => ipcRenderer.invoke('update:set-token', token),
  openExternalUrl: (url) => ipcRenderer.invoke('shell:open-external', url),
};

contextBridge.exposeInMainWorld('loreloom', bridge);
