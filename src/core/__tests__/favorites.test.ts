import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { WorkspaceStore, WORLD_FORMAT_VERSION } from '../workspace-store';
import { RECENT_LIMIT, parseRecents, pushRecent, recentsStorageKey } from '../../shared/recents';

/** C9: favorites live in the World folder (one file each, so they sync); recents are a per-PC list. */
describe('favorites', () => {
  let tmpDir: string;
  let store: WorkspaceStore;
  let slug: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-favorites-'));
    store = new WorkspaceStore(tmpDir);
    await store.ensureInitialized();
    slug = (await store.createWorld({ name: 'Ash Sea', medium: 'novel' })).slug;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const favoritesDir = () => path.join(tmpDir, 'worlds', slug, 'records', 'favorites');

  it('stars entries in the order they were added, one file per favorite', async () => {
    const kael = await store.createEntry({ worldSlug: slug, title: 'Kael', type: 'character' });
    const tower = await store.createEntry({ worldSlug: slug, title: 'Glass Tower', type: 'location' });

    expect(await store.listFavorites(slug)).toEqual([]);
    await store.setFavorite(slug, tower.id, true);
    expect(await store.setFavorite(slug, kael.id, true)).toEqual([tower.id, kael.id]);
    expect((await fs.readdir(favoritesDir())).sort()).toEqual([`${kael.id}.yaml`, `${tower.id}.yaml`].sort());

    // Starring again keeps the original position
    expect(await store.setFavorite(slug, tower.id, true)).toEqual([tower.id, kael.id]);

    expect(await store.setFavorite(slug, tower.id, false)).toEqual([kael.id]);
    expect(await fs.readdir(favoritesDir())).toEqual([`${kael.id}.yaml`]);
  });

  it('removes sync conflict copies too, so an unstarred page stays unstarred', async () => {
    const kael = await store.createEntry({ worldSlug: slug, title: 'Kael', type: 'character' });
    await store.setFavorite(slug, kael.id, true);
    const copy = { id: kael.id, addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    await fs.writeFile(path.join(favoritesDir(), `${kael.id}-DESKTOP-PC.yaml`), yaml.dump(copy));
    expect(await store.listFavorites(slug)).toEqual([kael.id]);

    expect(await store.setFavorite(slug, kael.id, false)).toEqual([]);
    expect(await fs.readdir(favoritesDir())).toEqual([]);
  });

  it('keeps a deleted entry’s favorite so restoring it from the Trash brings the star back', async () => {
    const kael = await store.createEntry({ worldSlug: slug, title: 'Kael', type: 'character' });
    await store.setFavorite(slug, kael.id, true);
    await store.deleteEntry(slug, kael.id);
    expect(await store.listFavorites(slug)).toEqual([kael.id]);
  });

  it('refuses to change favorites in a World from a newer Loreloom', async () => {
    const kael = await store.createEntry({ worldSlug: slug, title: 'Kael', type: 'character' });
    const cfg = path.join(tmpDir, 'worlds', slug, 'world.yaml');
    const world = yaml.load(await fs.readFile(cfg, 'utf8')) as Record<string, unknown>;
    await fs.writeFile(cfg, yaml.dump({ ...world, formatVersion: WORLD_FORMAT_VERSION + 1 }));
    await expect(store.setFavorite(slug, kael.id, true)).rejects.toThrow();
  });
});

describe('recents', () => {
  it('moves a page to the front without duplicates and caps the list', () => {
    expect(pushRecent(['b', 'a'], 'a')).toEqual(['a', 'b']);
    expect(pushRecent([], 'a')).toEqual(['a']);
    const many = Array.from({ length: RECENT_LIMIT }, (_, i) => `e${i}`);
    const next = pushRecent(many, 'new');
    expect(next).toHaveLength(RECENT_LIMIT);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`e${RECENT_LIMIT - 1}`);
  });

  it('reads stored lists defensively', () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('not json')).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents('["a", 3, "", "b"]')).toEqual(['a', 'b']);
    expect(recentsStorageKey('w1')).toBe('loreloom:recent:w1');
  });
});
