import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';

describe('WorkspaceStore', () => {
  let tmpDir: string;
  let store: WorkspaceStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-ws-'));
    store = new WorkspaceStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('initializes workspace.yaml and creates worlds with starter entity types', async () => {
    const state = await store.ensureInitialized('My Worlds');
    expect(state.config.name).toBe('My Worlds');
    expect(state.worlds).toHaveLength(0);

    const world = await store.createWorld({
      name: 'Shattered Crown',
      subtitle: 'Dark fantasy TTRPG setting',
      medium: 'ttrpg',
      preset: 'parchment-lorebook',
    });

    expect(world.slug).toBe('shattered-crown');
    expect(world.entityTypes.length).toBeGreaterThanOrEqual(6);
    expect(world.theme.preset).toBe('parchment-lorebook');

    const worlds = await store.listWorlds();
    expect(worlds).toHaveLength(1);
    expect(worlds[0].name).toBe('Shattered Crown');
  });

  it('creates, updates, moves, and deletes entries as plain Markdown + YAML frontmatter', async () => {
    const world = await store.createWorld({ name: 'Aether', medium: 'novel' });
    const entry = await store.createEntry({
      worldSlug: world.slug,
      title: 'Kael Vorn',
      type: 'character',
      folder: 'characters',
      tags: ['protagonist', 'exile'],
      properties: { role: 'Knight', status: 'Alive' },
      body: 'Exiled from [[Iron Citadel]].',
    });

    expect(entry.relativePath).toBe('characters/kael-vorn.md');

    const loaded = await store.readEntryById(world.slug, entry.id);
    expect(loaded?.title).toBe('Kael Vorn');
    expect(loaded?.properties.role).toBe('Knight');
    expect(loaded?.body).toContain('[[Iron Citadel]]');

    const moved = await store.updateEntry({
      worldSlug: world.slug,
      id: entry.id,
      folder: 'cast/main',
      title: 'Kael the Unbroken',
    });
    expect(moved.relativePath).toBe('cast/main/kael-vorn.md');
    expect(moved.title).toBe('Kael the Unbroken');

    await store.deleteEntry(world.slug, entry.id);
    expect(await store.readEntryById(world.slug, entry.id)).toBeNull();
  });

  it('stores concept art assets and reconciles externally synced images in assets/', async () => {
    const world = await store.createWorld({ name: 'Solstice', medium: 'video-game' });
    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const saved = await store.saveArtAssetFromBuffer(
      world.slug,
      'Citadel Vista.png',
      fakePng,
      'environment'
    );
    expect(saved.category).toBe('environment');
    expect(saved.filename).toBe('citadel-vista.png');

    // Simulate another PC syncing a new PNG via OneDrive directly into assets/
    await fs.writeFile(path.join(store.assetsDir(world.slug), 'dropped-concept.png'), fakePng);

    const listed = await store.listArtAssets(world.slug);
    expect(listed).toHaveLength(2);
    expect(listed.some((a) => a.filename === 'dropped-concept.png')).toBe(true);
  });

  it('creates, updates pins on, and deletes interactive maps in maps.yaml', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'ttrpg' });
    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const art = await store.saveArtAssetFromBuffer(world.slug, 'world-map.png', fakePng, 'map');

    const map = await store.createMap(world.slug, 'Brimstone Continent', art.id);
    expect(map.pins).toHaveLength(0);

    const updated = await store.updateMap(world.slug, map.id, {
      pins: [
        { id: 'p-1', x: 42.5, y: 61.2, label: 'Bellamare', color: '#059669', note: 'Coastal port' },
      ],
    });
    expect(updated.pins).toHaveLength(1);
    expect(updated.pins[0].label).toBe('Bellamare');

    const listed = await store.listMaps(world.slug);
    expect(listed).toHaveLength(1);
    expect(listed[0].pins[0].x).toBe(42.5);

    await store.deleteMap(world.slug, map.id);
    expect(await store.listMaps(world.slug)).toHaveLength(0);
  });
});
