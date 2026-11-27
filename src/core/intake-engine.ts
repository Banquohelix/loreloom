import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  NEEDS_TRIAGE_TAG,
  type ArtCategory,
  type EntityTypeDef,
  type EntryPropertyValue,
  type IntakeImportedItem,
  type IntakeSyncReport,
  type ReclassifyTriageReport,
  type WorldConfig,
} from '../shared/types';
import { normalizeFrontmatterType } from '../shared/type-normalizer';
import type { WorkspaceStore } from './workspace-store';

export { NEEDS_TRIAGE_TAG };

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const IGNORED_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules', '_imported']);

export interface NoteClassification {
  typeId: string;
  confidence: 'high' | 'medium' | 'low';
  extractedProperties: Record<string, EntryPropertyValue>;
  suggestedTags: string[];
  needsTriage: boolean;
}

export interface ArtClassification {
  category: ArtCategory;
  confidence: 'high' | 'medium' | 'low';
  suggestedTags: string[];
  needsTriage: boolean;
}

interface IntakeStateRecord {
  fingerprint: string;
  kind: 'entry' | 'art';
  targetId: string;
  lastSyncedAt: string;
}

interface IntakeStateFile {
  records: Record<string, IntakeStateRecord>;
}

const STARTER_PATH_KEYWORDS: Array<{ typeId: string; keywords: string[] }> = [
  { typeId: 'character', keywords: ['character', 'characters', 'npc', 'npcs', 'cast', 'hero', 'heroes', 'villain', 'villains', 'protagonist', 'companion', 'companions', 'people'] },
  { typeId: 'location', keywords: ['location', 'locations', 'place', 'places', 'region', 'regions', 'city', 'cities', 'town', 'realm', 'realms', 'world-map', 'geography', 'setting', 'district'] },
  { typeId: 'faction', keywords: ['faction', 'factions', 'guild', 'guilds', 'house', 'houses', 'organization', 'organizations', 'order', 'orders', 'clan', 'syndicate', 'empire', 'kingdom', 'cult'] },
  { typeId: 'item', keywords: ['item', 'items', 'artifact', 'artifacts', 'relic', 'relics', 'weapon', 'weapons', 'gear', 'equipment', 'armor', 'technology', 'tech', 'prop', 'props'] },
  { typeId: 'event', keywords: ['event', 'events', 'timeline', 'history', 'chronicle', 'war', 'era', 'epoch', 'battle'] },
];

const BODY_SIGNAL_KEYWORDS: Array<{ typeId: string; patterns: RegExp[] }> = [
  {
    typeId: 'character',
    patterns: [
      /\b(age|species|ancestry|personality|backstory|appearance|occupation|motivation|flaws|allies)\s*:/i,
      /\b(pronouns|character sheet|character profile|character bio)\b/i,
    ],
  },
  {
    typeId: 'location',
    patterns: [
      /\b(climate|biome|population|landmarks|geography|government|economy|atmosphere|sensory details)\s*:/i,
      /\b(capital city|port town|fortress|citadel|region overview)\b/i,
    ],
  },
  {
    typeId: 'faction',
    patterns: [
      /\b(headquarters|leader|leadership|ideology|ethos|motto|hierarchy|allegiance|resources|rivals)\s*:/i,
      /\b(faction overview|secret society|military order)\b/i,
    ],
  },
  {
    typeId: 'item',
    patterns: [
      /\b(rarity|material|abilities|properties|current holder|forged by|enchantment|specifications)\s*:/i,
      /\b(legendary weapon|ancient relic|artifact profile)\b/i,
    ],
  },
  {
    typeId: 'event',
    patterns: [
      /\b(in-world date|date|era|belligerents|casualties|aftermath|turning point|historical impact)\s*:/i,
      /\b(timeline of|chronology|historical event)\b/i,
    ],
  },
];

const ART_CATEGORY_KEYWORDS: Array<{ category: ArtCategory; keywords: string[] }> = [
  { category: 'map', keywords: ['map', 'atlas', 'cartography', 'worldmap', 'regionmap', 'floorplan', 'blueprint', 'layout'] },
  { category: 'character', keywords: ['char', 'character', 'portrait', 'npc', 'hero', 'villain', 'avatar', 'bust', 'face', 'outfit', 'costume', 'protagonist'] },
  { category: 'environment', keywords: ['env', 'environment', 'landscape', 'vista', 'city', 'citadel', 'street', 'skyline', 'interior', 'exterior', 'biome', 'scene', 'background', 'location', 'world'] },
  { category: 'prop', keywords: ['prop', 'item', 'weapon', 'sword', 'gun', 'rifle', 'armor', 'relic', 'artifact', 'vehicle', 'ship', 'starship', 'icon', 'emblem', 'crest', 'sigil'] },
  { category: 'mood', keywords: ['mood', 'moodboard', 'palette', 'ref', 'reference', 'inspo', 'lighting', 'colorscript', 'vibe', 'aesthetic'] },
];

function tokenizePath(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Extracts structured `Key: Value` or `- **Key:** Value` lines commonly produced by
 * Gemini, ChatGPT, and Claude into matching EntityType properties.
 */
function extractKeyValueProperties(
  body: string,
  entityType: EntityTypeDef | undefined
): Record<string, EntryPropertyValue> {
  if (!entityType || entityType.fields.length === 0) return {};

  const extracted: Record<string, EntryPropertyValue> = {};
  const lines = body.split(/\r?\n/).slice(0, 80);

  for (const field of entityType.fields) {
    const labelEsc = field.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyEsc = field.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `^(?:[-*]\\s*)?(?:\\*\\*|__)?(?:${labelEsc}|${keyEsc})(?:\\*\\*|__)?\\s*:\\s*(.+)$`,
      'i'
    );

    for (const line of lines) {
      const match = line.trim().match(regex);
      if (match && match[1]) {
        const cleanVal = match[1].replace(/^\*+|\*+$/g, '').trim();
        if (cleanVal && cleanVal.length <= 160) {
          extracted[field.key] = cleanVal;
          break;
        }
      }
    }
  }

  return extracted;
}

export function classifyTextNote(
  relPath: string,
  content: string,
  entityTypes: EntityTypeDef[]
): NoteClassification {
  const parsed = matter(content);
  const fm = (parsed.data ?? {}) as Record<string, unknown>;
  const body = parsed.content;
  const availableTypeIds = new Set(entityTypes.map((t) => t.id));
  const tokens = tokenizePath(relPath);

  let matchedTypeId: string | null = null;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  // 1. Explicit frontmatter `type` (including synonyms like `place` -> `location`, `people` -> `character`)
  const normalizedFmType = normalizeFrontmatterType(fm.type, entityTypes);
  if (normalizedFmType) {
    matchedTypeId = normalizedFmType;
    confidence = 'high';
  }

  // 2. Match custom or starter EntityType names/plurals in folder path or filename
  if (!matchedTypeId) {
    for (const et of entityTypes) {
      if (et.id === 'page') continue;
      const etTokens = new Set([
        ...tokenizePath(et.id),
        ...tokenizePath(et.name),
        ...tokenizePath(et.pluralName),
      ]);
      if (tokens.some((tok) => etTokens.has(tok))) {
        matchedTypeId = et.id;
        confidence = 'high';
        break;
      }
    }
  }

  // 3. Starter synonym keywords in path/filename
  if (!matchedTypeId) {
    for (const rule of STARTER_PATH_KEYWORDS) {
      if (!availableTypeIds.has(rule.typeId)) continue;
      if (tokens.some((tok) => rule.keywords.includes(tok))) {
        matchedTypeId = rule.typeId;
        confidence = 'high';
        break;
      }
    }
  }

  // 4. Content heuristics (Gemini/ChatGPT/Claude headings & bullet keys)
  if (!matchedTypeId) {
    let bestType: string | null = null;
    let bestScore = 0;

    for (const signal of BODY_SIGNAL_KEYWORDS) {
      if (!availableTypeIds.has(signal.typeId)) continue;
      let score = 0;
      for (const pat of signal.patterns) {
        if (pat.test(body)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestType = signal.typeId;
      }
    }

    if (bestType && bestScore >= 1) {
      matchedTypeId = bestType;
      confidence = 'medium';
    }
  }

  const finalTypeId = matchedTypeId ?? 'page';
  const needsTriage = confidence === 'low';
  const targetTypeDef = entityTypes.find((t) => t.id === finalTypeId);
  const extractedProperties = extractKeyValueProperties(body, targetTypeDef);

  const suggestedTags = new Set<string>(['intake']);
  if (needsTriage) suggestedTags.add(NEEDS_TRIAGE_TAG);

  return {
    typeId: finalTypeId,
    confidence,
    extractedProperties,
    suggestedTags: Array.from(suggestedTags),
    needsTriage,
  };
}

export function classifyArtAsset(relPath: string): ArtClassification {
  const tokens = tokenizePath(relPath);

  for (const rule of ART_CATEGORY_KEYWORDS) {
    if (tokens.some((tok) => rule.keywords.includes(tok))) {
      return {
        category: rule.category,
        confidence: 'high',
        suggestedTags: ['intake'],
        needsTriage: false,
      };
    }
  }

  return {
    category: 'other',
    confidence: 'low',
    suggestedTags: ['intake', NEEDS_TRIAGE_TAG],
    needsTriage: true,
  };
}

async function readIntakeState(statePath: string): Promise<IntakeStateFile> {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as IntakeStateFile;
    if (parsed && parsed.records && typeof parsed.records === 'object') {
      return parsed;
    }
  } catch {
    // First sync for this world
  }
  return { records: {} };
}

async function writeIntakeState(statePath: string, state: IntakeStateFile): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

interface ScannedIntakeFile {
  rootFolder: string;
  fullPath: string;
  relPath: string;
  folderRel: string;
  ext: string;
  fingerprint: string;
}

async function scanIntakeFolder(rootFolder: string): Promise<ScannedIntakeFile[]> {
  const results: ScannedIntakeFile[] = [];

  const walk = async (dir: string, folderRel: string): Promise<void> => {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.') && IGNORED_DIRS.has(dirent.name)) continue;
      if (dirent.isDirectory()) {
        if (IGNORED_DIRS.has(dirent.name)) continue;
        const nextFolder = folderRel ? `${folderRel}/${dirent.name}` : dirent.name;
        await walk(path.join(dir, dirent.name), nextFolder);
      } else if (dirent.isFile()) {
        const ext = path.extname(dirent.name).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext) && !IMAGE_EXTENSIONS.has(ext)) continue;
        const fullPath = path.join(dir, dirent.name);
        const stat = await fs.stat(fullPath);
        const relPath = folderRel ? `${folderRel}/${dirent.name}` : dirent.name;
        results.push({
          rootFolder,
          fullPath,
          relPath,
          folderRel,
          ext,
          fingerprint: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
        });
      }
    }
  };

  await walk(rootFolder, '');
  return results;
}

/**
 * Deep module handling per-World Drop-Folder Intake Sync.
 * Non-destructively scans linked external folders (e.g., Brimstone, Neon Ash),
 * auto-sorts AI-generated lore notes and concept art into the World's EntityTypes
 * and ArtCategories, and tracks fingerprints so only new/changed files are processed.
 */
export class IntakeEngine {
  async syncWorldIntake(
    store: WorkspaceStore,
    world: WorldConfig,
    intakeFolders: string[]
  ): Promise<IntakeSyncReport> {
    const statePath = path.join(store.worldDir(world.slug), 'intake-state.json');
    const state = await readIntakeState(statePath);

    let foldersScanned = 0;
    let importedEntries = 0;
    let updatedEntries = 0;
    let importedArt = 0;
    let needsTriageCount = 0;
    let skippedUnchanged = 0;
    const items: IntakeImportedItem[] = [];
    const warnings: string[] = [];

    for (const folder of intakeFolders) {
      try {
        await fs.access(folder);
      } catch {
        warnings.push(`Intake folder not accessible: ${folder}`);
        continue;
      }

      foldersScanned++;
      const files = await scanIntakeFolder(folder);

      for (const file of files) {
        // Key by folder basename + relative path so PC 1 and PC 2 share dedupe state cleanly!
        const stateKey = `${path.basename(folder)}::${file.relPath}`.toLowerCase();
        const prev = state.records[stateKey];

        if (prev && prev.fingerprint === file.fingerprint) {
          skippedUnchanged++;
          continue;
        }

        if (TEXT_EXTENSIONS.has(file.ext)) {
          try {
            const raw = await fs.readFile(file.fullPath, 'utf8');
            const parsed = matter(raw);
            const fm = (parsed.data ?? {}) as Record<string, unknown>;
            const classification = classifyTextNote(file.relPath, raw, world.entityTypes);

            const filenameTitle = path
              .basename(file.relPath, file.ext)
              .replace(/[-_]+/g, ' ')
              .trim();
            const headingMatch = parsed.content.match(/^#\s+(.+)$/m);
            const title =
              (typeof fm.title === 'string' && fm.title.trim()) ||
              (headingMatch && headingMatch[1].trim()) ||
              filenameTitle ||
              'Untitled Note';

            const fmTags = Array.isArray(fm.tags)
              ? fm.tags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean)
              : [];
            const mergedTags = Array.from(new Set([...fmTags, ...classification.suggestedTags]));

            const targetFolder =
              file.folderRel ||
              (classification.typeId === 'page' ? 'intake' : `${classification.typeId}s`);

            if (prev && prev.kind === 'entry') {
              const existing = await store.readEntryById(world.slug, prev.targetId);
              if (existing) {
                const updated = await store.updateEntry({
                  worldSlug: world.slug,
                  id: existing.id,
                  title,
                  body: parsed.content.trim(),
                  properties: { ...classification.extractedProperties, ...existing.properties },
                });
                state.records[stateKey] = {
                  fingerprint: file.fingerprint,
                  kind: 'entry',
                  targetId: updated.id,
                  lastSyncedAt: new Date().toISOString(),
                };
                updatedEntries++;
                items.push({
                  kind: 'entry',
                  id: updated.id,
                  title: updated.title,
                  sourceRelPath: file.relPath,
                  assignedCategory: updated.type,
                  needsTriage: updated.tags.includes(NEEDS_TRIAGE_TAG),
                  action: 'updated',
                });
                continue;
              }
            }

            const created = await store.createEntry({
              worldSlug: world.slug,
              title,
              type: classification.typeId,
              folder: targetFolder,
              tags: mergedTags,
              properties: classification.extractedProperties,
              body: parsed.content.trim(),
            });

            state.records[stateKey] = {
              fingerprint: file.fingerprint,
              kind: 'entry',
              targetId: created.id,
              lastSyncedAt: new Date().toISOString(),
            };

            importedEntries++;
            if (classification.needsTriage) needsTriageCount++;
            items.push({
              kind: 'entry',
              id: created.id,
              title: created.title,
              sourceRelPath: file.relPath,
              assignedCategory: classification.typeId,
              needsTriage: classification.needsTriage,
              action: 'created',
            });
          } catch (err) {
            warnings.push(`Failed to import note ${file.relPath}: ${(err as Error).message}`);
          }
        } else if (IMAGE_EXTENSIONS.has(file.ext)) {
          try {
            const classification = classifyArtAsset(file.relPath);
            const saved = await store.saveArtAssetFromPath(
              world.slug,
              file.fullPath,
              classification.category
            );
            const tagged = await store.updateArtAsset(world.slug, saved.id, {
              tags: classification.suggestedTags,
            });

            state.records[stateKey] = {
              fingerprint: file.fingerprint,
              kind: 'art',
              targetId: tagged.id,
              lastSyncedAt: new Date().toISOString(),
            };

            importedArt++;
            if (classification.needsTriage) needsTriageCount++;
            items.push({
              kind: 'art',
              id: tagged.id,
              title: tagged.title,
              sourceRelPath: file.relPath,
              assignedCategory: classification.category,
              needsTriage: classification.needsTriage,
              action: 'created',
            });
          } catch (err) {
            warnings.push(`Failed to import image ${file.relPath}: ${(err as Error).message}`);
          }
        }
      }
    }

    await writeIntakeState(statePath, state);

    return {
      worldSlug: world.slug,
      foldersScanned,
      importedEntries,
      updatedEntries,
      importedArt,
      needsTriageCount,
      skippedUnchanged,
      items,
      warnings,
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Re-runs the offline auto-sorter against every Entry and ArtAsset currently
   * tagged `#needs-triage` in a World (e.g. right after adding a custom EntityType
   * such as Vehicles). Items that now classify cleanly are automatically slotted
   * and have `#needs-triage` removed.
   */
  async reclassifyTriageItems(
    store: WorkspaceStore,
    world: WorldConfig
  ): Promise<ReclassifyTriageReport> {
    let reclassifiedEntries = 0;
    let reclassifiedArt = 0;
    let remainingTriage = 0;

    const entries = await store.listAllEntriesInWorld(world.slug);
    for (const entry of entries) {
      if (!entry.tags.includes(NEEDS_TRIAGE_TAG)) continue;
      const classification = classifyTextNote(
        `${entry.relativePath} ${entry.title}`,
        entry.body,
        world.entityTypes
      );
      if (!classification.needsTriage) {
        await store.updateEntry({
          worldSlug: world.slug,
          id: entry.id,
          type: classification.typeId,
          properties: { ...classification.extractedProperties, ...entry.properties },
          tags: entry.tags.filter((t) => t !== NEEDS_TRIAGE_TAG),
        });
        reclassifiedEntries++;
      } else {
        remainingTriage++;
      }
    }

    const assets = await store.listArtAssets(world.slug);
    for (const asset of assets) {
      if (!asset.tags.includes(NEEDS_TRIAGE_TAG)) continue;
      const classification = classifyArtAsset(`${asset.filename} ${asset.title}`);
      if (!classification.needsTriage) {
        await store.updateArtAsset(world.slug, asset.id, {
          category: classification.category,
          tags: asset.tags.filter((t) => t !== NEEDS_TRIAGE_TAG),
        });
        reclassifiedArt++;
      } else {
        remainingTriage++;
      }
    }

    return { reclassifiedEntries, reclassifiedArt, remainingTriage };
  }
}
