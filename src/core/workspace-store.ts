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
import { atomicWriteFile, exists, fileWriteObserver, moveToTrash, notifyWrite, trashStamp } from './fs-io';
import { RecordFolder } from './record-folder';
import type {
  ArtAsset,
  ArtCategory,
  CreateEntryInput,
  CreateWorldInput,
  EntityTypeDef,
  Entry,
  EntryPropertyValue,
  EntryRelationship,
  MoodboardDef,
  TrashItem,
  TrashKind,
  TrashRestoreResult,
  UpdateEntryInput,
  UpdateEntryResult,
  WorkspaceConfig,
  WorkspaceState,
  WorldConfig,
  WorldMapDef,
} from '../shared/types';

export { fileWriteObserver };

/**
 * On-disk layout version of a World. Version 2 stores art, maps, moodboards and entity types as
 * one file per record under `<world>/records/` instead of shared manifests. A World written by a
 * newer Loreloom (higher version) is opened read-only so this version can't damage it.
 */
export const WORLD_FORMAT_VERSION = 2;

export type RecordKind = 'art' | 'maps' | 'boards' | 'types';

/** Shared manifests used by Loreloom <= 0.6.8, absorbed into per-record files on sight. */
const LEGACY_MANIFESTS: Record<Exclude<RecordKind, 'types'>, string> = {
  art: 'art-manifest.yaml',
  maps: 'maps.yaml',
  boards: 'boards.yaml',
};
export const LEGACY_MANIFEST_FILES = new Set(Object.values(LEGACY_MANIFESTS));

type TypeRecord = EntityTypeDef & { order?: number };

export interface RecordMigrationReport {
  art: number;
  maps: number;
  boards: number;
  types: number;
  legacyFilesRetired: string[];
}

/** Stable ID for an image found in `assets/` without a record, so two PCs can't mint two IDs. */
function discoveredAssetId(worldSlug: string, filename: string): string {
  return `img-${crypto.createHash('sha1').update(`${worldSlug}/${filename}`).digest('hex').slice(0, 16)}`;
}

/** Trash folder per kind of deleted item. */
const TRASH_FOLDERS: Record<TrashKind, 'entries' | 'assets' | 'maps' | 'boards' | 'types'> = {
  entry: 'entries',
  art: 'assets',
  map: 'maps',
  board: 'boards',
  type: 'types',
};

const TRASH_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z__(.+)$/;

/** `2026-11-28T09-30-48-455Z__gate.png` → deleted-at ISO time and original name. */
function parseTrashName(name: string): { deletedAt: string; originalName: string } | null {
  const m = TRASH_NAME.exec(name);
  if (!m) return null;
  return { deletedAt: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`, originalName: m[6] };
}

/** `name.ext` → `name-restored.ext`, `name-restored-2.ext`, … until `taken` says it's free. */
async function freeName(name: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(name))) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = `${base}-restored${i > 1 ? `-${i}` : ''}${ext}`;
    if (!(await taken(candidate))) return candidate;
  }
}

function newerByUpdatedAt<T extends { updatedAt?: string }>(a: T, b: T): T {
  return String(b.updatedAt ?? '') > String(a.updatedAt ?? '') ? b : a;
}

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


/**
 * Deep module managing the on-disk OneDrive/Google Drive Workspace folder.
 * Hides YAML/Markdown serialization, atomic writes, slug collision handling,
 * and folder traversal behind a small, testable interface.
 */
export class WorkspaceStore {
  private readonly locks = new KeyedMutex();

  constructor(public readonly rootPath: string) {}

  /** `<world>/.trash/<kind>` — ignored by the watcher, kept in the synced folder so it can be restored. */
  public worldTrashDir(
    worldSlug: string,
    kind: 'entries' | 'assets' | 'maps' | 'boards' | 'types' | 'migrated'
  ): string {
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

  private legacyManifestPath(worldSlug: string, kind: Exclude<RecordKind, 'types'>): string {
    return path.join(this.worldDir(worldSlug), LEGACY_MANIFESTS[kind]);
  }

  /** `<world>/records/<kind>/` — one YAML file per art asset, map, moodboard or entity type. */
  public recordsDir(worldSlug: string, kind: RecordKind): string {
    return path.join(this.worldDir(worldSlug), 'records', kind);
  }

  private artRecords(worldSlug: string): RecordFolder<ArtAsset> {
    return new RecordFolder<ArtAsset>(this.recordsDir(worldSlug, 'art'));
  }

  private mapRecords(worldSlug: string): RecordFolder<WorldMapDef> {
    return new RecordFolder<WorldMapDef>(this.recordsDir(worldSlug, 'maps'));
  }

  private boardRecords(worldSlug: string): RecordFolder<MoodboardDef> {
    return new RecordFolder<MoodboardDef>(this.recordsDir(worldSlug, 'boards'));
  }

  private typeRecords(worldSlug: string): RecordFolder<TypeRecord> {
    return new RecordFolder<TypeRecord>(this.recordsDir(worldSlug, 'types'));
  }

  private async readWorldYaml(worldSlug: string): Promise<Record<string, unknown> | null> {
    const cfgPath = this.worldConfigPath(worldSlug);
    if (!(await exists(cfgPath))) return null;
    const parsed = yaml.load(await withFsRetry(() => fs.readFile(cfgPath, 'utf8')));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  }

  /** Throws if the World was written by a newer Loreloom whose layout this version doesn't know. */
  private async assertWritable(worldSlug: string): Promise<void> {
    const raw = await this.readWorldYaml(worldSlug).catch(() => null);
    const version = Number(raw?.formatVersion ?? 1);
    if (version > WORLD_FORMAT_VERSION) {
      throw new Error(
        `This World was saved by a newer version of Loreloom (format ${version}). Update Loreloom on this PC to edit it.`
      );
    }
  }

  /** Entity types in display order. Falls back to legacy `world.yaml` types, then the starter set. */
  private async readEntityTypes(worldSlug: string, raw: Record<string, unknown>): Promise<EntityTypeDef[]> {
    const records = await this.typeRecords(worldSlug).list().catch(() => [] as TypeRecord[]);
    if (records.length > 0) {
      return records
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
        .map(({ order: _order, ...type }) => type);
    }
    if (Array.isArray(raw.entityTypes) && raw.entityTypes.length > 0) return raw.entityTypes as EntityTypeDef[];
    return cloneStarterEntityTypes();
  }

  /** Writes changed/new type records and moves removed ones to `.trash/types/`. */
  private async writeEntityTypes(worldSlug: string, next: EntityTypeDef[]): Promise<void> {
    const folder = this.typeRecords(worldSlug);
    const existing = await folder.list();
    const orderById = new Map(existing.map((t) => [t.id, t.order ?? 0]));
    let maxOrder = existing.reduce((m, t) => Math.max(m, t.order ?? 0), -1);
    for (const type of next) {
      const order = orderById.get(type.id) ?? ++maxOrder;
      await folder.put({ ...type, order });
    }
    const keep = new Set(next.map((t) => t.id));
    for (const old of existing) {
      if (!keep.has(old.id)) await folder.remove(old.id, this.worldTrashDir(worldSlug, 'types'));
    }
  }

  /**
   * Moves a World from shared manifests (Loreloom <= 0.6.8) to one file per record, and absorbs
   * any manifest an older Loreloom on another PC writes later. Records already on disk win, except
   * a map or board whose legacy copy has a newer `updatedAt`. Retired manifests are kept in
   * `<world>/.trash/migrated/`. Safe to run any number of times, on any number of PCs.
   */
  async migrateWorldRecords(worldSlug: string): Promise<RecordMigrationReport> {
    return this.locks.run(`migrate:${worldSlug}`, async () => {
      const report: RecordMigrationReport = { art: 0, maps: 0, boards: 0, types: 0, legacyFilesRetired: [] };
      const raw = await this.readWorldYaml(worldSlug);
      if (!raw) return report;
      if (Number(raw.formatVersion ?? 1) > WORLD_FORMAT_VERSION) return report;
      const retire = async (kind: Exclude<RecordKind, 'types'>) => {
        await moveToTrash(
          this.legacyManifestPath(worldSlug, kind),
          this.worldTrashDir(worldSlug, 'migrated'),
          LEGACY_MANIFESTS[kind]
        );
        report.legacyFilesRetired.push(LEGACY_MANIFESTS[kind]);
      };
      const readLegacy = async (kind: Exclude<RecordKind, 'types'>, key: string): Promise<unknown[] | null> => {
        const file = this.legacyManifestPath(worldSlug, kind);
        if (!(await exists(file))) return null;
        try {
          const parsed = yaml.load(await withFsRetry(() => fs.readFile(file, 'utf8')));
          if (parsed === null || parsed === undefined) return [];
          const list = (parsed as Record<string, unknown>)[key];
          return Array.isArray(list) ? list : null;
        } catch {
          return null; // Malformed or locked: leave it in place and try again later
        }
      };

      await this.locks.run(`art:${worldSlug}`, async () => {
        const legacy = (await readLegacy('art', 'assets')) as ArtAsset[] | null;
        if (!legacy) return;
        const folder = this.artRecords(worldSlug);
        const current = await folder.list();
        const ids = new Set(current.map((a) => a.id));
        const filenames = new Set(current.map((a) => a.filename));
        for (const asset of legacy) {
          if (!asset || typeof asset.id !== 'string' || ids.has(asset.id) || filenames.has(asset.filename)) continue;
          const { missing: _missing, ...clean } = asset;
          await folder.put({ ...clean, worldSlug });
          ids.add(asset.id);
          filenames.add(asset.filename);
          report.art++;
        }
        await retire('art');
      });

      for (const kind of ['maps', 'boards'] as const) {
        await this.locks.run(`${kind}:${worldSlug}`, async () => {
          const legacy = (await readLegacy(kind, kind)) as Array<WorldMapDef | MoodboardDef> | null;
          if (!legacy) return;
          const folder = (kind === 'maps' ? this.mapRecords(worldSlug) : this.boardRecords(worldSlug)) as RecordFolder<
            WorldMapDef | MoodboardDef
          >;
          const current = new Map((await folder.list()).map((r) => [r.id, r]));
          for (const rec of legacy) {
            if (!rec || typeof rec.id !== 'string') continue;
            const mine = current.get(rec.id);
            const winner = mine ? newerByUpdatedAt(mine, rec) : rec;
            if (winner !== mine && (await folder.put({ ...winner, worldSlug }))) report[kind]++;
          }
          await retire(kind);
        });
      }

      await this.locks.run(`world:${worldSlug}`, async () => {
        const fresh = (await this.readWorldYaml(worldSlug)) ?? raw;
        const legacyTypes = Array.isArray(fresh.entityTypes) ? (fresh.entityTypes as EntityTypeDef[]) : null;
        if (legacyTypes) {
          await this.locks.run(`types:${worldSlug}`, async () => {
            const folder = this.typeRecords(worldSlug);
            const existing = await folder.list();
            const known = new Set(existing.map((t) => t.id));
            let maxOrder = existing.reduce((m, t) => Math.max(m, t.order ?? 0), -1);
            for (const type of legacyTypes) {
              if (!type || typeof type.id !== 'string' || known.has(type.id)) continue;
              await folder.put({ ...type, order: ++maxOrder });
              known.add(type.id);
              report.types++;
            }
          });
        }
        if (legacyTypes || Number(fresh.formatVersion ?? 1) < WORLD_FORMAT_VERSION) {
          const { entityTypes: _types, ...rest } = fresh;
          await atomicWriteFile(
            this.worldConfigPath(worldSlug),
            yaml.dump({ ...rest, formatVersion: WORLD_FORMAT_VERSION })
          );
        }
      });

      return report;
    });
  }

  private async absorbLegacy(worldSlug: string, kind: Exclude<RecordKind, 'types'>): Promise<void> {
    if (await exists(this.legacyManifestPath(worldSlug, kind))) {
      await this.migrateWorldRecords(worldSlug).catch(() => undefined);
    }
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
        let parsed = await this.readWorldYaml(dirent.name);
        if (parsed && Array.isArray(parsed.entityTypes)) {
          // Written by Loreloom <= 0.6.8 (here or on another PC): move its types to records
          await this.migrateWorldRecords(dirent.name).catch(() => undefined);
          parsed = (await this.readWorldYaml(dirent.name).catch(() => null)) ?? parsed;
        }
        if (parsed && parsed.name) {
          const { entityTypes: _legacyTypes, ...config } = parsed as unknown as WorldConfig;
          worlds.push({
            ...config,
            slug: dirent.name,
            entityTypes: await this.readEntityTypes(dirent.name, parsed),
            theme: config.theme ?? getDefaultWorldTheme('parchment-lorebook'),
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
    const { entityTypes: _types, ...onDisk } = config;
    await atomicWriteFile(this.worldConfigPath(slug), yaml.dump({ ...onDisk, formatVersion: WORLD_FORMAT_VERSION }));

    return config;
  }

  async updateWorld(
    worldSlug: string,
    patch: Partial<Pick<WorldConfig, 'name' | 'subtitle' | 'medium' | 'coverAssetId' | 'theme' | 'entityTypes'>>
  ): Promise<WorldConfig> {
    if (!(await this.readWorldYaml(worldSlug))) throw new Error(`World not found: ${worldSlug}`);
    await this.assertWritable(worldSlug);
    await this.migrateWorldRecords(worldSlug);
    const { entityTypes, ...configPatch } = patch;

    if (entityTypes) {
      await this.locks.run(`types:${worldSlug}`, () => this.writeEntityTypes(worldSlug, entityTypes));
    }
    // Only touch world.yaml when its own fields change: editing a type must not rewrite it
    if (Object.keys(configPatch).length > 0) {
      await this.locks.run(`world:${worldSlug}`, async () => {
        const raw = (await this.readWorldYaml(worldSlug)) ?? {};
        const { entityTypes: _legacy, ...rest } = raw;
        await atomicWriteFile(
          this.worldConfigPath(worldSlug),
          yaml.dump({ ...rest, ...configPatch, formatVersion: WORLD_FORMAT_VERSION, updatedAt: new Date().toISOString() })
        );
      });
    }

    const updated = (await this.listWorlds()).find((w) => w.slug === worldSlug);
    if (!updated) throw new Error(`World not found: ${worldSlug}`);
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

  /**
   * Lists art assets. Image files dropped straight into `assets/` get a record, but records are
   * NEVER removed on read: on a second PC the records often sync before the images,
   * and pruning would permanently erase captions, tags, categories and the IDs Entries link to.
   * Records whose file is not on disk yet are returned with `missing: true`.
   */
  async listArtAssets(worldSlug: string): Promise<ArtAsset[]> {
    // Absorb a legacy manifest first: migration takes the art lock itself
    await this.absorbLegacy(worldSlug, 'art');
    return this.locks.run(`art:${worldSlug}`, () => this.listArtAssetsUnlocked(worldSlug));
  }

  private async listArtAssetsUnlocked(worldSlug: string): Promise<ArtAsset[]> {
    const assetsFolder = this.assetsDir(worldSlug);
    await fs.mkdir(assetsFolder, { recursive: true });
    const records = this.artRecords(worldSlug);
    const assets = await records.list();
    const writable = await this.assertWritable(worldSlug).then(
      () => true,
      () => false
    );

    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
    const filesOnDisk = await fs.readdir(assetsFolder, { withFileTypes: true });
    const knownFilenames = new Set(assets.map((a) => a.filename));

    for (const file of filesOnDisk) {
      if (!file.isFile()) continue;
      const ext = path.extname(file.name).toLowerCase();
      if (!imageExts.has(ext)) continue;
      if (!knownFilenames.has(file.name)) {
        const title = path.basename(file.name, ext).replace(/[-_]+/g, ' ');
        const discovered: ArtAsset = {
          id: discoveredAssetId(worldSlug, file.name),
          worldSlug,
          filename: file.name,
          relativePath: `assets/${file.name}`,
          title,
          category: 'other',
          tags: [],
          caption: '',
          createdAt: new Date().toISOString(),
        };
        assets.push(discovered);
        knownFilenames.add(file.name);
        if (writable) await records.put(discovered).catch(() => false);
      }
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

      await this.assertWritable(worldSlug);
      // Write the record before the image, so a reconcile on this PC can't mint a second record
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
      await this.artRecords(worldSlug).put(asset);
      await atomicWriteFile(path.join(assetsFolder, filename), buffer);
      return asset;
    });
  }

  /** Replaces an existing asset's image bytes in place, keeping its ID, caption, tags and links. */
  async replaceArtAssetFile(worldSlug: string, assetId: string, sourcePath: string): Promise<ArtAsset | null> {
    return this.locks.run(`art:${worldSlug}`, async () => {
      await this.assertWritable(worldSlug);
      const target = await this.artRecords(worldSlug).get(assetId);
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
      await this.assertWritable(worldSlug);
      const records = this.artRecords(worldSlug);
      const current = await records.get(assetId);
      if (!current) throw new Error(`Art asset not found: ${assetId}`);
      const { missing: _missing, ...clean } = { ...current, ...patch };
      await records.put(clean);
      return clean;
    });
  }

  /** Moves the image and its metadata record to `<world>/.trash/assets/` (restorable). */
  async deleteArtAsset(worldSlug: string, assetId: string): Promise<void> {
    await this.locks.run(`art:${worldSlug}`, async () => {
      await this.assertWritable(worldSlug);
      const records = this.artRecords(worldSlug);
      const target = await records.get(assetId);
      if (!target) return;
      const trashDir = this.worldTrashDir(worldSlug, 'assets');
      const fullPath = path.join(this.assetsDir(worldSlug), target.filename);
      if (await exists(fullPath)) {
        const dest = await moveToTrash(fullPath, trashDir, target.filename);
        await atomicWriteFile(`${dest}.meta.yaml`, yaml.dump(target));
      }
      await records.remove(assetId);
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

  /** Removes the map's record, keeping a restorable copy in `<world>/.trash/maps/`. */
  async deleteMap(worldSlug: string, mapId: string): Promise<void> {
    await this.locks.run(`maps:${worldSlug}`, async () => {
      await this.assertWritable(worldSlug);
      const target = await this.mapRecords(worldSlug).get(mapId);
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

  /** Removes the board's record, keeping a restorable copy in `<world>/.trash/boards/`. */
  async deleteBoard(worldSlug: string, boardId: string): Promise<void> {
    await this.locks.run(`boards:${worldSlug}`, async () => {
      await this.assertWritable(worldSlug);
      const target = await this.boardRecords(worldSlug).get(boardId);
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
    await this.absorbLegacy(worldSlug, 'maps');
    const maps = await this.mapRecords(worldSlug).list();
    return maps.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  private async createMapUnlocked(worldSlug: string, title: string, assetId: string): Promise<WorldMapDef> {
    await this.assertWritable(worldSlug);
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
    await this.mapRecords(worldSlug).put(created);
    return created;
  }

  private async updateMapUnlocked(
    worldSlug: string,
    mapId: string,
    patch: Partial<Pick<WorldMapDef, 'title' | 'assetId' | 'pins'>>
  ): Promise<WorldMapDef> {
    await this.assertWritable(worldSlug);
    const records = this.mapRecords(worldSlug);
    const current = await records.get(mapId);
    if (!current) throw new Error(`Map not found: ${mapId}`);
    const updated: WorldMapDef = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await records.put(updated);
    return updated;
  }

  private async deleteMapUnlocked(worldSlug: string, mapId: string): Promise<void> {
    await this.mapRecords(worldSlug).remove(mapId);
  }

  async listBoards(worldSlug: string): Promise<MoodboardDef[]> {
    await this.absorbLegacy(worldSlug, 'boards');
    const boards = await this.boardRecords(worldSlug).list();
    return boards.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  private async createBoardUnlocked(worldSlug: string, title: string): Promise<MoodboardDef> {
    await this.assertWritable(worldSlug);
    const now = new Date().toISOString();
    const created: MoodboardDef = {
      id: crypto.randomUUID(),
      worldSlug,
      title: title.trim() || 'Untitled Moodboard',
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.boardRecords(worldSlug).put(created);
    return created;
  }

  private async updateBoardUnlocked(
    worldSlug: string,
    boardId: string,
    patch: Partial<Pick<MoodboardDef, 'title' | 'items'>>
  ): Promise<MoodboardDef> {
    await this.assertWritable(worldSlug);
    const records = this.boardRecords(worldSlug);
    const current = await records.get(boardId);
    if (!current) throw new Error(`Moodboard not found: ${boardId}`);
    const updated: MoodboardDef = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await records.put(updated);
    return updated;
  }

  private async deleteBoardUnlocked(worldSlug: string, boardId: string): Promise<void> {
    await this.boardRecords(worldSlug).remove(boardId);
  }

  // ---------------------------------------------------------------------------------------------
  // Trash: everything Loreloom deletes is moved to `<world>/.trash/<kind>/<stamp>__<name>`.

  private resolveTrashItem(worldSlug: string, itemId: string): { kind: TrashKind; name: string; file: string } {
    const slash = itemId.indexOf('/');
    const kind = itemId.slice(0, slash) as TrashKind;
    const name = itemId.slice(slash + 1);
    if (slash <= 0 || !(kind in TRASH_FOLDERS)) throw new Error(`Unknown trash item: ${itemId}`);
    assertSafeSegment(name, 'trash item');
    if (!parseTrashName(name)) throw new Error(`Unknown trash item: ${itemId}`);
    return { kind, name, file: path.join(this.worldTrashDir(worldSlug, TRASH_FOLDERS[kind]), name) };
  }

  private async readTrashYaml(file: string): Promise<Record<string, unknown> | null> {
    try {
      const parsed = yaml.load(await fs.readFile(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** Lists a World's deleted entries, art, maps, moodboards and types, newest first. */
  async listTrash(worldSlug: string): Promise<TrashItem[]> {
    const items: TrashItem[] = [];
    for (const kind of Object.keys(TRASH_FOLDERS) as TrashKind[]) {
      const dir = this.worldTrashDir(worldSlug, TRASH_FOLDERS[kind]);
      const names = await fs.readdir(dir).catch(() => [] as string[]);
      for (const name of names) {
        if (kind === 'art' && name.endsWith('.meta.yaml')) continue;
        const parsed = parseTrashName(name);
        if (!parsed) continue;
        const file = path.join(dir, name);
        let title = parsed.originalName;
        try {
          if (kind === 'entry') {
            const fm = matter(await fs.readFile(file, 'utf8')).data as { title?: unknown };
            if (typeof fm.title === 'string' && fm.title.trim()) title = fm.title;
          } else {
            const rec = await this.readTrashYaml(kind === 'art' ? `${file}.meta.yaml` : file);
            const label = kind === 'type' ? rec?.name : rec?.title;
            if (typeof label === 'string' && label.trim()) title = label;
          }
        } catch {
          // Unreadable item: still listed by its file name so it can be restored or removed
        }
        items.push({
          id: `${kind}/${name}`,
          kind,
          title,
          deletedAt: parsed.deletedAt,
          originalName: kind === 'entry' ? parsed.originalName.replace(/__/g, '/') : parsed.originalName.replace(/\.yaml$/, ''),
        });
      }
    }
    return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  /**
   * Puts a trashed item back where it was. If its old name or ID has been reused since, it comes
   * back under a new one (`-restored`) rather than overwriting anything.
   */
  async restoreTrashItem(worldSlug: string, itemId: string): Promise<TrashRestoreResult> {
    await this.assertWritable(worldSlug);
    const { kind, name, file } = this.resolveTrashItem(worldSlug, itemId);
    if (!(await exists(file))) throw new Error('That item is no longer in the Trash.');
    const { originalName } = parseTrashName(name)!;
    const moveOut = async (dest: string) => {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      notifyWrite(dest);
      await withFsRetry(() => fs.rename(file, dest));
    };

    if (kind === 'entry') {
      const raw = await fs.readFile(file, 'utf8');
      const fm = matter(raw).data as { id?: unknown; title?: unknown };
      const id = typeof fm.id === 'string' ? fm.id : '';
      const title = typeof fm.title === 'string' ? fm.title : originalName;
      if (id) {
        const clash = await this.readEntryById(worldSlug, id);
        if (clash) {
          throw new Error(`"${clash.title}" already uses this entry's ID, so it can't be restored alongside it.`);
        }
      }
      const entriesRoot = this.entriesDir(worldSlug);
      const wanted = originalName.replace(/__/g, '/');
      const folder = path.posix.dirname(wanted) === '.' ? '' : path.posix.dirname(wanted);
      const fileName = await freeName(path.posix.basename(wanted), (c) =>
        exists(resolveInside(entriesRoot, folder ? `${folder}/${c}` : c))
      );
      const relativePath = folder ? `${folder}/${fileName}` : fileName;
      await this.locks.run(`entry:${worldSlug}:${id || relativePath}`, () => moveOut(resolveInside(entriesRoot, relativePath)));
      return { kind, title, restoredId: id, relativePath, renamed: relativePath !== wanted };
    }

    if (kind === 'art') {
      return this.locks.run(`art:${worldSlug}`, async () => {
        const assetsFolder = this.assetsDir(worldSlug);
        const filename = await freeName(assertSafeSegment(originalName, 'file name'), (c) => exists(path.join(assetsFolder, c)));
        const meta = (await this.readTrashYaml(`${file}.meta.yaml`)) as Partial<ArtAsset> | null;
        const records = this.artRecords(worldSlug);
        let id = typeof meta?.id === 'string' ? meta.id : discoveredAssetId(worldSlug, filename);
        const idTaken = (await records.get(id)) !== null;
        if (idTaken) id = crypto.randomUUID();
        const asset: ArtAsset = {
          category: 'other',
          tags: [],
          caption: '',
          title: path.basename(filename, path.extname(filename)).replace(/[-_]+/g, ' '),
          createdAt: new Date().toISOString(),
          ...(meta ?? {}),
          id,
          worldSlug,
          filename,
          relativePath: `assets/${filename}`,
        } as ArtAsset;
        delete (asset as Partial<ArtAsset>).missing;
        await records.put(asset);
        await moveOut(path.join(assetsFolder, filename));
        await fs.rm(`${file}.meta.yaml`, { force: true });
        return { kind, title: asset.title, restoredId: id, renamed: idTaken || filename !== originalName };
      });
    }

    const rec = await this.readTrashYaml(file);
    if (!rec || typeof rec.id !== 'string') throw new Error('That item could not be read, so it was left in the Trash.');

    if (kind === 'type') {
      // Read outside the types lock: listWorlds may run the migration, which takes that lock itself
      const world = (await this.listWorlds()).find((w) => w.slug === worldSlug);
      if (!world) throw new Error(`World not found: ${worldSlug}`);
      return this.locks.run(`types:${worldSlug}`, async () => {
        if (world.entityTypes.some((t) => t.id === rec.id)) {
          throw new Error(`A type with the ID "${rec.id}" already exists, so this one can't be restored.`);
        }
        const { order: _order, ...type } = rec as unknown as TypeRecord;
        // Write the full list: a World still on the in-memory starter types has no records yet
        await this.writeEntityTypes(worldSlug, [...world.entityTypes, type]);
        await fs.rm(file, { force: true });
        return { kind, title: type.name, restoredId: type.id, renamed: false };
      });
    }

    const lockKey = kind === 'map' ? `maps:${worldSlug}` : `boards:${worldSlug}`;
    return this.locks.run(lockKey, async () => {
      const folder = (kind === 'map' ? this.mapRecords(worldSlug) : this.boardRecords(worldSlug)) as RecordFolder<
        WorldMapDef | MoodboardDef
      >;
      const record = { ...(rec as unknown as WorldMapDef | MoodboardDef), worldSlug };
      const idTaken = (await folder.get(record.id)) !== null;
      if (idTaken) {
        record.id = crypto.randomUUID();
        record.title = `${record.title} (restored)`;
      }
      record.updatedAt = new Date().toISOString();
      await folder.put(record);
      await fs.rm(file, { force: true });
      return { kind, title: record.title, restoredId: record.id, renamed: idTaken };
    });
  }

  /** Permanently deletes one trashed item (and an art item's metadata). Cannot be undone. */
  async deleteTrashItemForever(worldSlug: string, itemId: string): Promise<void> {
    const { kind, file } = this.resolveTrashItem(worldSlug, itemId);
    await withFsRetry(() => fs.rm(file, { recursive: true, force: true }));
    if (kind === 'art') await fs.rm(`${file}.meta.yaml`, { force: true });
  }
}
