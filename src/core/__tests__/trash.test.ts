import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import type { EntityTypeDef } from '../../shared/types';

/** A4: Trash view with Restore. */
describe('trash', () => {
  let tmpDir: string;
  let store: WorkspaceStore;
  let slug: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-trash-'));
    store = new WorkspaceStore(tmpDir);
    await store.ensureInitialized();
    slug = (await store.createWorld({ name: 'Brimstone', medium: 'novel' })).slug;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('lists a deleted entry and restores it to its old path and ID', async () => {
    const kael = await store.createEntry({ worldSlug: slug, title: 'Kael Vorn', type: 'character', body: 'Exiled.' });
    await store.deleteEntry(slug, kael.id);
    expect(await store.readEntryById(slug, kael.id)).toBeNull();

    const trash = await store.listTrash(slug);
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ kind: 'entry', title: 'Kael Vorn', originalName: kael.relativePath });
    expect(new Date(trash[0].deletedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const result = await store.restoreTrashItem(slug, trash[0].id);
    expect(result).toMatchObject({ kind: 'entry', restoredId: kael.id, relativePath: kael.relativePath, renamed: false });
    expect((await store.readEntryById(slug, kael.id))?.body.trim()).toBe('Exiled.');
    expect(await store.listTrash(slug)).toHaveLength(0);
  });

  it('restores under a new file name when the old one is taken, and refuses a duplicate ID', async () => {
    const first = await store.createEntry({ worldSlug: slug, title: 'Kael', type: 'character', body: 'v1' });
    await store.deleteEntry(slug, first.id);
    // A new entry has since taken the same file name
    const second = await store.createEntry({ worldSlug: slug, title: 'Kael', type: 'character', body: 'v2' });
    expect(second.relativePath).toBe(first.relativePath);

    const [item] = await store.listTrash(slug);
    const result = await store.restoreTrashItem(slug, item.id);
    expect(result.renamed).toBe(true);
    expect(result.relativePath).toMatch(/-restored\.md$/);
    expect((await store.readEntryById(slug, first.id))?.body.trim()).toBe('v1');
    expect((await store.readEntryById(slug, second.id))?.body.trim()).toBe('v2');

    // Same ID still in use (e.g. the file was copied back by hand): restore is refused, nothing moves
    await store.deleteEntry(slug, second.id);
    const copy = path.join(store.worldDir(slug), 'entries', 'copy.md');
    const [secondItem] = await store.listTrash(slug);
    await fs.copyFile(path.join(store.worldTrashDir(slug, 'entries'), secondItem.id.split('/')[1]), copy);
    await expect(store.restoreTrashItem(slug, secondItem.id)).rejects.toThrow(/already uses this entry's ID/);
    expect(await store.listTrash(slug)).toHaveLength(1);
  });

  it('restores concept art with its ID and metadata, so entry links work again', async () => {
    const asset = await store.saveArtAssetFromBuffer(slug, 'gate.png', Buffer.from('png'));
    await store.updateArtAsset(slug, asset.id, { caption: 'The Ash Gate', tags: ['ash'] });
    await store.deleteArtAsset(slug, asset.id);
    expect(await store.listArtAssets(slug)).toHaveLength(0);

    const [item] = await store.listTrash(slug);
    expect(item).toMatchObject({ kind: 'art', title: 'gate', originalName: 'gate.png' });
    const result = await store.restoreTrashItem(slug, item.id);
    expect(result).toMatchObject({ kind: 'art', restoredId: asset.id, renamed: false });

    const [restored] = await store.listArtAssets(slug);
    expect(restored).toMatchObject({ id: asset.id, caption: 'The Ash Gate', tags: ['ash'], filename: 'gate.png' });
    expect(restored.missing).toBeUndefined();
    const trashFiles = await fs.readdir(store.worldTrashDir(slug, 'assets'));
    expect(trashFiles).toHaveLength(0); // image and .meta.yaml both left the trash
  });

  it('restores maps and moodboards, under a new ID if the old one came back meanwhile', async () => {
    const map = await store.createMap(slug, 'Ash Sea', 'x');
    await store.updateMap(slug, map.id, { pins: [{ id: 'p1', x: 0.1, y: 0.2, label: 'Port' }] as never });
    const board = await store.createBoard(slug, 'Vibes');
    await store.deleteMap(slug, map.id);
    await store.deleteBoard(slug, board.id);

    const items = await store.listTrash(slug);
    expect(items.map((i) => i.kind).sort()).toEqual(['board', 'map']);
    for (const item of items) await store.restoreTrashItem(slug, item.id);
    expect((await store.listMaps(slug))[0]).toMatchObject({ id: map.id, title: 'Ash Sea' });
    expect((await store.listMaps(slug))[0].pins).toHaveLength(1);
    expect((await store.listBoards(slug))[0].id).toBe(board.id);

    // Delete again, then a sync brings the old record back before the user restores
    await store.deleteMap(slug, map.id);
    const [again] = await store.listTrash(slug);
    await fs.copyFile(
      path.join(store.worldTrashDir(slug, 'maps'), again.id.split('/')[1]),
      path.join(store.recordsDir(slug, 'maps'), `${map.id}.yaml`)
    );
    const result = await store.restoreTrashItem(slug, again.id);
    expect(result.renamed).toBe(true);
    expect(result.restoredId).not.toBe(map.id);
    expect((await store.listMaps(slug)).map((m) => m.title).sort()).toEqual(['Ash Sea', 'Ash Sea (restored)']);
  });

  it('restores a deleted entity type at the end of the list', async () => {
    const starship: EntityTypeDef = {
      id: 'starship',
      name: 'Starship',
      pluralName: 'Starships',
      icon: 'rocket',
      color: '#f00',
      defaultView: 'gallery',
      fields: [],
    };
    const world = (await store.listWorlds())[0];
    await store.updateWorld(slug, { entityTypes: [...world.entityTypes, starship] });
    await store.updateWorld(slug, { entityTypes: world.entityTypes });

    const [item] = await store.listTrash(slug);
    expect(item).toMatchObject({ kind: 'type', title: 'Starship', originalName: 'starship' });
    await store.restoreTrashItem(slug, item.id);
    const types = (await store.listWorlds())[0].entityTypes;
    expect(types.at(-1)).toEqual(starship);
    expect(types).toHaveLength(world.entityTypes.length + 1);
  });

  it('deletes forever, and rejects item IDs that point outside the trash', async () => {
    const asset = await store.saveArtAssetFromBuffer(slug, 'gate.png', Buffer.from('png'));
    await store.deleteArtAsset(slug, asset.id);
    const [item] = await store.listTrash(slug);
    await store.deleteTrashItemForever(slug, item.id);
    expect(await store.listTrash(slug)).toHaveLength(0);
    expect(await fs.readdir(store.worldTrashDir(slug, 'assets'))).toHaveLength(0);

    for (const bad of ['entry/../../world.yaml', 'entry/..', 'nope/2026-01-01T00-00-00-000Z__x.md', 'entry/world.yaml']) {
      await expect(store.restoreTrashItem(slug, bad)).rejects.toThrow();
      await expect(store.deleteTrashItemForever(slug, bad)).rejects.toThrow();
    }
    expect(await fs.readFile(path.join(store.worldDir(slug), 'world.yaml'), 'utf8')).toContain('Brimstone');
  });
});
