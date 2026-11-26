import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type {
  ArtCategory,
  EntryPropertyValue,
  ImportReport,
  VaultScanPreview,
  WorldMedium,
  WorldThemePresetId,
} from '../shared/types';
import type { WorkspaceStore } from './workspace-store';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const IGNORED_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);

interface ScannedFile {
  fullPath: string;
  relPath: string;
  folder: string;
  name: string;
  ext: string;
}

async function walkVault(vaultPath: string): Promise<{ notes: ScannedFile[]; images: ScannedFile[]; folders: Set<string> }> {
  const notes: ScannedFile[] = [];
  const images: ScannedFile[] = [];
  const folders = new Set<string>();

  const walk = async (dir: string, relFolder: string): Promise<void> => {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.') && IGNORED_DIRS.has(item.name)) continue;
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (IGNORED_DIRS.has(item.name)) continue;
        const nextRel = relFolder ? `${relFolder}/${item.name}` : item.name;
        folders.add(nextRel);
        await walk(fullPath, nextRel);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        const relPath = relFolder ? `${relFolder}/${item.name}` : item.name;
        const record: ScannedFile = {
          fullPath,
          relPath,
          folder: relFolder,
          name: item.name,
          ext,
        };
        if (ext === '.md') {
          notes.push(record);
        } else if (IMAGE_EXTENSIONS.has(ext)) {
          images.push(record);
        }
      }
    }
  };

  await walk(vaultPath, '');
  return { notes, images, folders };
}

function inferEntityTypeFromFolder(folder: string, frontmatterType?: unknown): string {
  if (typeof frontmatterType === 'string' && frontmatterType.trim()) {
    return frontmatterType.trim().toLowerCase();
  }
  const lower = folder.toLowerCase();
  if (lower.includes('character') || lower.includes('npc') || lower.includes('cast')) return 'character';
  if (lower.includes('location') || lower.includes('place') || lower.includes('region') || lower.includes('city')) return 'location';
  if (lower.includes('faction') || lower.includes('guild') || lower.includes('house') || lower.includes('org')) return 'faction';
  if (lower.includes('item') || lower.includes('artifact') || lower.includes('weapon') || lower.includes('relic')) return 'item';
  if (lower.includes('timeline') || lower.includes('event') || lower.includes('history')) return 'event';
  return 'page';
}

function inferArtCategoryFromFolder(folder: string): ArtCategory {
  const lower = folder.toLowerCase();
  if (lower.includes('char') || lower.includes('portrait') || lower.includes('npc')) return 'character';
  if (lower.includes('env') || lower.includes('land') || lower.includes('loc') || lower.includes('scene')) return 'environment';
  if (lower.includes('prop') || lower.includes('item') || lower.includes('weapon')) return 'prop';
  if (lower.includes('map')) return 'map';
  if (lower.includes('mood') || lower.includes('ref')) return 'mood';
  return 'other';
}

function extractInlineTags(body: string): string[] {
  const found = new Set<string>();
  const regex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9/_-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
}

/**
 * Non-destructive Obsidian vault importer.
 * Scans a vault directory and copies notes, frontmatter, [[wikilinks]], #tags,
 * and embedded images (![[art.png]]) into a Loreloom World without touching the original vault.
 */
export class ObsidianImporter {
  async scanVault(vaultPath: string): Promise<VaultScanPreview> {
    const { notes, images, folders } = await walkVault(vaultPath);
    const frontmatterKeys = new Set<string>();

    for (const note of notes.slice(0, 60)) {
      try {
        const raw = await fs.readFile(note.fullPath, 'utf8');
        const parsed = matter(raw);
        for (const key of Object.keys(parsed.data ?? {})) {
          frontmatterKeys.add(key);
        }
      } catch {
        // Ignore unreadable note during preview scan
      }
    }

    return {
      vaultPath,
      vaultName: path.basename(vaultPath),
      noteCount: notes.length,
      imageCount: images.length,
      folderCount: folders.size,
      sampleFolders: Array.from(folders).sort().slice(0, 12),
      frontmatterKeys: Array.from(frontmatterKeys).sort().slice(0, 20),
    };
  }

  async importVault(
    store: WorkspaceStore,
    options: {
      vaultPath: string;
      targetWorldSlug?: string;
      newWorldName?: string;
      newWorldMedium?: WorldMedium;
      newWorldPreset?: WorldThemePresetId;
    }
  ): Promise<ImportReport> {
    const { notes, images } = await walkVault(options.vaultPath);
    const warnings: string[] = [];

    let worldSlug = options.targetWorldSlug;
    let worldName = options.newWorldName || path.basename(options.vaultPath);

    if (!worldSlug) {
      const created = await store.createWorld({
        name: worldName,
        subtitle: `Imported from Obsidian vault "${path.basename(options.vaultPath)}"`,
        medium: options.newWorldMedium ?? 'novel',
        preset: options.newWorldPreset ?? 'parchment-lorebook',
      });
      worldSlug = created.slug;
      worldName = created.name;
    } else {
      const existing = (await store.listWorlds()).find((w) => w.slug === worldSlug);
      if (!existing) throw new Error(`Target world not found: ${worldSlug}`);
      worldName = existing.name;
    }

    // 1. Copy all vault images into world assets/ and build lookup map
    const assetByBasename = new Map<string, { id: string; filename: string; relativePath: string }>();
    const assetByRelPath = new Map<string, { id: string; filename: string; relativePath: string }>();
    let copiedAssets = 0;

    for (const img of images) {
      try {
        const saved = await store.saveArtAssetFromPath(
          worldSlug,
          img.fullPath,
          inferArtCategoryFromFolder(img.folder)
        );
        const ref = { id: saved.id, filename: saved.filename, relativePath: saved.relativePath };
        assetByBasename.set(img.name.toLowerCase(), ref);
        assetByRelPath.set(img.relPath.toLowerCase(), ref);
        copiedAssets++;
      } catch (err) {
        warnings.push(`Could not copy image ${img.relPath}: ${(err as Error).message}`);
      }
    }

    // Build set of known note titles/basenames for link resolution reporting
    const knownNoteNames = new Set<string>();
    for (const note of notes) {
      const base = path.basename(note.name, note.ext).toLowerCase();
      knownNoteNames.add(base);
      knownNoteNames.add(note.relPath.replace(/\.md$/i, '').toLowerCase());
    }

    let importedNotes = 0;
    let resolvedLinks = 0;
    const unresolvedLinks: Array<{ sourceTitle: string; target: string }> = [];

    // 2. Import notes, normalize frontmatter, rewrite ![[image]] embeds to ![alt](assets/<filename>)
    for (const note of notes) {
      try {
        const raw = await fs.readFile(note.fullPath, 'utf8');
        const parsed = matter(raw);
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        const filenameTitle = path.basename(note.name, note.ext);
        const title =
          typeof data.title === 'string' && data.title.trim() ? data.title.trim() : filenameTitle;

        const fmTags = Array.isArray(data.tags)
          ? data.tags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean)
          : typeof data.tags === 'string'
            ? data.tags
                .split(/[,\s]+/)
                .map((t) => t.replace(/^#/, '').trim())
                .filter(Boolean)
            : [];

        const inlineTags = extractInlineTags(parsed.content);
        const mergedTags = Array.from(new Set([...fmTags, ...inlineTags]));

        // Preserve non-reserved frontmatter keys as Entry properties
        const reserved = new Set(['id', 'title', 'type', 'tags', 'createdAt', 'updatedAt', 'coverAssetId', 'portraitAssetId']);
        const properties: Record<string, EntryPropertyValue> = {};
        for (const [k, v] of Object.entries(data)) {
          if (reserved.has(k) || v === null || v === undefined) continue;
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            properties[k] = v;
          } else if (Array.isArray(v)) {
            properties[k] = v.map(String);
          }
        }

        let firstEmbeddedAssetId: string | undefined;

        // Convert Obsidian image embeds ![[path/to/image.png|alt]] -> ![alt](assets/saved-name.png)
        const normalizedBody = parsed.content.replace(
          /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
          (_full, rawTarget: string, altText?: string) => {
            const cleanTarget = rawTarget.trim().replace(/\\/g, '/');
            const asset =
              assetByRelPath.get(cleanTarget.toLowerCase()) ??
              assetByBasename.get(path.basename(cleanTarget).toLowerCase());
            if (asset) {
              if (!firstEmbeddedAssetId) firstEmbeddedAssetId = asset.id;
              const alt = (altText || path.basename(cleanTarget, path.extname(cleanTarget))).trim();
              return `![${alt}](${asset.relativePath})`;
            }
            unresolvedLinks.push({ sourceTitle: title, target: cleanTarget });
            return `![[${rawTarget}]]`;
          }
        );

        // Audit standard [[wikilinks]]
        const wikiRegex = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
        let wikiMatch: RegExpExecArray | null;
        while ((wikiMatch = wikiRegex.exec(normalizedBody)) !== null) {
          const target = wikiMatch[1].trim();
          const lower = target.toLowerCase();
          if (knownNoteNames.has(lower) || knownNoteNames.has(path.basename(lower))) {
            resolvedLinks++;
          } else {
            unresolvedLinks.push({ sourceTitle: title, target });
          }
        }

        const inferredType = inferEntityTypeFromFolder(note.folder, data.type);

        await store.createEntry({
          worldSlug,
          title,
          type: inferredType,
          folder: note.folder,
          tags: mergedTags,
          properties,
          body: normalizedBody.trim(),
          portraitAssetId:
            inferredType === 'character' ? firstEmbeddedAssetId : undefined,
          coverAssetId:
            inferredType !== 'character' ? firstEmbeddedAssetId : undefined,
        });

        importedNotes++;
      } catch (err) {
        warnings.push(`Could not import note ${note.relPath}: ${(err as Error).message}`);
      }
    }

    return {
      worldSlug,
      worldName,
      importedNotes,
      copiedAssets,
      resolvedLinks,
      unresolvedLinks,
      warnings,
    };
  }
}
