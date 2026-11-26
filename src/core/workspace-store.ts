import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { cloneStarterEntityTypes } from '../shared/starter-types';
import { getDefaultWorldTheme } from './theme-engine';
import type {
  ArtAsset,
  ArtCategory,
  CreateEntryInput,
  CreateWorldInput,
  Entry,
  EntryPropertyValue,
  UpdateEntryInput,
  WorkspaceConfig,
  WorkspaceState,
  WorldConfig,
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

async function atomicWriteFile(filePath: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tempPath, content);
  await fs.rename(tempPath, filePath);
}

interface ArtManifestFile {
  assets: ArtAsset[];
}

/**
 * Deep module managing the on-disk OneDrive/Google Drive Workspace folder.
 * Hides YAML/Markdown serialization, atomic writes, slug collision handling,
 * and folder traversal behind a small, testable interface.
 */
export class WorkspaceStore {
  constructor(public readonly rootPath: string) {}

  private workspaceConfigPath(): string {
    return path.join(this.rootPath, 'workspace.yaml');
  }

  private worldsDir(): string {
    return path.join(this.rootPath, 'worlds');
  }

  public worldDir(worldSlug: string): string {
    return path.join(this.worldsDir(), worldSlug);
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
    await fs.rm(this.worldDir(worldSlug), { recursive: true, force: true });
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
        for (const [k, v] of Object.entries(data.properties as Record<string, unknown>)) {
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
      const createdAt =
        typeof data.createdAt === 'string' ? data.createdAt : stat.birthtime.toISOString();
      const updatedAt =
        typeof data.updatedAt === 'string' ? data.updatedAt : stat.mtime.toISOString();

      return {
        id,
        worldSlug,
        title,
        slug: filenameBase,
        type,
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
    if (entry.coverAssetId) frontmatter.coverAssetId = entry.coverAssetId;
    if (entry.portraitAssetId) frontmatter.portraitAssetId = entry.portraitAssetId;

    return matter.stringify(entry.body || '', frontmatter);
  }

  async readEntryById(worldSlug: string, entryId: string): Promise<Entry | null> {
    const all = await this.listAllEntriesInWorld(worldSlug);
    return all.find((e) => e.id === entryId) ?? null;
  }

  async createEntry(input: CreateEntryInput): Promise<Entry> {
    const now = new Date().toISOString();
    const folder = (input.folder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const targetDir = folder ? path.join(this.entriesDir(input.worldSlug), folder) : this.entriesDir(input.worldSlug);
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

    const entry: Entry = {
      id: crypto.randomUUID(),
      worldSlug: input.worldSlug,
      title: input.title.trim() || 'Untitled',
      slug,
      type: input.type || 'page',
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

  async updateEntry(input: UpdateEntryInput): Promise<Entry> {
    const existing = await this.readEntryById(input.worldSlug, input.id);
    if (!existing) {
      throw new Error(`Entry not found: ${input.id}`);
    }

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
        ? path.join(this.entriesDir(input.worldSlug), nextFolder)
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

    const updated: Entry = {
      ...existing,
      title: nextTitle,
      slug: nextSlug,
      folder: nextFolder,
      relativePath: nextRelativePath,
      type: input.type ?? existing.type,
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
      await fs.unlink(oldFullPath);
    }
    return updated;
  }

  async deleteEntry(worldSlug: string, entryId: string): Promise<void> {
    const existing = await this.readEntryById(worldSlug, entryId);
    if (!existing) return;
    const fullPath = path.join(this.entriesDir(worldSlug), existing.relativePath);
    if (await exists(fullPath)) {
      await fs.unlink(fullPath);
    }
  }

  async listArtAssets(worldSlug: string): Promise<ArtAsset[]> {
    const manifestPath = this.artManifestPath(worldSlug);
    const assetsFolder = this.assetsDir(worldSlug);
    await fs.mkdir(assetsFolder, { recursive: true });

    let assets: ArtAsset[] = [];
    if (await exists(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        const parsed = yaml.load(raw) as ArtManifestFile | undefined;
        if (parsed && Array.isArray(parsed.assets)) {
          assets = parsed.assets;
        }
      } catch {
        assets = [];
      }
    }

    // Reconcile any image files dropped directly into OneDrive/Google Drive assets/
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

    // Drop manifest records whose files no longer exist
    const diskSet = new Set(filesOnDisk.filter((f) => f.isFile()).map((f) => f.name));
    const filtered = assets.filter((a) => diskSet.has(a.filename));
    if (filtered.length !== assets.length) {
      assets = filtered;
      dirty = true;
    }

    if (dirty) {
      await atomicWriteFile(manifestPath, yaml.dump({ assets } satisfies ArtManifestFile));
    }

    return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    const assetsFolder = this.assetsDir(worldSlug);
    await fs.mkdir(assetsFolder, { recursive: true });

    const ext = path.extname(originalFilename).toLowerCase() || '.png';
    const baseName = slugify(path.basename(originalFilename, ext));
    let filename = `${baseName}${ext}`;
    let suffix = 2;
    while (await exists(path.join(assetsFolder, filename))) {
      filename = `${baseName}-${suffix++}${ext}`;
    }

    await atomicWriteFile(path.join(assetsFolder, filename), buffer);

    const existing = await this.listArtAssets(worldSlug);
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

    const next = [asset, ...existing.filter((a) => a.filename !== filename)];
    await atomicWriteFile(this.artManifestPath(worldSlug), yaml.dump({ assets: next } satisfies ArtManifestFile));
    return asset;
  }

  async updateArtAsset(
    worldSlug: string,
    assetId: string,
    patch: Partial<Pick<ArtAsset, 'title' | 'category' | 'tags' | 'caption'>>
  ): Promise<ArtAsset> {
    const assets = await this.listArtAssets(worldSlug);
    const idx = assets.findIndex((a) => a.id === assetId);
    if (idx === -1) throw new Error(`Art asset not found: ${assetId}`);
    const updated: ArtAsset = { ...assets[idx], ...patch };
    assets[idx] = updated;
    await atomicWriteFile(this.artManifestPath(worldSlug), yaml.dump({ assets } satisfies ArtManifestFile));
    return updated;
  }

  async deleteArtAsset(worldSlug: string, assetId: string): Promise<void> {
    const assets = await this.listArtAssets(worldSlug);
    const target = assets.find((a) => a.id === assetId);
    if (!target) return;
    const fullPath = path.join(this.assetsDir(worldSlug), target.filename);
    if (await exists(fullPath)) {
      await fs.unlink(fullPath);
    }
    const remaining = assets.filter((a) => a.id !== assetId);
    await atomicWriteFile(
      this.artManifestPath(worldSlug),
      yaml.dump({ assets: remaining } satisfies ArtManifestFile)
    );
  }

  resolveAssetAbsolutePath(worldSlug: string, relativePath: string): string {
    const clean = relativePath.replace(/^\/+/, '');
    const worldRoot = path.resolve(this.worldDir(worldSlug));
    const resolved = path.resolve(worldRoot, clean);
    if (!resolved.startsWith(worldRoot)) {
      throw new Error('Invalid asset path');
    }
    return resolved;
  }
}
