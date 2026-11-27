import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import { IndexEngine } from '../index-engine';

describe('IndexEngine', () => {
  let tmpDir: string;
  let store: WorkspaceStore;
  let index: IndexEngine;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-idx-'));
    store = new WorkspaceStore(tmpDir);
    index = new IndexEngine(':memory:');
  });

  afterEach(async () => {
    index.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rebuilds workspace index, supports FTS5 global search, collection filtering, and backlinks', async () => {
    const world = await store.createWorld({ name: 'Shattered Crown', medium: 'ttrpg' });

    const citadel = await store.createEntry({
      worldSlug: world.slug,
      title: 'Iron Citadel',
      type: 'location',
      tags: ['fortress'],
      body: 'An ancient bastion perched above the Ash Sea.',
    });

    const kael = await store.createEntry({
      worldSlug: world.slug,
      title: 'Kael Vorn',
      type: 'character',
      tags: ['knight', 'protagonist'],
      body: 'Born in the shadows of [[Iron Citadel]], sworn to reclaim the crown.',
    });

    const stats = await index.rebuildWorkspace(store);
    expect(stats.indexedWorlds).toBe(1);
    expect(stats.indexedEntries).toBe(2);

    const characters = index.queryCollection({ worldSlug: world.slug, type: 'character' });
    expect(characters).toHaveLength(1);
    expect(characters[0].id).toBe(kael.id);

    const backlinks = index.getBacklinks(world.slug, citadel.id);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourceTitle).toBe('Kael Vorn');

    const hits = index.searchGlobal('bastion');
    expect(hits).toHaveLength(1);
    expect(hits[0].entryId).toBe(citadel.id);
    expect(hits[0].worldName).toBe('Shattered Crown');
  });

  it('returns multi-collection entries under both their primary type and secondaryTypes', async () => {
    const world = await store.createWorld({ name: 'Neon Ash', medium: 'video-game' });
    const skiff = await store.createEntry({
      worldSlug: world.slug,
      title: 'K-80 Civic Runner',
      type: 'vehicle',
      secondaryTypes: ['item'],
      body: 'Boxy urban hatchback converted into a combat frame.',
    });

    await index.rebuildWorkspace(store);

    const vehicles = index.queryCollection({ worldSlug: world.slug, type: 'vehicle' });
    const items = index.queryCollection({ worldSlug: world.slug, type: 'item' });
    expect(vehicles.map((e) => e.id)).toContain(skiff.id);
    expect(items.map((e) => e.id)).toContain(skiff.id);
  });
});
