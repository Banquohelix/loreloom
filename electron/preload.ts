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
  rebuildIndex: () => ipcRenderer.invoke('workspace:rebuild-index'),

  createWorld: (input) => ipcRenderer.invoke('world:create', input),
  updateWorld: (worldSlug, patch) => ipcRenderer.invoke('world:update', worldSlug, patch),
  deleteWorld: (worldSlug) => ipcRenderer.invoke('world:delete', worldSlug),

  listEntries: (query) => ipcRenderer.invoke('entry:list', query),
  readEntry: (worldSlug, id) => ipcRenderer.invoke('entry:read', worldSlug, id),
  createEntry: (input) => ipcRenderer.invoke('entry:create', input),
  updateEntry: (input) => ipcRenderer.invoke('entry:update', input),
  deleteEntry: (worldSlug, id) => ipcRenderer.invoke('entry:delete', worldSlug, id),
  getBacklinks: (worldSlug, entryId) => ipcRenderer.invoke('entry:backlinks', worldSlug, entryId),
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
  onIntakeSynced: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: IntakeSyncReport) => cb(payload);
    ipcRenderer.on('intake:synced', listener);
    return () => ipcRenderer.removeListener('intake:synced', listener);
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
