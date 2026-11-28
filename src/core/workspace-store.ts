import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { cloneStarterEntityTypes } from '../shared/starter-types';
import { normalizeBodyForCompare, repairEscapedWikilinks } from '../shared/wikilink-repair';
import { getDefaultWorldTheme } from './theme-engine';
import { KeyedMutex } from './keyed-mutex';
import { assertSafeSegment, resolveInside, withFsRetry } from './fs-safety';
import type {
  ArtAsset,
  ArtCategory,
  CreateEntryInput,
  CreateWorldInput,
  Entry,
  EntryPropertyValue,
  EntryRelationship,
  MoodboardDef,
  UpdateEntryInput,
  UpdateEntryResult,
  WorkspaceConfig,
  WorkspaceState,
  WorldConfig,
  WorldMapDef,
} from '../shared/types';

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'untitled';
}

export function extractExcerpt(markdown: string, maxLength = 180): string {
  const stripped = markdown
    .replace(/!\[\[[^\]]+\]\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= maxLength) return stripped;
  return `${stripped.slice(0, maxLength - 1).trimEnd()}…`;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Observes files Loreloom itself writes or removes, so the workspace watcher can ignore its own
 * echoes instead of re-indexing and refreshing the UI after every save.
 */
export const fileWriteObserver: { onWrite: ((absPath: string) => void) | null } = { onWrite: null };

function notifyWrite(absPath: string): void {
  try {
    fileWriteObserver.onWrite?.(path.resolve(absPath));
  } catch {
    // Observer failures must never break a save
  }
}

async function atomicWriteFile(filePath: string, content: string | Buffer): Promise<void> {
  notifyWrite(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tempPath, content);
  try {
    await withFsRetry(() => fs.rename(tempPath, filePath));
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/** Frontmatter keys Loreloom manages itself; everything else is preserved verbatim. */
const MANAGED_FRONTMATTER_KEYS = new Set([
  'id',
  'title',
  'type',
  'secondaryTypes',
  'relationships',
  'tags',
  'properties',
  'coverAssetId',
  'portraitAssetId',
  'createdAt',
  'updatedAt',
]);

/** js-yaml parses unquoted dates (`2024-01-01`) into Date objects; keep them as stable strings. */
function normalizeYamlValue(value: unknown): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return String(value);
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(value)) return value.map(normalizeYamlValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeYamlValue(v)])
    );
  }
  return value;
}

function trashStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Moves a file or folder into a trash folder instead of deleting it permanently. */
async function moveToTrash(sourcePath: string, trashDir: string, name: string): Promise<string> {
  await fs.mkdir(trashDir, { recursive: true });
  const dest = path.join(trashDir, `${trashStamp()}__${name}`);
  notifyWrite(sourcePath);
  try {
    await withFsRetry(() => fs.rename(sourcePath, dest));
  } catch {
    // Fallback for cross-device or locked folders: copy then remove
    await fs.cp(sourcePath, dest, { recursive: true });
    await withFsRetry(() => fs.rm(sourcePath, { recursive: true, force: true }));
  }
  return dest;
}

interface ArtManifestFile {
  assets: ArtAsset[];
}

interface MapsManifestFile {
  maps: WorldMapDef[];
}

interface BoardsManifestFile {
  boards: MoodboardDef[];
}

/**
 * Deep module managing the on-disk OneDrive/Google Drive Workspace folder.
 * Hides YAML/Markdown serialization, atomic writes, slug collision handling,
 * and folder traversal behind a small, testable interface.
 */
export class WorkspaceStore {
  private readonly locks = new KeyedMutex();

  constructor(public readonly rootPath: string) {}

  /** `<world>/.trash/<kind>` — ignored by the watcher, kept in the synced folder so it can be restored. */
  public worldTrashDir(worldSlug: string, kind: 'entries' | 'assets' | 'maps' | 'boards'): string {
    return path.join(this.worldDir(worldSlug), '.trash', kind);
  }

  private workspaceConfigPath(): string {
    return path.join(this.rootPath, 'workspace.yaml');
  }

  private worldsDir(): string {
    return path.join(this.rootPath, 'worlds');
  }

  public worldDir(worldSlug: string): string {
    return path.join(this.worldsDir(), assertSafeSegment(worldSlug, 'world slug'));
  }

  private worldConfigPath(worldSlug: string): string {
    return path.join(this.worldDir(worldSlug), 'world.yaml');
  }

  private entriesDir(worldSlug: string): string {
    return path.join(this.worldDir(worldSlug), 'entries');
  }

  public assetsDir(worldSlug: string): string {
    return path.join(this.worldDir(worldSlug), 'assets');
  }

  private artManifestPath(worldSlug: string): string {
    return path.join(this.worldDir(worldSlug), 'art-manifest.yaml');
  }

  private mapsManifestPath(worldSlug: string): string {
    return path.join(this.worldDir(worldSlug), 'maps.yaml');
  }

  private boardsManifestPath(worldSlug: string): string {
    return path.join(this.worldDir(worldSlug), 'boards.yaml');
  }

  async ensureInitialized(defaultName = 'Loreloom Workspace'): Promise<WorkspaceState> {
    await fs.mkdir(this.worldsDir(), { recursive: true });

    let config: WorkspaceConfig;
    if (await exists(this.workspaceConfigPath())) {
      const raw = await fs.readFile(this.workspaceConfigPath(), 'utf8');
      const parsed = (yaml.load(raw) as Partial<WorkspaceConfig> | undefined) ?? {};
      config = {
        name: parsed.name || defaultName,
        activeWorldSlug: parsed.activeWorldSlug,
        studioAppearance: parsed.studioAppearance === 'dark' ? 'dark' : 'light',
        createdAt: parsed.createdAt || new Date().toISOString(),
      };
    } else {
      config = {
        name: defaultName,
        studioAppearance: 'light',
        createdAt: new Date().toISOString(),
      };
      await atomicWriteFile(this.workspaceConfigPath(), yaml.dump(config));
    }

    const worlds = await this.listWorlds();
    return { rootPath: this.rootPath, config, worlds };
  }

  async updateWorkspaceConfig(patch: Partial<WorkspaceConfig>): Promise<WorkspaceConfig> {
    const state = await this.ensureInitialized();
    const updated: WorkspaceConfig = { ...state.config, ...patch };
    await atomicWriteFile(this.workspaceConfigPath(), yaml.dump(updated));
    return updated;
  }

  async listWorlds(): Promise<WorldConfig[]> {
    if (!(await exists(this.worldsDir()))) return [];
    const dirEntries = await fs.readdir(this.worldsDir(), { withFileTypes: true });
    const worlds: WorldConfig[] = [];

    for (const dirent of dirEntries) {
      if (!dirent.isDirectory()) continue;
      const cfgPath = this.worldConfigPath(dirent.name);
      if (!(await exists(cfgPath))) continue;
      try {
        const raw = await fs.readFile(cfgPath, 'utf8');
        const parsed = yaml.load(raw) as WorldConfig;
        if (parsed && parsed.name) {
          worlds.push({
            ...parsed,
            slug: dirent.name,
            entityTypes:
              Array.isArray(parsed.entityTypes) && parsed.entityTypes.length > 0
                ? parsed.entityTypes
                : cloneStarterEntityTypes(),
            theme: parsed.theme ?? getDefaultWorldTheme('parchment-lorebook'),
          });
        }
      } catch {
        // Skip malformed world config instead of crashing workspace load
      }
    }

    return worlds.sort((a, b) => a.name.localeCompare(b.name));
  }

  async createWorld(input: CreateWorldInput): Promise<WorldConfig> {
    const baseSlug = slugify(input.name);
    let slug = baseSlug;
    let suffix = 2;
    while (await exists(this.worldDir(slug))) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const now = new Date().toISOString();
    const config: WorldConfig = {
      id: crypto.randomUUID(),
      slug,
      name: input.name.trim() || 'Untitled World',
      subtitle: input.subtitle?.trim() || '',
      medium: input.medium,
      theme: getDefaultWorldTheme(input.preset ?? 'parchment-lorebook'),
      entityTypes: cloneStarterEntityTypes(),
      createdAt: now,
      updatedAt: now,
    };

    await fs.mkdir(this.entriesDir(slug), { recursive: true });
    await fs.mkdir(this.assetsDir(slug), { recursive: true });
    await atomicWriteFile(this.worldConfigPath(slug), yaml.dump(config));
    await atomicWriteFile(this.artManifestPath(slug), yaml.dump({ assets: [] } satisfies ArtManifestFile));

    return config;
  }

  async updateWorld(
    worldSlug: string,
    patch: Partial<Pick<WorldConfig, 'name' | 'subtitle' | 'medium' | 'coverAssetId' | 'theme' | 'entityTypes'>>
  ): Promise<WorldConfig> {
    const worlds = await this.listWorlds();
    const current = worlds.find((w) => w.slug === worldSlug);
    if (!current) {
      throw new Error(`World not found: ${worldSlug}`);
    }
    const updated: WorldConfig = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await atomicWriteFile(this.worldConfigPath(worldSlug), yaml.dump(updated));
    return updated;
  }

  async deleteWorld(worldSlug: string): Promise<void> {
    const dir = this.worldDir(worldSlug);
    if (!(await exists(dir))) return;
    await moveToTrash(dir, path.join(this.rootPath, '.trash', 'worlds'), worldSlug);
  }

  /**
   * One-time repair for files written by Loreloom <= 0.6.5, whose editor escaped `[[wikilinks]]`
   * as `\[\[…\]\]`. Rewrites only files that contain the escaped form. Returns files repaired.
   */
  async repairEscapedWikilinksInWorld(worldSlug: string): Promise<number> {
    const root = this.entriesDir(worldSlug);
    if (!(await exists(root))) return 0;
    let repaired = 0;
    const walk = async (dir: string): Promise<void> => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          await walk(fullPath);
        } else if (item.isFile() && item.name.toLowerCase().endsWith('.md')) {
          try {
            const raw = await fs.readFile(fullPath, 'utf8');
            const fixed = repairEscapedWikilinks(raw);
            if (fixed !== raw) {
              await atomicWriteFile(fullPath, fixed);
              repaired++;
            }
          } catch {
            // Skip files locked by OneDrive/Google Drive; they are retried on the next launch
          }
        }
      }
    };
    await walk(root);
    return repaired;
  }

  async listAllEntriesInWorld(worldSlug: string): Promise<Entry[]> {
    const root = this.entriesDir(worldSlug);
    if (!(await exists(root))) return [];

    const results: Entry[] = [];
    const walk = async (currentDir: string, folderRel: string): Promise<void> => {
      const items = await fs.readdir(currentDir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(currentDir, item.name);
        if (item.isDirectory()) {
          const nextFolder = folderRel ? `${folderRel}/${item.name}` : item.name;
          await walk(fullPath, nextFolder);
        } else if (item.isFile() && item.name.toLowerCase().endsWith('.md')) {
          const entry = await this.parseEntryFile(worldSlug, fullPath, folderRel);
          if (entry) results.push(entry);
        }
      }
    };

    await walk(root, '');
    return results;
  }

  private async parseEntryFile(
    worldSlug: string,
    fullPath: string,
    folderRel: string
  ): Promise<Entry | null> {
    try {
      const [raw, stat] = await Promise.all([fs.readFile(fullPath, 'utf8'), fs.stat(fullPath)]);
      const parsed = matter(raw);
      const data = (parsed.data ?? {}) as Record<string, unknown>;
      const filenameBase = path.basename(fullPath, path.extname(fullPath));
      const relativePath = path
        .relative(this.entriesDir(worldSlug), fullPath)
        .replace(/\\/g, '/');

      const id =
        typeof data.id === 'string' && data.id.trim()
          ? data.id.trim()
          : crypto.createHash('sha1').update(`${worldSlug}:${relativePath}`).digest('hex').slice(0, 16);

      const title =
        typeof data.title === 'string' && data.title.trim() ? data.title.trim() : filenameBase;
      const type = typeof data.type === 'string' && data.type.trim() ? data.type.trim() : 'page';
      const secondaryTypes = Array.isArray(data.secondaryTypes)
        ? Array.from(
            new Set(
              data.secondaryTypes
                .map((t) => String(t).trim())
                .filter((t) => Boolean(t) && t !== type)
            )
          )
        : [];
      const relationships: EntryRelationship[] = Array.isArray(data.relationships)
        ? data.relationships
            .filter(
              (r): r is Record<string, unknown> =>
                Boolean(r) && typeof r === 'object' && typeof (r as Record<string, unknown>).targetId === 'string'
            )
            .map((r) => ({
              id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
              targetId: String(r.targetId),
              label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : 'Related to',
            }))
        : [];
      const tags = Array.isArray(data.tags)
        ? data.tags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean)
        : typeof data.tags === 'string'
          ? data.tags
              .split(',')
              .map((t) => t.replace(/^#/, '').trim())
              .filter(Boolean)
          : [];

      const properties: Record<string, EntryPropertyValue> = {};
      if (data.properties && typeof data.properties === 'object' && !Array.isArray(data.properties)) {
        for (const [k, rawV] of Object.entries(data.properties as Record<string, unknown>)) {
          const v = normalizeYamlValue(rawV);
          if (
            typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean' ||
            Array.isArray(v)
          ) {
            properties[k] = Array.isArray(v) ? v.map(String) : v;
          }
        }
      }

      const body = parsed.content.replace(/^\r?\n/, '');
      const createdAtRaw = data.createdAt instanceof Date ? data.createdAt.toISOString() : data.createdAt;
      const updatedAtRaw = data.updatedAt instanceof Date ? data.updatedAt.toISOString() : data.updatedAt;
      const createdAt =
        typeof createdAtRaw === 'string' ? createdAtRaw : stat.birthtime.toISOString();
      const updatedAt =
        typeof updatedAtRaw === 'string' ? updatedAtRaw : stat.mtime.toISOString();

      const extraFrontmatter: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (!MANAGED_FRONTMATTER_KEYS.has(k)) extraFrontmatter[k] = normalizeYamlValue(v);
      }

      return {
        id,
        worldSlug,
        title,
        slug: filenameBase,
        type,
        secondaryTypes,
        relationships,
        folder: folderRel,
        relativePath,
        tags,
        properties,
        coverAssetId: typeof data.coverAssetId === 'string' ? data.coverAssetId : undefined,
        portraitAssetId: typeof data.portraitAssetId === 'string' ? data.portraitAssetId : undefined,
        createdAt,
        updatedAt,
        excerpt: extractExcerpt(body),
        body,
        ...(Object.keys(extraFrontmatter).length > 0 ? { extraFrontmatter } : {}),
      };
    } catch {
      return null;
    }
  }

  private serializeEntry(entry: Entry): string {
    const frontmatter: Record<string, unknown> = {
      id: entry.id,
      title: entry.title,
      type: entry.type,
      tags: entry.tags,
      properties: entry.properties,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
    if (entry.secondaryTypes && entry.secondaryTypes.length > 0) {
      frontmatter.secondaryTypes = entry.secondaryTypes.filter((t) => t !== entry.type);
    }
    if (entry.relationships && entry.relationships.length > 0) {
      frontmatter.relationships = entry.relationships;
    }
    if (entry.coverAssetId) frontmatter.coverAssetId = entry.coverAssetId;
    if (entry.portraitAssetId) frontmatter.portraitAssetId = entry.portraitAssetId;
    for (const [k, v] of Object.entries(entry.extraFrontmatter ?? {})) {
      if (!MANAGED_FRONTMATTER_KEYS.has(k) && v !== undefined) frontmatter[k] = v;
    }

    return matter.stringify(entry.body || '', frontmatter);
  }

  /**
   * Optional fast path (set by the app to the LocalIndex): returns the entry's relative path so a
   * lookup reads one file instead of parsing every file in the World.
   */
  private entryLocator: ((worldSlug: string, entryId: string) => string | null) | null = null;

  setEntryLocator(locator: ((worldSlug: string, entryId: string) => string | null) | null): void {
    this.entryLocator = locator;
  }

  async readEntryById(worldSlug: string, entryId: string): Promise<Entry | null> {
    const hinted = this.entryLocator?.(worldSlug, entryId);
    if (hinted) {
      const entry = await this.readEntryAtRelativePath(worldSlug, hinted);
      if (entry && entry.id === entryId) return entry;
    }
    const all = await this.listAllEntriesInWorld(worldSlug);
    return all.find((e) => e.id === entryId) ?? null;
  }

  /** Parses one entry file by its path relative to `<world>/entries` (null if missing or invalid). */
  async readEntryAtRelativePath(worldSlug: string, relativePath: string): Promise<Entry | null> {
    try {
      const entriesRoot = this.entriesDir(worldSlug);
      const fullPath = resolveInside(entriesRoot, relativePath);
      if (!fullPath.toLowerCase().endsWith('.md') || !(await exists(fullPath))) return null;
      const folderRel = path.relative(entriesRoot, path.dirname(fullPath)).replace(/\\/g, '/');
      return await this.parseEntryFile(worldSlug, fullPath, folderRel);
    } catch {
      return null;
    }
  }

  /**
   * Gives the file at `relativePath` a fresh frontmatter `id`. Used to resolve two files that share
   * one id (typically an OneDrive/Google Drive conflict copy).
   */
  async reassignEntryId(worldSlug: string, relativePath: string): Promise<Entry> {
    const fullPath = resolveInside(this.entriesDir(worldSlug), relativePath);
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = matter(raw);
    const newId = crypto.randomUUID();
    await atomicWriteFile(fullPath, matter.stringify(parsed.content, { ...parsed.data, id: newId }));
    const entry = await this.readEntryAtRelativePath(worldSlug, relativePath);
    if (!entry) throw new Error(`Could not re-read ${relativePath}`);
    return entry;
  }

  async createEntry(input: CreateEntryInput): Promise<Entry> {
    return this.locks.run(`create:${input.worldSlug}`, () => this.createEntryUnlocked(input));
  }

  private async createEntryUnlocked(input: CreateEntryInput): Promise<Entry> {
    const now = new Date().toISOString();
    const folder = (input.folder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const targetDir = folder
      ? resolveInside(this.entriesDir(input.worldSlug), folder)
      : this.entriesDir(input.worldSlug);
    await fs.mkdir(targetDir, { recursive: true });

    const baseSlug = slugify(input.title);
    let slug = baseSlug;
    let suffix = 2;
    while (await exists(path.join(targetDir, `${slug}.md`))) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const fullPath = path.join(targetDir, `${slug}.md`);
    const relativePath = path.relative(this.entriesDir(input.worldSlug), fullPath).replace(/\\/g, '/');
    const body = input.body ?? '';

    const entryType = input.type || 'page';
    const entry: Entry = {
      id: crypto.randomUUID(),
      worldSlug: input.worldSlug,
      title: input.title.trim() || 'Untitled',
      slug,
      type: entryType,
      secondaryTypes: (input.secondaryTypes ?? []).filter((t) => t !== entryType),
      relationships: input.relationships ?? [],
      folder,
      relativePath,
      tags: input.tags ?? [],
      properties: input.properties ?? {},
      coverAssetId: input.coverAssetId,
      portraitAssetId: input.portraitAssetId,
      createdAt: now,
      updatedAt: now,
      excerpt: extractExcerpt(body),
      body,
    };

    await atomicWriteFile(fullPath, this.serializeEntry(entry));
    return entry;
  }

  /**
   * Updates an Entry. Writes to the same Entry are serialized. If `baseBody` is given and the body on
   * disk no longer matches it (another PC synced a change, or an intake update landed), the on-disk
   * version is kept and the incoming edit is saved as a separate "conflict copy" Entry instead.
   */
  async updateEntry(input: UpdateEntryInput): Promise<UpdateEntryResult> {
    return this.locks.run(`entry:${input.worldSlug}:${input.id}`, async () => {
      const existing = await this.readEntryById(input.worldSlug, input.id);
      if (!existing) {
        throw new Error(`Entry not found: ${input.id}`);
      }

      if (
        input.baseBody !== undefined &&
        input.body !== undefined &&
        normalizeBodyForCompare(existing.body) !== normalizeBodyForCompare(input.baseBody) &&
        normalizeBodyForCompare(existing.body) !== normalizeBodyForCompare(input.body)
      ) {
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const copy = await this.createEntry({
          worldSlug: input.worldSlug,
          title: `${input.title ?? existing.title} (conflict copy ${stamp})`,
          type: existing.type,
          secondaryTypes: existing.secondaryTypes,
          folder: existing.folder,
          tags: Array.from(new Set([...(input.tags ?? existing.tags), 'conflict'])),
          properties: input.properties ?? existing.properties,
          body: input.body,
        });
        return { ...existing, conflictCopy: { id: copy.id, title: copy.title } };
      }

      return this.writeEntryUpdate(existing, input);
    });
  }

  private async writeEntryUpdate(existing: Entry, input: UpdateEntryInput): Promise<Entry> {

    const oldFullPath = path.join(this.entriesDir(input.worldSlug), existing.relativePath);
    const nextFolder =
      input.folder !== undefined
        ? input.folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
        : existing.folder;
    const nextTitle = input.title !== undefined ? input.title.trim() || 'Untitled' : existing.title;
    const nextBody = input.body !== undefined ? input.body : existing.body;

    let nextRelativePath = existing.relativePath;
    let nextSlug = existing.slug;

    if (nextFolder !== existing.folder) {
      const targetDir = nextFolder
        ? resolveInside(this.entriesDir(input.worldSlug), nextFolder)
        : this.entriesDir(input.worldSlug);
      await fs.mkdir(targetDir, { recursive: true });
      let candidate = existing.slug;
      let suffix = 2;
      while (await exists(path.join(targetDir, `${candidate}.md`))) {
        candidate = `${existing.slug}-${suffix++}`;
      }
      nextSlug = candidate;
      nextRelativePath = nextFolder ? `${nextFolder}/${candidate}.md` : `${candidate}.md`;
    }

    const nextType = input.type ?? existing.type;
    const nextSecondaryTypes = (
      input.secondaryTypes !== undefined ? input.secondaryTypes : existing.secondaryTypes ?? []
    ).filter((t) => t !== nextType);

    const updated: Entry = {
      ...existing,
      title: nextTitle,
      slug: nextSlug,
      folder: nextFolder,
      relativePath: nextRelativePath,
      type: nextType,
      secondaryTypes: Array.from(new Set(nextSecondaryTypes)),
      relationships:
        input.relationships !== undefined ? input.relationships : existing.relationships ?? [],
      tags: input.tags ?? existing.tags,
      properties: input.properties ?? existing.properties,
      coverAssetId:
        input.coverAssetId === null
          ? undefined
          : input.coverAssetId !== undefined
            ? input.coverAssetId
            : existing.coverAssetId,
      portraitAssetId:
        input.portraitAssetId === null
          ? undefined
          : input.portraitAssetId !== undefined
            ? input.portraitAssetId
            : existing.portraitAssetId,
      body: nextBody,
      excerpt: extractExcerpt(nextBody),
      updatedAt: new Date().toISOString(),
    };

    const newFullPath = path.join(this.entriesDir(input.worldSlug), updated.relativePath);
    await atomicWriteFile(newFullPath, this.serializeEntry(updated));
    if (newFullPath !== oldFullPath && (await exists(oldFullPath))) {
      await withFsRetry(() => fs.unlink(oldFullPath));
    }
    return updated;
  }

  /** Moves the Entry's file to `<world>/.trash/entries/` (restorable) rather than deleting it. */
  async deleteEntry(worldSlug: string, entryId: string): Promise<void> {
    await this.locks.run(`entry:${worldSlug}:${entryId}`, async () => {
      const existing = await this.readEntryById(worldSlug, entryId);
      if (!existing) return;
      const fullPath = path.join(this.entriesDir(worldSlug), existing.relativePath);
      if (await exists(fullPath)) {
        await moveToTrash(
          fullPath,
          this.worldTrashDir(worldSlug, 'entries'),
          existing.relativePath.replace(/\//g, '__')
        );
      }
    });
  }

  private async readArtManifest(worldSlug: string): Promise<ArtAsset[]> {
    const manifestPath = this.artManifestPath(worldSlug);
    if (!(await exists(manifestPath))) return [];
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = yaml.load(raw) as ArtManifestFile | undefined;
      return parsed && Array.isArray(parsed.assets) ? parsed.assets : [];
    } catch {
      return [];
    }
  }

  private async writeArtManifest(worldSlug: string, assets: ArtAsset[]): Promise<void> {
    const clean = assets.map(({ missing: _missing, ...rest }) => rest);
    await atomicWriteFile(this.artManifestPath(worldSlug), yaml.dump({ assets: clean }));
  }

  /**
   * Lists art assets. Image files dropped straight into `assets/` are added to the manifest, but
   * records are NEVER removed on read: on a second PC the manifest often syncs before the images,
   * and pruning would permanently erase captions, tags, categories and the IDs Entries link to.
   * Records whose file is not on disk yet are returned with `missing: true`.
   */
  async listArtAssets(worldSlug: string): Promise<ArtAsset[]> {
    return this.locks.run(`art:${worldSlug}`, () => this.listArtAssetsUnlocked(worldSlug));
  }

  private async listArtAssetsUnlocked(worldSlug: string): Promise<ArtAsset[]> {
    const assetsFolder = this.assetsDir(worldSlug);
    await fs.mkdir(assetsFolder, { recursive: true });
    const assets = await this.readArtManifest(worldSlug);

    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
    const filesOnDisk = await fs.readdir(assetsFolder, { withFileTypes: true });
    const knownFilenames = new Set(assets.map((a) => a.filename));
    let dirty = false;

    for (const file of filesOnDisk) {
      if (!file.isFile()) continue;
      const ext = path.extname(file.name).toLowerCase();
      if (!imageExts.has(ext)) continue;
      if (!knownFilenames.has(file.name)) {
        const title = path.basename(file.name, ext).replace(/[-_]+/g, ' ');
        assets.push({
          id: crypto.randomUUID(),
          worldSlug,
          filename: file.name,
          relativePath: `assets/${file.name}`,
          title,
          category: 'other',
          tags: [],
          caption: '',
          createdAt: new Date().toISOString(),
        });
        dirty = true;
      }
    }

    if (dirty) {
      await this.writeArtManifest(worldSlug, assets);
    }

    const diskSet = new Set(filesOnDisk.filter((f) => f.isFile()).map((f) => f.name));
    return assets
      .map((a) => (diskSet.has(a.filename) ? a : { ...a, missing: true }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveArtAssetFromPath(
    worldSlug: string,
    sourcePath: string,
    category: ArtCategory = 'other'
  ): Promise<ArtAsset> {
    const buffer = await fs.readFile(sourcePath);
    return this.saveArtAssetFromBuffer(worldSlug, path.basename(sourcePath), buffer, category);
  }

  async saveArtAssetFromBuffer(
    worldSlug: string,
    originalFilename: string,
    buffer: Buffer,
    category: ArtCategory = 'other'
  ): Promise<ArtAsset> {
    return this.locks.run(`art:${worldSlug}`, async () => {
      const assetsFolder = this.assetsDir(worldSlug);
      await fs.mkdir(assetsFolder, { recursive: true });

      const ext = path.extname(originalFilename).toLowerCase() || '.png';
      const baseName = slugify(path.basename(originalFilename, ext));
      let filename = `${baseName}${ext}`;
      let suffix = 2;
      while (await exists(path.join(assetsFolder, filename))) {
        filename = `${baseName}-${suffix++}${ext}`;
      }

      // Register in the manifest before the file exists on disk, so a concurrent reconcile
      // can't create a duplicate record for it.
      const existing = await this.readArtManifest(worldSlug);
      const asset: ArtAsset = {
        id: crypto.randomUUID(),
        worldSlug,
        filename,
        relativePath: `assets/${filename}`,
        title: path.basename(originalFilename, ext).replace(/[-_]+/g, ' '),
        category,
        tags: [],
        caption: '',
        createdAt: new Date().toISOString(),
      };
      await atomicWriteFile(path.join(assetsFolder, filename), buffer);
      await this.writeArtManifest(worldSlug, [asset, ...existing.filter((a) => a.filename !== filename)]);
      return asset;
    });
  }

  /** Replaces an existing asset's image bytes in place, keeping its ID, caption, tags and links. */
  async replaceArtAssetFile(worldSlug: string, assetId: string, sourcePath: string): Promise<ArtAsset | null> {
    return this.locks.run(`art:${worldSlug}`, async () => {
      const assets = await this.readArtManifest(worldSlug);
      const target = assets.find((a) => a.id === assetId);
      if (!target) return null;
      const buffer = await fs.readFile(sourcePath);
      await atomicWriteFile(path.join(this.assetsDir(worldSlug), target.filename), buffer);
      return target;
    });
  }

  async updateArtAsset(
    worldSlug: string,
    assetId: string,
    patch: Partial<Pick<ArtAsset, 'title' | 'category' | 'tags' | 'caption'>>
  ): Promise<ArtAsset> {
    return this.locks.run(`art:${worldSlug}`, async () => {
      const assets = await this.readArtManifest(worldSlug);
      const idx = assets.findIndex((a) => a.id === assetId);
      if (idx === -1) throw new Error(`Art asset not found: ${assetId}`);
      const updated: ArtAsset = { ...assets[idx], ...patch };
      assets[idx] = updated;
      await this.writeArtManifest(worldSlug, assets);
      return updated;
    });
  }

  /** Moves the image and its metadata record to `<world>/.trash/assets/` (restorable). */
  async deleteArtAsset(worldSlug: string, assetId: string): Promise<void> {
    await this.locks.run(`art:${worldSlug}`, async () => {
      const assets = await this.readArtManifest(worldSlug);
      const target = assets.find((a) => a.id === assetId);
      if (!target) return;
      const trashDir = this.worldTrashDir(worldSlug, 'assets');
      const fullPath = path.join(this.assetsDir(worldSlug), target.filename);
      if (await exists(fullPath)) {
        const dest = await moveToTrash(fullPath, trashDir, target.filename);
        await atomicWriteFile(`${dest}.meta.yaml`, yaml.dump(target));
      }
      await this.writeArtManifest(
        worldSlug,
        assets.filter((a) => a.id !== assetId)
      );
    });
  }

  async createMap(worldSlug: string, title: string, assetId: string): Promise<WorldMapDef> {
    return this.locks.run(`maps:${worldSlug}`, () => this.createMapUnlocked(worldSlug, title, assetId));
  }

  async updateMap(
    worldSlug: string,
    mapId: string,
    patch: Partial<Pick<WorldMapDef, 'title' | 'assetId' | 'pins'>>
  ): Promise<WorldMapDef> {
    return this.locks.run(`maps:${worldSlug}`, () => this.updateMapUnlocked(worldSlug, mapId, patch));
  }

  /** Removes the map from maps.yaml, keeping a restorable copy in `<world>/.trash/maps/`. */
  async deleteMap(worldSlug: string, mapId: string): Promise<void> {
    await this.locks.run(`maps:${worldSlug}`, async () => {
      const target = (await this.listMaps(worldSlug)).find((m) => m.id === mapId);
      if (target) {
        await atomicWriteFile(
          path.join(this.worldTrashDir(worldSlug, 'maps'), `${trashStamp()}__${mapId}.yaml`),
          yaml.dump(target)
        );
      }
      await this.deleteMapUnlocked(worldSlug, mapId);
    });
  }

  async createBoard(worldSlug: string, title: string): Promise<MoodboardDef> {
    return this.locks.run(`boards:${worldSlug}`, () => this.createBoardUnlocked(worldSlug, title));
  }

  async updateBoard(
    worldSlug: string,
    boardId: string,
    patch: Partial<Pick<MoodboardDef, 'title' | 'items'>>
  ): Promise<MoodboardDef> {
    return this.locks.run(`boards:${worldSlug}`, () => this.updateBoardUnlocked(worldSlug, boardId, patch));
  }

  /** Removes the board from boards.yaml, keeping a restorable copy in `<world>/.trash/boards/`. */
  async deleteBoard(worldSlug: string, boardId: string): Promise<void> {
    await this.locks.run(`boards:${worldSlug}`, async () => {
      const target = (await this.listBoards(worldSlug)).find((b) => b.id === boardId);
      if (target) {
        await atomicWriteFile(
          path.join(this.worldTrashDir(worldSlug, 'boards'), `${trashStamp()}__${boardId}.yaml`),
          yaml.dump(target)
        );
      }
      await this.deleteBoardUnlocked(worldSlug, boardId);
    });
  }

  resolveAssetAbsolutePath(worldSlug: string, relativePath: string): string {
    const clean = relativePath.replace(/^\/+/, '');
    return resolveInside(this.worldDir(worldSlug), clean);
  }

  async listMaps(worldSlug: string): Promise<WorldMapDef[]> {
    const manifestPath = this.mapsManifestPath(worldSlug);
    if (!(await exists(manifestPath))) return [];
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = yaml.load(raw) as MapsManifestFile | undefined;
      if (parsed && Array.isArray(parsed.maps)) {
        return parsed.maps;
      }
    } catch {
      // Ignore malformed maps.yaml
    }
    return [];
  }

  private async createMapUnlocked(worldSlug: string, title: string, assetId: string): Promise<WorldMapDef> {
    const maps = await this.listMaps(worldSlug);
    const now = new Date().toISOString();
    const created: WorldMapDef = {
      id: crypto.randomUUID(),
      worldSlug,
      title: title.trim() || 'Untitled Map',
      assetId,
      pins: [],
      createdAt: now,
      updatedAt: now,
    };
    const next = [...maps, created];
    await atomicWriteFile(this.mapsManifestPath(worldSlug), yaml.dump({ maps: next } satisfies MapsManifestFile));
    return created;
  }

  private async updateMapUnlocked(
    worldSlug: string,
    mapId: string,
    patch: Partial<Pick<WorldMapDef, 'title' | 'assetId' | 'pins'>>
  ): Promise<WorldMapDef> {
    const maps = await this.listMaps(worldSlug);
    const idx = maps.findIndex((m) => m.id === mapId);
    if (idx === -1) throw new Error(`Map not found: ${mapId}`);
    const updated: WorldMapDef = {
      ...maps[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    maps[idx] = updated;
    await atomicWriteFile(this.mapsManifestPath(worldSlug), yaml.dump({ maps } satisfies MapsManifestFile));
    return updated;
  }

  private async deleteMapUnlocked(worldSlug: string, mapId: string): Promise<void> {
    const maps = await this.listMaps(worldSlug);
    const remaining = maps.filter((m) => m.id !== mapId);
    await atomicWriteFile(
      this.mapsManifestPath(worldSlug),
      yaml.dump({ maps: remaining } satisfies MapsManifestFile)
    );
  }

  async listBoards(worldSlug: string): Promise<MoodboardDef[]> {
    const manifestPath = this.boardsManifestPath(worldSlug);
    if (!(await exists(manifestPath))) return [];
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = yaml.load(raw) as BoardsManifestFile | undefined;
      if (parsed && Array.isArray(parsed.boards)) {
        return parsed.boards;
      }
    } catch {
      // Ignore malformed boards.yaml
    }
    return [];
  }

  private async createBoardUnlocked(worldSlug: string, title: string): Promise<MoodboardDef> {
    const boards = await this.listBoards(worldSlug);
    const now = new Date().toISOString();
    const created: MoodboardDef = {
      id: crypto.randomUUID(),
      worldSlug,
      title: title.trim() || 'Untitled Moodboard',
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    const next = [...boards, created];
    await atomicWriteFile(
      this.boardsManifestPath(worldSlug),
      yaml.dump({ boards: next } satisfies BoardsManifestFile)
    );
    return created;
  }

  private async updateBoardUnlocked(
    worldSlug: string,
    boardId: string,
    patch: Partial<Pick<MoodboardDef, 'title' | 'items'>>
  ): Promise<MoodboardDef> {
    const boards = await this.listBoards(worldSlug);
    const idx = boards.findIndex((b) => b.id === boardId);
    if (idx === -1) throw new Error(`Moodboard not found: ${boardId}`);
    const updated: MoodboardDef = {
      ...boards[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    boards[idx] = updated;
    await atomicWriteFile(
      this.boardsManifestPath(worldSlug),
      yaml.dump({ boards } satisfies BoardsManifestFile)
    );
    return updated;
  }

  private async deleteBoardUnlocked(worldSlug: string, boardId: string): Promise<void> {
    const boards = await this.listBoards(worldSlug);
    const remaining = boards.filter((b) => b.id !== boardId);
    await atomicWriteFile(
      this.boardsManifestPath(worldSlug),
      yaml.dump({ boards: remaining } satisfies BoardsManifestFile)
    );
  }
}
