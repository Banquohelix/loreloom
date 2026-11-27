import type {
  ArtAsset,
  ArtLinkSuggestion,
  DuplicateGroup,
  Entry,
  EntryPropertyValue,
} from '../shared/types';
import type { WorkspaceStore } from './workspace-store';

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[-_\s]+(2|3|4|copy)$/i, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Finds groups of duplicate Entries within a World sharing the same normalized
 * title or base slug (e.g. `ashgate.md` and `ashgate-2.md`).
 */
export function findDuplicateGroups(entries: Entry[]): DuplicateGroup[] {
  const buckets = new Map<string, Entry[]>();

  for (const entry of entries) {
    const key = normalizeKey(entry.title) || normalizeKey(entry.slug);
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(entry);
    buckets.set(key, arr);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, items] of buckets.entries()) {
    if (items.length < 2) continue;
    const sorted = [...items].sort((a, b) => {
      if (b.body.length !== a.body.length) return b.body.length - a.body.length;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    groups.push({
      key,
      title: sorted[0].title,
      entries: sorted.map((e) => ({
        id: e.id,
        worldSlug: e.worldSlug,
        title: e.title,
        slug: e.slug,
        type: e.type,
        secondaryTypes: e.secondaryTypes,
        folder: e.folder,
        relativePath: e.relativePath,
        tags: e.tags,
        properties: e.properties,
        coverAssetId: e.coverAssetId,
        portraitAssetId: e.portraitAssetId,
        updatedAt: e.updatedAt,
        excerpt: e.excerpt,
        bodyLength: e.body.length,
      })),
    });
  }

  return groups.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Merges one or more duplicate Entries into `keepEntryId`, preserving tags,
 * secondaryTypes, non-conflicting properties, cover/portrait art, and any unique
 * body text before deleting the removed duplicate files.
 */
export async function mergeDuplicateEntries(
  store: WorkspaceStore,
  worldSlug: string,
  keepEntryId: string,
  removeEntryIds: string[]
): Promise<Entry> {
  const keep = await store.readEntryById(worldSlug, keepEntryId);
  if (!keep) throw new Error(`Primary entry not found: ${keepEntryId}`);

  const mergedTags = new Set<string>(keep.tags);
  const mergedSecondary = new Set<string>(keep.secondaryTypes ?? []);
  const mergedProps: Record<string, EntryPropertyValue> = { ...keep.properties };
  let coverAssetId = keep.coverAssetId;
  let portraitAssetId = keep.portraitAssetId;
  let mergedBody = keep.body.trim();

  const normalizedKeepBody = mergedBody.replace(/\s+/g, ' ').toLowerCase();

  for (const removeId of removeEntryIds) {
    if (removeId === keepEntryId) continue;
    const dup = await store.readEntryById(worldSlug, removeId);
    if (!dup) continue;

    for (const tag of dup.tags) mergedTags.add(tag);
    if (dup.type !== keep.type) mergedSecondary.add(dup.type);
    for (const sec of dup.secondaryTypes ?? []) {
      if (sec !== keep.type) mergedSecondary.add(sec);
    }

    for (const [k, v] of Object.entries(dup.properties)) {
      if (mergedProps[k] === undefined || mergedProps[k] === '') {
        mergedProps[k] = v;
      }
    }

    if (!coverAssetId && dup.coverAssetId) coverAssetId = dup.coverAssetId;
    if (!portraitAssetId && dup.portraitAssetId) portraitAssetId = dup.portraitAssetId;

    const dupBody = dup.body.trim();
    if (dupBody) {
      const normalizedDup = dupBody.replace(/\s+/g, ' ').toLowerCase();
      if (!normalizedKeepBody.includes(normalizedDup)) {
        mergedBody = mergedBody
          ? `${mergedBody}\n\n---\n\n### Merged from ${dup.relativePath}\n\n${dupBody}`
          : dupBody;
      }
    }

    await store.deleteEntry(worldSlug, dup.id);
  }

  return store.updateEntry({
    worldSlug,
    id: keep.id,
    tags: Array.from(mergedTags),
    secondaryTypes: Array.from(mergedSecondary).filter((t) => t !== keep.type),
    properties: mergedProps,
    coverAssetId: coverAssetId ?? null,
    portraitAssetId: portraitAssetId ?? null,
    body: mergedBody,
  });
}

/**
 * Matches Concept Art assets to Entries that don't yet have that asset linked,
 * checking explicit filename references in the Entry body first, then filename-to-title overlap.
 */
export function findArtLinkSuggestions(
  entries: Entry[],
  assets: ArtAsset[]
): ArtLinkSuggestion[] {
  const suggestions: ArtLinkSuggestion[] = [];
  const seenPairs = new Set<string>();

  for (const entry of entries) {
    const entryKey = normalizeKey(entry.title);
    const bodyLower = entry.body.toLowerCase();
    const bodyNormalized = normalizeKey(entry.body);

    for (const asset of assets) {
      if (entry.coverAssetId === asset.id || entry.portraitAssetId === asset.id) continue;
      const pairKey = `${entry.id}::${asset.id}`;
      if (seenPairs.has(pairKey)) continue;

      const suggestedSlot: 'cover' | 'portrait' =
        entry.type === 'character' || asset.category === 'character' ? 'portrait' : 'cover';

      if (
        (suggestedSlot === 'portrait' && entry.portraitAssetId) ||
        (suggestedSlot === 'cover' && entry.coverAssetId)
      ) {
        continue;
      }

      const fileBaseLower = asset.filename.replace(/\.[^.]+$/, '').toLowerCase();
      const assetKey = normalizeKey(asset.filename);

      // 1. Explicit filename reference inside note body (handles `-` vs `_` normalization)
      if (
        bodyLower.includes(asset.filename.toLowerCase()) ||
        (fileBaseLower.length >= 6 && bodyLower.includes(fileBaseLower)) ||
        (assetKey.length >= 6 && bodyNormalized.includes(assetKey))
      ) {
        seenPairs.add(pairKey);
        suggestions.push({
          assetId: asset.id,
          assetTitle: asset.title,
          assetRelativePath: asset.relativePath,
          entryId: entry.id,
          entryTitle: entry.title,
          entryType: entry.type,
          suggestedSlot,
          confidence: 'high',
          reason: `Referenced in note (${asset.filename})`,
        });
        continue;
      }

      // 2. Strong title/filename match (e.g., `kael_vorn_portrait.png` <-> `Kael Vorn`)
      if (entryKey.length >= 4 && assetKey.includes(entryKey)) {
        seenPairs.add(pairKey);
        suggestions.push({
          assetId: asset.id,
          assetTitle: asset.title,
          assetRelativePath: asset.relativePath,
          entryId: entry.id,
          entryTitle: entry.title,
          entryType: entry.type,
          suggestedSlot,
          confidence: 'medium',
          reason: `Filename matches "${entry.title}"`,
        });
      }
    }
  }

  return suggestions.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return a.entryTitle.localeCompare(b.entryTitle);
  });
}
