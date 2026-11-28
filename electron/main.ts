import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, net, safeStorage, shell } from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yazl from 'yazl';
import chokidar, { type FSWatcher } from 'chokidar';
import { LEGACY_MANIFEST_FILES, WorkspaceStore, fileWriteObserver } from '../src/core/workspace-store';
import { startLoreloomMcpServer, generateMcpToken, type RunningMcpServer } from './mcp-server';
import { findCloudflared, normalizeHostname, startTunnel, type RunningTunnel, type TunnelMode, type TunnelStatus } from './mcp-tunnel';
import type { McpChange } from '../src/core/mcp-tools';
import { IndexEngine, extractPropertyLinks, extractWikilinks, rewritePropertyLinks, rewriteWikilinks } from '../src/core/index-engine';
import { ObsidianImporter } from '../src/core/obsidian-importer';
import { IntakeEngine } from '../src/core/intake-engine';
import { KeyedMutex } from '../src/core/keyed-mutex';
import {
  checkLatestGitHubRelease,
  findSha256ForFile,
  isTrustedReleaseAssetUrl,
  LORELOOM_SIGNING_THUMBPRINT,
} from '../src/core/update-checker';
import {
  findArtLinkSuggestions,
  findDuplicateGroups,
  mergeDuplicateEntries,
} from '../src/core/world-hygiene';
import { writeWorldBibleHtmlFile } from '../src/core/bible-exporter';
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

// Test/dev isolation: run against a separate settings folder (and therefore a separate workspace)
if (process.env.LORELOOM_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.LORELOOM_USER_DATA_DIR));
}

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
  /** Legacy plaintext token (migrated to githubUpdateTokenEnc on first read). */
  githubUpdateToken?: string;
  /** GitHub token encrypted with Electron safeStorage (Windows DPAPI), base64. */
  githubUpdateTokenEnc?: string;
  /** AI assistant access over MCP (off until the user turns it on). */
  mcp?: Partial<McpSettings>;
  /** MCP bearer token encrypted with safeStorage, base64 (plain `mcpToken` only if encryption is unavailable). */
  mcpTokenEnc?: string;
  mcpToken?: string;
  /** Remote access through a Cloudflare tunnel (off until the user turns it on). */
  mcpRemote?: { enabled?: boolean; mode?: TunnelMode; hostname?: string };
  /** Remote token and Cloudflare connector token, encrypted with safeStorage (plain only if unavailable). */
  mcpRemoteTokenEnc?: string;
  mcpRemoteToken?: string;
  mcpTunnelTokenEnc?: string;
  mcpTunnelToken?: string;
}

interface McpSettings {
  enabled: boolean;
  port: number;
  /** Assistants may create and change entries, art and maps. */
  allowWrites: boolean;
  /** Tag AI-created entries and art `needs-triage` for review. */
  markDrafts: boolean;
}

const MCP_DEFAULTS: McpSettings = { enabled: false, port: 47833, allowWrites: true, markDrafts: true };

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

function bitmapHasTransparency(bgra: Buffer): boolean {
  for (let i = 3; i < bgra.length; i += 4) {
    if (bgra[i] < 255) return true;
  }
  return false;
}

/**
 * Downscales art for World Bible exports (JPEG, or PNG when the image has transparency).
 * Formats nativeImage can't decode (webp/avif/gif) are embedded as-is.
 */
async function encodeImageForExport(absPath: string, maxDimension: number): Promise<string | null> {
  const buf = await fs.readFile(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const original = () => {
    const mime =
      ext === '.webp' ? 'image/webp' : ext === '.avif' ? 'image/avif' : ext === '.gif' ? 'image/gif' : ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  };
  if (ext === '.gif') return original();

  let img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return original();
  const { width, height } = img.getSize();
  const scale = Math.min(1, maxDimension / Math.max(width, height, 1));
  if (scale < 1) {
    img = img.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good',
    });
  }
  const transparent = ext === '.png' && bitmapHasTransparency(img.toBitmap());
  const encoded = transparent ? img.toPNG() : img.toJPEG(82);
  // Already within the size cap and the original is smaller: keep the original bytes
  if (scale === 1 && buf.length <= encoded.length) return original();
  return `data:image/${transparent ? 'png' : 'jpeg'};base64,${encoded.toString('base64')}`;
}

/**
 * Zips a folder in-process (streams, no 2 GB limit, includes dot-folders such as `.trash`,
 * no shell command built from file paths).
 */
async function zipFolder(sourceDir: string, destZip: string): Promise<void> {
  const zip = new yazl.ZipFile();
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      const zipPath = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(full, zipPath);
      else if (item.isFile() && !item.name.endsWith('.tmp')) zip.addFile(full, zipPath);
    }
  };
  await walk(sourceDir, '');
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destZip);
    out.on('close', () => resolve());
    out.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);
    zip.end();
  });
}

async function getUpdateToken(): Promise<string | null> {
  const settings = await readAppSettings();
  if (settings.githubUpdateTokenEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(settings.githubUpdateTokenEnc, 'base64'));
    } catch {
      return null;
    }
  }
  const legacy = settings.githubUpdateToken?.trim();
  if (legacy && safeStorage.isEncryptionAvailable()) {
    // Migrate the plaintext token written by <= 0.6.6
    await setUpdateToken(legacy);
  }
  return legacy || null;
}

async function setUpdateToken(token: string | null): Promise<void> {
  const settings = await readAppSettings();
  const updated: AppSettings = { ...settings };
  delete updated.githubUpdateToken;
  delete updated.githubUpdateTokenEnc;
  const clean = token?.trim();
  if (clean) {
    if (safeStorage.isEncryptionAvailable()) {
      updated.githubUpdateTokenEnc = safeStorage.encryptString(clean).toString('base64');
    } else {
      updated.githubUpdateToken = clean;
    }
  }
  await writeAppSettings(updated);
}

// ---------------------------------------------------------------------------------------------
// AI assistants (MCP)

let mcpRunning: RunningMcpServer | null = null;
let mcpError: string | null = null;
let tunnel: RunningTunnel | null = null;
let tunnelStatus: TunnelStatus = { running: false, publicUrl: null, error: null };
/** Tokens and tunnel hosts the running server checks on every request. */
let mcpAuthState: { localToken: string; remoteToken: string | null; remoteHosts: string[] } = {
  localToken: '',
  remoteToken: null,
  remoteHosts: [],
};

type SecretField = 'mcpRemoteToken' | 'mcpTunnelToken';

async function readSecret(field: SecretField): Promise<string | null> {
  const settings = await readAppSettings();
  const enc = settings[`${field}Enc` as const];
  if (enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  }
  return settings[field] ?? null;
}

async function writeSecret(field: SecretField, value: string | null): Promise<void> {
  const settings = await readAppSettings();
  const updated: AppSettings = { ...settings };
  delete updated[field];
  delete updated[`${field}Enc` as const];
  if (value) {
    if (safeStorage.isEncryptionAvailable()) updated[`${field}Enc` as const] = safeStorage.encryptString(value).toString('base64');
    else updated[field] = value;
  }
  await writeAppSettings(updated);
}

async function getRemoteToken(regenerate = false): Promise<string> {
  const existing = regenerate ? null : await readSecret('mcpRemoteToken');
  if (existing) return existing;
  const token = generateMcpToken();
  await writeSecret('mcpRemoteToken', token);
  return token;
}

async function getRemoteSettings(): Promise<{ enabled: boolean; mode: TunnelMode; hostname: string }> {
  const r = (await readAppSettings()).mcpRemote ?? {};
  return { enabled: Boolean(r.enabled), mode: r.mode === 'named' ? 'named' : 'quick', hostname: r.hostname ?? '' };
}

function sendMcpStatusChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mcp:status-changed');
}

function stopTunnel(): void {
  tunnel?.stop();
  tunnel = null;
  tunnelStatus = { running: false, publicUrl: null, error: null };
  mcpAuthState = { ...mcpAuthState, remoteToken: null, remoteHosts: [] };
}

/** Starts the Cloudflare tunnel when remote access is on and the local server is running. */
async function applyRemoteAccess(port: number): Promise<void> {
  stopTunnel();
  const remote = await getRemoteSettings();
  if (!remote.enabled || !mcpRunning) return;
  const cloudflaredPath = await findCloudflared();
  if (!cloudflaredPath) {
    tunnelStatus = { running: false, publicUrl: null, error: "cloudflared isn't installed. Install it, then turn remote access off and on again." };
    return;
  }
  const remoteToken = await getRemoteToken();
  let connectorToken: string | undefined;
  let hostname: string | undefined;
  if (remote.mode === 'named') {
    hostname = normalizeHostname(remote.hostname) ?? undefined;
    connectorToken = (await readSecret('mcpTunnelToken')) ?? undefined;
    if (!hostname || !connectorToken) {
      tunnelStatus = { running: false, publicUrl: null, error: 'Enter your hostname and the tunnel token from Cloudflare first.' };
      return;
    }
  }
  tunnel = startTunnel({
    cloudflaredPath,
    mode: remote.mode,
    localPort: port,
    hostname,
    connectorToken,
    onStatus: (status) => {
      tunnelStatus = status;
      const host = status.publicUrl ? new URL(status.publicUrl).hostname : null;
      mcpAuthState = { ...mcpAuthState, remoteToken: status.running ? remoteToken : null, remoteHosts: host ? [host] : [] };
      sendMcpStatusChanged();
    },
  });
}

async function getMcpSettings(): Promise<McpSettings> {
  const settings = await readAppSettings();
  return { ...MCP_DEFAULTS, ...(settings.mcp ?? {}) };
}

/** The bearer token assistants use; created on first use and stored encrypted. */
async function getMcpToken(regenerate = false): Promise<string> {
  const settings = await readAppSettings();
  if (!regenerate) {
    if (settings.mcpTokenEnc && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(settings.mcpTokenEnc, 'base64'));
      } catch {
        // Unreadable (e.g. copied settings from another PC): make a new one below
      }
    } else if (settings.mcpToken) {
      return settings.mcpToken;
    }
  }
  const token = generateMcpToken();
  const updated: AppSettings = { ...settings };
  delete updated.mcpToken;
  delete updated.mcpTokenEnc;
  if (safeStorage.isEncryptionAvailable()) updated.mcpTokenEnc = safeStorage.encryptString(token).toString('base64');
  else updated.mcpToken = token;
  await writeAppSettings(updated);
  return token;
}

function mcpBridgePath(): string {
  return path.join(app.getPath('userData'), 'mcp', 'loreloom-mcp-bridge.js');
}

/** Copies the stdio bridge out of the app bundle to a stable path that survives updates. */
async function installMcpBridge(): Promise<void> {
  const source = await fs.readFile(path.join(__dirname, 'mcp-bridge.js'), 'utf8');
  const dest = mcpBridgePath();
  const current = await fs.readFile(dest, 'utf8').catch(() => null);
  if (current === source) return;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, source, 'utf8');
}

/** Starts or stops the MCP endpoint to match the saved settings. */
async function applyMcpSettings(): Promise<void> {
  stopTunnel();
  if (mcpRunning) {
    await mcpRunning.close().catch(() => {});
    mcpRunning = null;
  }
  mcpError = null;
  const settings = await getMcpSettings();
  if (!settings.enabled) return;
  try {
    await installMcpBridge().catch(() => {});
    mcpAuthState = { localToken: await getMcpToken(), remoteToken: null, remoteHosts: [] };
    mcpRunning = await startLoreloomMcpServer({
      port: settings.port,
      auth: () => mcpAuthState,
      version: app.getVersion(),
      context: (clientName) =>
        store && indexEngine
          ? {
              store,
              index: indexEngine,
              allowWrites: settings.allowWrites,
              markDrafts: settings.markDrafts,
              clientName,
              onChange: (change: McpChange) => {
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mcp:activity', change);
              },
            }
          : null,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    mcpError = code === 'EADDRINUSE' ? `Port ${settings.port} is already in use. Pick another port.` : (err as Error).message;
  }
  await applyRemoteAccess(settings.port);
}

async function getMcpStatus() {
  const settings = await getMcpSettings();
  return {
    ...settings,
    running: Boolean(mcpRunning),
    url: `http://127.0.0.1:${settings.port}/mcp`,
    error: mcpError,
    token: await getMcpToken(),
    bridgePath: mcpBridgePath(),
    execPath: process.execPath,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    remote: {
      ...(await getRemoteSettings()),
      running: tunnelStatus.running,
      publicUrl: tunnelStatus.publicUrl,
      error: tunnelStatus.error,
      token: await getRemoteToken(),
      cloudflaredFound: Boolean(await findCloudflared()),
      hasConnectorToken: Boolean(await readSecret('mcpTunnelToken')),
    },
  };
}

async function downloadReleaseAsset(apiUrl: string, token: string | null): Promise<Buffer> {
  if (!isTrustedReleaseAssetUrl(apiUrl)) throw new Error('Refusing to download from an untrusted URL.');
  const headers: Record<string, string> = {
    Accept: 'application/octet-stream',
    'User-Agent': `Loreloom/${app.getVersion()}`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download update (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads the installer's Authenticode signature without building a shell command from the path. */
function readAuthenticode(filePath: string): Promise<{ status: string; thumbprint: string } | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script =
    '$s = Get-AuthenticodeSignature -LiteralPath $env:LORELOOM_VERIFY_PATH; ' +
    '@{ status = [string]$s.Status; thumbprint = [string]$s.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, LORELOOM_VERIFY_PATH: filePath }, timeout: 30_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed = JSON.parse(stdout.trim()) as { status?: string; thumbprint?: string };
          resolve({ status: parsed.status ?? '', thumbprint: (parsed.thumbprint ?? '').toUpperCase() });
        } catch {
          resolve(null);
        }
      }
    );
  });
}

/**
 * An installer is only run if its SHA-256 matches the release's SHA256SUMS.txt, or if it carries an
 * intact Authenticode signature from the Loreloom Studio certificate.
 */
async function verifyInstaller(
  installerPath: string,
  installerBytes: Buffer,
  filename: string,
  checksumsApiUrl: string | undefined,
  token: string | null
): Promise<{ ok: true; method: string } | { ok: false; reason: string }> {
  if (checksumsApiUrl) {
    const sums = (await downloadReleaseAsset(checksumsApiUrl, token)).toString('utf8');
    const expected = findSha256ForFile(sums, filename);
    if (expected) {
      const actual = crypto.createHash('sha256').update(installerBytes).digest('hex');
      return actual === expected
        ? { ok: true, method: 'sha256' }
        : { ok: false, reason: 'The download does not match the release checksum.' };
    }
  }
  const sig = await readAuthenticode(installerPath);
  if (sig && sig.thumbprint === LORELOOM_SIGNING_THUMBPRINT) {
    // UnknownError = intact signature whose self-signed root is not trusted on this PC
    if (sig.status === 'Valid' || sig.status === 'UnknownError') return { ok: true, method: 'authenticode' };
    return { ok: false, reason: `The installer signature is ${sig.status}.` };
  }
  return { ok: false, reason: 'The installer could not be verified (no checksum or Loreloom signature).' };
}

/** Files the renderer may open with the OS: recent export outputs and non-executable workspace files. */
const openableExportPaths = new Set<string>();
const EXECUTABLE_EXTS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.com', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.scr', '.lnk', '.hta', '.cpl', '.reg',
]);

function canOpenLocalFile(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  if (EXECUTABLE_EXTS.has(path.extname(resolved).toLowerCase())) return false;
  if (openableExportPaths.has(resolved)) return true;
  if (!store) return false;
  const root = path.resolve(store.rootPath);
  return resolved.startsWith(root + path.sep);
}

/**
 * Downscaled thumbnails for grids, cards and pickers, cached in machine-local AppData (never in the
 * synced folder). Keyed by source path + size + mtime, so edited images get fresh thumbnails.
 */
const THUMBNAIL_SIZES = new Set([128, 256, 512, 1024, 1600]);
const thumbnailJobs = new Map<string, Promise<string | null>>();

function getThumbnailDir(): string {
  return path.join(app.getPath('userData'), 'thumbnails');
}

async function getThumbnail(absPath: string, size: number): Promise<string | null> {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.gif') return null; // keep animation
  const stat = await fs.stat(absPath);
  const key = crypto
    .createHash('sha1')
    .update(`${absPath.toLowerCase()}|${stat.size}|${Math.floor(stat.mtimeMs)}|${size}`)
    .digest('hex');
  const existingJob = thumbnailJobs.get(key);
  if (existingJob) return existingJob;

  const job = (async () => {
    const dir = getThumbnailDir();
    for (const candidate of [path.join(dir, `${key}.jpg`), path.join(dir, `${key}.png`)]) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // not cached yet
      }
    }
    let img = nativeImage.createFromPath(absPath);
    if (img.isEmpty()) return null; // webp/avif: nativeImage can't decode, serve the original
    const { width, height } = img.getSize();
    if (Math.max(width, height) <= size) return null; // already small: original is fine
    const scale = size / Math.max(width, height);
    img = img.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good',
    });
    const transparent = ext === '.png' && bitmapHasTransparency(img.toBitmap());
    const out = path.join(dir, `${key}.${transparent ? 'png' : 'jpg'}`);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${out}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, transparent ? img.toPNG() : img.toJPEG(84));
    await fs.rename(tmp, out).catch(async () => {
      await fs.unlink(tmp).catch(() => {});
    });
    return out;
  })();
  thumbnailJobs.set(key, job);
  try {
    return await job;
  } finally {
    thumbnailJobs.delete(key);
  }
}

function requireStore(): WorkspaceStore {
  if (!store) throw new Error('Workspace not opened');
  return store;
}

function requireIndex(): IndexEngine {
  if (!indexEngine) throw new Error('LocalIndex not initialized');
  return indexEngine;
}

/** Files Loreloom wrote itself in the last few seconds; the watcher ignores their echoes. */
const recentSelfWrites = new Map<string, number>();
const SELF_WRITE_WINDOW_MS = 3000;
fileWriteObserver.onWrite = (absPath) => {
  recentSelfWrites.set(absPath.toLowerCase(), Date.now() + SELF_WRITE_WINDOW_MS);
};

function isRecentSelfWrite(absPath: string): boolean {
  const key = path.resolve(absPath).toLowerCase();
  const expiry = recentSelfWrites.get(key);
  if (expiry === undefined) return false;
  if (expiry > Date.now()) return true;
  recentSelfWrites.delete(key);
  return false;
}

type WatchEvent = 'add' | 'change' | 'unlink' | 'unlinkDir';

/**
 * Watches the synced Workspace. Changes are batched, Loreloom's own writes are skipped, and only
 * the files that changed are re-indexed (the old version rebuilt the whole index on every save).
 */
async function startWorkspaceWatcher(rootPath: string): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }

  const pending = new Map<string, WatchEvent>();
  let debounceTimer: NodeJS.Timeout | null = null;
  watcher = chokidar.watch(path.join(rootPath, 'worlds'), {
    ignoreInitial: true,
    ignored: /(^|[/\\])\..|\.tmp$/,
    awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 },
  });

  const processBatch = async () => {
    if (!store || !indexEngine) return;
    const s = store;
    const idx = indexEngine;
    const batch = Array.from(pending.entries());
    pending.clear();

    const events = new Map<string, WorkspaceExternalChangeEvent>();
    const worldsToResync = new Set<string>();
    const removedWorlds = new Set<string>();

    for (const [changedPath, evt] of batch) {
      const rel = path.relative(rootPath, changedPath).replace(/\\/g, '/');
      const parts = rel.split('/');
      const worldSlug = parts[0] === 'worlds' ? parts[1] : undefined;
      if (!worldSlug) continue;

      let kind: WorkspaceExternalChangeEvent['kind'] = 'art';
      try {
        if (parts.length === 2 && evt === 'unlinkDir') {
          removedWorlds.add(worldSlug);
          kind = 'world';
        } else if (parts.length === 3 && parts[2] === 'world.yaml') {
          worldsToResync.add(worldSlug);
          kind = 'world';
        } else if (parts.length === 3 && LEGACY_MANIFEST_FILES.has(parts[2]) && evt !== 'unlink') {
          // An older Loreloom on another PC wrote a shared manifest: fold it into per-record files
          await s.migrateWorldRecords(worldSlug);
          kind = 'world';
        } else if (parts[2] === 'records') {
          // records/types/* changes the World's entity types; art, maps and boards refresh views
          kind = parts[3] === 'types' ? 'world' : 'art';
        } else if (parts[2] === 'entries' && rel.toLowerCase().endsWith('.md')) {
          kind = 'entry';
          const entryRel = parts.slice(3).join('/');
          if (evt === 'unlink') {
            idx.removeEntryByPath(worldSlug, entryRel);
          } else {
            const entry = await s.readEntryAtRelativePath(worldSlug, entryRel);
            if (entry) {
              const indexedPath = idx.getEntryRelativePath(worldSlug, entry.id);
              if (indexedPath && indexedPath !== entryRel) {
                // Same id in two files (e.g. a sync conflict copy): rescan to record the duplicate
                worldsToResync.add(worldSlug);
              } else {
                idx.removeEntryByPath(worldSlug, entryRel);
                idx.upsertEntry(entry);
              }
            }
          }
        }
      } catch {
        // Transient OneDrive/Google Drive locks: the next change event retries this file
        worldsToResync.add(worldSlug);
      }
      events.set(`${worldSlug}:${kind}`, { worldSlug, kind, relativePath: rel });
    }

    if (worldsToResync.size > 0 || removedWorlds.size > 0) {
      const worlds = await s.listWorlds().catch(() => []);
      for (const slug of removedWorlds) {
        if (!worlds.some((w) => w.slug === slug)) idx.removeWorld(slug);
      }
      for (const slug of worldsToResync) {
        const world = worlds.find((w) => w.slug === slug);
        if (world) await idx.syncWorld(s, world).catch(() => 0);
        else idx.removeWorld(slug);
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      for (const evt of events.values()) {
        mainWindow.webContents.send('workspace:external-change', evt satisfies WorkspaceExternalChangeEvent);
      }
    }
  };

  const handle = (evt: WatchEvent) => (changedPath: string) => {
    // Loreloom only ever retires legacy manifests, so one appearing is always another PC's write
    const legacyManifest = LEGACY_MANIFEST_FILES.has(path.basename(changedPath));
    if (evt !== 'unlinkDir' && !legacyManifest && isRecentSelfWrite(changedPath)) return;
    pending.set(changedPath, evt);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processBatch().catch(() => {});
    }, 450);
  };

  watcher.on('add', handle('add'));
  watcher.on('change', handle('change'));
  watcher.on('unlink', handle('unlink'));
  watcher.on('unlinkDir', handle('unlinkDir'));
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
  ipcMain.handle('mcp:get-status', () => getMcpStatus());
  ipcMain.handle('mcp:update-settings', async (_e, patch: Partial<McpSettings>) => {
    const settings = await readAppSettings();
    const current = { ...MCP_DEFAULTS, ...(settings.mcp ?? {}) };
    const next: McpSettings = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      allowWrites: typeof patch.allowWrites === 'boolean' ? patch.allowWrites : current.allowWrites,
      markDrafts: typeof patch.markDrafts === 'boolean' ? patch.markDrafts : current.markDrafts,
      port:
        Number.isInteger(patch.port) && Number(patch.port) >= 1024 && Number(patch.port) <= 65535 ? Number(patch.port) : current.port,
    };
    await writeAppSettings({ ...settings, mcp: next });
    await applyMcpSettings();
    return getMcpStatus();
  });
  ipcMain.handle(
    'mcp:update-remote',
    async (_e, patch: { enabled?: boolean; mode?: TunnelMode; hostname?: string; connectorToken?: string | null }) => {
      const settings = await readAppSettings();
      const current = settings.mcpRemote ?? {};
      const next = {
        enabled: typeof patch.enabled === 'boolean' ? patch.enabled : Boolean(current.enabled),
        mode: patch.mode === 'named' || patch.mode === 'quick' ? patch.mode : current.mode ?? 'quick',
        hostname: typeof patch.hostname === 'string' ? (normalizeHostname(patch.hostname) ?? patch.hostname.trim()) : current.hostname ?? '',
      };
      await writeAppSettings({ ...settings, mcpRemote: next });
      if (patch.connectorToken !== undefined) await writeSecret('mcpTunnelToken', patch.connectorToken?.trim() || null);
      const port = (await getMcpSettings()).port;
      await applyRemoteAccess(port);
      return getMcpStatus();
    }
  );
  ipcMain.handle('mcp:regenerate-remote-token', async () => {
    await getRemoteToken(true);
    await applyRemoteAccess((await getMcpSettings()).port);
    return getMcpStatus();
  });
  ipcMain.handle('mcp:regenerate-token', async () => {
    await getMcpToken(true);
    await applyMcpSettings();
    return getMcpStatus();
  });

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

    // Move Worlds from shared manifests (<= 0.6.8) to one file per record, so edits on two PCs
    // stop producing OneDrive conflict copies. Idempotent; a locked file is retried next launch.
    for (const world of state.worlds) {
      await store.migrateWorldRecords(world.slug).catch((err) => {
        console.warn(`Record migration deferred for ${world.slug}:`, err);
      });
    }

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
    store.setEntryLocator((worldSlug, entryId) => indexEngine?.getEntryRelativePath(worldSlug, entryId) ?? null);
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

  ipcMain.handle('workspace:list-worlds', async () => {
    return requireStore().listWorlds();
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
      // Only the World's name lives in the index; theme/type edits don't need a re-scan
      requireIndex().upsertWorld(updated);
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
    requireIndex().upsertEntry(created);
    return created;
  });

  ipcMain.handle('entry:update', async (_e, input: UpdateEntryInput) => {
    const s = requireStore();
    const idx = requireIndex();
    const previousPath = idx.getEntryRelativePath(input.worldSlug, input.id);
    const updated = await s.updateEntry(input);
    if (previousPath && previousPath !== updated.relativePath) idx.removeEntryByPath(input.worldSlug, previousPath);
    idx.upsertEntry(updated);
    if (updated.conflictCopy) {
      const copy = await s.readEntryById(input.worldSlug, updated.conflictCopy.id);
      if (copy) idx.upsertEntry(copy);
    }
    return updated;
  });

  ipcMain.handle('entry:delete', async (_e, worldSlug: string, id: string) => {
    await requireStore().deleteEntry(worldSlug, id);
    requireIndex().removeEntry(worldSlug, id);
  });

  // After a rename: point every [[Old Title]] link in the World at the new title
  ipcMain.handle('entry:rename-links', async (_e, worldSlug: string, entryId: string, oldTitle: string) => {
    const s = requireStore();
    const idx = requireIndex();
    const target = await s.readEntryById(worldSlug, entryId);
    if (!target || !oldTitle?.trim() || oldTitle.trim() === target.title) return { updatedEntries: 0 };
    const oldKey = oldTitle.trim().toLowerCase();
    const linksTo = (targets: Array<{ target: string }>) => targets.some((l) => l.target.toLowerCase() === oldKey);
    const candidates = (await s.listAllEntriesInWorld(worldSlug)).filter(
      (e) => e.id !== entryId && (linksTo(extractWikilinks(e.body)) || linksTo(extractPropertyLinks(e.properties)))
    );
    let updatedEntries = 0;
    for (const source of candidates) {
      const nextBody = rewriteWikilinks(source.body, [oldTitle.trim()], target.title);
      // Relation properties ("[[Old Title]]" in frontmatter) are updated too
      const nextProperties = rewritePropertyLinks(source.properties, [oldTitle.trim()], target.title);
      if (nextBody === source.body && !nextProperties) continue;
      const updated = await s.updateEntry({
        worldSlug,
        id: source.id,
        body: nextBody,
        baseBody: source.body,
        ...(nextProperties ? { properties: nextProperties as UpdateEntryInput['properties'] } : {}),
      });
      idx.upsertEntry(updated);
      if (!updated.conflictCopy) updatedEntries++;
    }
    return { updatedEntries };
  });

  ipcMain.handle('hygiene:id-conflicts', async (_e, worldSlug: string) => {
    return requireIndex().getDuplicateIdConflicts(worldSlug);
  });

  ipcMain.handle('hygiene:reassign-id', async (_e, worldSlug: string, relativePath: string) => {
    const s = requireStore();
    const entry = await s.reassignEntryId(worldSlug, relativePath);
    const world = (await s.listWorlds()).find((w) => w.slug === worldSlug);
    if (world) await requireIndex().syncWorld(s, world);
    return entry;
  });

  ipcMain.handle('trash:list', async (_e, worldSlug: string) => requireStore().listTrash(worldSlug));

  ipcMain.handle('trash:restore', async (_e, worldSlug: string, itemId: string) => {
    const s = requireStore();
    const result = await s.restoreTrashItem(worldSlug, itemId);
    if (result.kind === 'entry' && result.relativePath) {
      // The watcher ignores Loreloom's own writes, so index the restored entry here
      const entry = await s.readEntryAtRelativePath(worldSlug, result.relativePath);
      if (entry) requireIndex().upsertEntry(entry);
    }
    return result;
  });

  ipcMain.handle('trash:delete-forever', async (_e, worldSlug: string, itemId: string) =>
    requireStore().deleteTrashItemForever(worldSlug, itemId)
  );

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

    // Streamed to disk with downscaled art: building one in-memory string overflowed
    // V8's max string length ("RangeError: Invalid string length") on art-heavy Worlds.
    let rendered: { entryCount: number; artCount: number };
    if (options.format === 'html') {
      rendered = await writeWorldBibleHtmlFile(s, world, options, saveRes.filePath, encodeImageForExport);
    } else {
      const tempHtmlPath = path.join(os.tmpdir(), `loreloom-bible-${Date.now()}.html`);
      let win: BrowserWindow | null = null;
      try {
        rendered = await writeWorldBibleHtmlFile(s, world, options, tempHtmlPath, encodeImageForExport);
        win = new BrowserWindow({ show: false, width: 1000, height: 1200 });
        await win.loadFile(tempHtmlPath);
        const pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
        });
        await fs.writeFile(saveRes.filePath, pdfBuffer);
      } finally {
        win?.destroy();
        await fs.unlink(tempHtmlPath).catch(() => {});
      }
    }

    openableExportPaths.add(path.resolve(saveRes.filePath));
    return {
      outputPath: saveRes.filePath,
      entryCount: rendered.entryCount,
      artCount: rendered.artCount,
    };
  });

  ipcMain.handle('shell:open-local-file', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || !canOpenLocalFile(filePath)) {
      throw new Error('Loreloom can only open exported files and non-executable files inside the workspace.');
    }
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

    const destZip = saveRes.filePath;
    await zipFolder(s.worldDir(world.slug), destZip);
    openableExportPaths.add(path.resolve(destZip));
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
    return Boolean(await getUpdateToken());
  });

  ipcMain.handle('update:set-token', async (_e, token: string | null) => {
    await setUpdateToken(typeof token === 'string' ? token : null);
  });

  ipcMain.handle('update:check', async () => {
    return checkLatestGitHubRelease({
      currentVersion: app.getVersion(),
      token: await getUpdateToken(),
    });
  });

  // The renderer's URL/filename are ignored: main re-checks the latest release itself, downloads
  // only this repository's release assets, and verifies the installer before running it.
  ipcMain.handle('update:download-install', async () => {
    const token = await getUpdateToken();
    const check = await checkLatestGitHubRelease({ currentVersion: app.getVersion(), token });
    if (check.status !== 'update-available' || !check.installerApiUrl || !check.installerFilename) {
      throw new Error(check.message || 'No installable update was found.');
    }

    const bytes = await downloadReleaseAsset(check.installerApiUrl, token);
    const safeName = path.basename(check.installerFilename);
    const outDir = path.join(os.tmpdir(), 'loreloom-update');
    await fs.mkdir(outDir, { recursive: true });
    const installerPath = path.join(outDir, safeName);
    await fs.writeFile(installerPath, bytes);

    const verdict = await verifyInstaller(installerPath, bytes, safeName, check.checksumsApiUrl, token);
    if (!verdict.ok) {
      await fs.unlink(installerPath).catch(() => {});
      throw new Error(`${verdict.reason} The update was not installed. Download it from the Releases page instead.`);
    }

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
      sandbox: true,
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

// One Loreloom per machine: two instances would share index.db and race on manifest writes
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  protocol.handle('loreloom-asset', async (request) => {
    try {
      if (!store) return new Response('No workspace open', { status: 404 });
      const url = new URL(request.url);
      const worldSlug = decodeURIComponent(url.hostname);
      const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const absPath = store.resolveAssetAbsolutePath(worldSlug, relPath);
      const thumbSize = Number(url.searchParams.get('thumb'));
      if (THUMBNAIL_SIZES.has(thumbSize)) {
        const thumbPath = await getThumbnail(absPath, thumbSize).catch(() => null);
        if (thumbPath) return net.fetch(pathToFileURL(thumbPath).toString());
      }
      return net.fetch(pathToFileURL(absPath).toString());
    } catch {
      return new Response('Asset not found', { status: 404 });
    }
  });

  registerIpcHandlers();
  createWindow();
  void applyMcpSettings();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  stopTunnel();
  if (mcpRunning) await mcpRunning.close().catch(() => {});
  if (watcher) await watcher.close();
  for (const w of intakeWatchers.values()) await w.close();
  if (indexEngine) indexEngine.close();
  if (process.platform !== 'darwin') app.quit();
});
