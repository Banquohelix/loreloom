import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { WorkspaceStore, WORLD_FORMAT_VERSION } from '../workspace-store';
import type { EntityTypeDef } from '../../shared/types';

/** A1: one file per record for art, maps, moodboards and entity types (review item #27). */
describe('per-record storage', () => {
  let tmpDir: string;
  let store: WorkspaceStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-records-'));
    store = new WorkspaceStore(tmpDir);
    await store.ensureInitialized();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const starship: EntityTypeDef = {
    id: 'starship',
    name: 'Starship',
    pluralName: 'Starships',
    icon: 'rocket',
    color: '#ff0000',
    defaultView: 'gallery',
    fields: [{ key: 'hull', label: 'Hull', fieldType: 'text' }],
  };

  /** Lays out a World exactly as Loreloom 0.6.8 wrote it. */
  async function writeLegacyWorld(slug = 'neon-ash'): Promise<string> {
    const dir = path.join(tmpDir, 'worlds', slug);
    await fs.mkdir(path.join(dir, 'entries'), { recursive: true });
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'assets', 'skyline.png'), 'png');
    await fs.writeFile(
      path.join(dir, 'world.yaml'),
      yaml.dump({
        id: 'w1',
        name: 'Neon Ash',
        subtitle: '',
        medium: 'video-game',
        customKey: 'kept',
        entityTypes: [
          { ...starship, id: 'character', name: 'Character', pluralName: 'Characters' },
          starship,
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );
    await fs.writeFile(
      path.join(dir, 'art-manifest.yaml'),
      yaml.dump({
        assets: [
          {
            id: 'a1',
            worldSlug: slug,
            filename: 'skyline.png',
            relativePath: 'assets/skyline.png',
            title: 'Skyline',
            category: 'environment',
            tags: ['neon'],
            caption: 'Rain over the arcology',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    );
    await fs.writeFile(
      path.join(dir, 'maps.yaml'),
      yaml.dump({
        maps: [
          {
            id: 'm1',
            worldSlug: slug,
            title: 'Old Town',
            assetId: 'a1',
            pins: [{ id: 'p1', x: 0.5, y: 0.5, label: 'Bar' }],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      })
    );
    await fs.writeFile(
      path.join(dir, 'boards.yaml'),
      yaml.dump({
        boards: [
          {
            id: 'b1',
            worldSlug: slug,
            title: 'Vibes',
            items: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    );
    return dir;
  }

  it('migrates a 0.6.8 World to per-record files without losing anything', async () => {
    const dir = await writeLegacyWorld();
    const report = await store.migrateWorldRecords('neon-ash');
    expect(report).toMatchObject({ art: 1, maps: 1, boards: 1, types: 2 });
    expect(report.legacyFilesRetired.sort()).toEqual(['art-manifest.yaml', 'boards.yaml', 'maps.yaml']);

    // Legacy files are retired into the trash, not deleted
    for (const f of ['art-manifest.yaml', 'maps.yaml', 'boards.yaml']) {
      await expect(fs.access(path.join(dir, f))).rejects.toThrow();
    }
    const retired = await fs.readdir(store.worldTrashDir('neon-ash', 'migrated'));
    expect(retired).toHaveLength(3);

    const worldYaml = yaml.load(await fs.readFile(path.join(dir, 'world.yaml'), 'utf8')) as Record<string, unknown>;
    expect(worldYaml.entityTypes).toBeUndefined();
    expect(worldYaml.formatVersion).toBe(WORLD_FORMAT_VERSION);
    expect(worldYaml.customKey).toBe('kept');

    const world = (await store.listWorlds()).find((w) => w.slug === 'neon-ash')!;
    expect(world.entityTypes.map((t) => t.id)).toEqual(['character', 'starship']);
    expect(world.entityTypes[1]).toEqual(starship);

    const art = await store.listArtAssets('neon-ash');
    expect(art).toHaveLength(1);
    expect(art[0]).toMatchObject({ id: 'a1', caption: 'Rain over the arcology' });
    expect((await store.listMaps('neon-ash'))[0].pins).toHaveLength(1);
    expect((await store.listBoards('neon-ash'))[0].title).toBe('Vibes');

    // Running it again (another launch, another PC) changes nothing
    const again = await store.migrateWorldRecords('neon-ash');
    expect(again).toEqual({ art: 0, maps: 0, boards: 0, types: 0, legacyFilesRetired: [] });
  });

  it('migrates on first read even before the app-level migration runs', async () => {
    await writeLegacyWorld();
    const world = (await store.listWorlds()).find((w) => w.slug === 'neon-ash')!;
    expect(world.entityTypes.map((t) => t.id)).toContain('starship');
    expect((await store.listArtAssets('neon-ash'))[0].id).toBe('a1');
    expect((await store.listMaps('neon-ash'))[0].id).toBe('m1');
  });

  it('absorbs a manifest written later by an older Loreloom on another PC without duplicating art', async () => {
    const dir = await writeLegacyWorld();
    await store.migrateWorldRecords('neon-ash');
    await fs.writeFile(path.join(dir, 'assets', 'alley.png'), 'png');

    // 0.6.8 found no manifest, so it re-registered every image under fresh random IDs,
    // and edited the map (newer updatedAt) while the board copy is older than ours
    await store.updateBoard('neon-ash', 'b1', { title: 'Vibes (edited here)' });
    await fs.writeFile(
      path.join(dir, 'art-manifest.yaml'),
      yaml.dump({
        assets: [
          { id: 'random-1', worldSlug: 'neon-ash', filename: 'skyline.png', relativePath: 'assets/skyline.png', title: 'skyline', category: 'other', tags: [], caption: '', createdAt: '2026-02-01T00:00:00.000Z' },
          { id: 'random-2', worldSlug: 'neon-ash', filename: 'alley.png', relativePath: 'assets/alley.png', title: 'Alley', category: 'environment', tags: [], caption: 'From PC 2', createdAt: '2026-02-01T00:00:00.000Z' },
        ],
      })
    );
    await fs.writeFile(
      path.join(dir, 'maps.yaml'),
      yaml.dump({ maps: [{ id: 'm1', worldSlug: 'neon-ash', title: 'Old Town (PC 2)', assetId: 'a1', pins: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z' }] })
    );
    await fs.writeFile(
      path.join(dir, 'boards.yaml'),
      yaml.dump({ boards: [{ id: 'b1', worldSlug: 'neon-ash', title: 'Vibes (stale)', items: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] })
    );

    const art = await store.listArtAssets('neon-ash');
    expect(art.map((a) => a.filename).sort()).toEqual(['alley.png', 'skyline.png']);
    expect(art.find((a) => a.filename === 'skyline.png')?.id).toBe('a1');
    expect(art.find((a) => a.filename === 'alley.png')?.caption).toBe('From PC 2');
    expect((await store.listMaps('neon-ash'))[0].title).toBe('Old Town (PC 2)');
    expect((await store.listBoards('neon-ash'))[0].title).toBe('Vibes (edited here)');
  });

  it('writes only the record that changed', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'novel' });
    const worldYamlPath = path.join(store.worldDir(world.slug), 'world.yaml');
    const a = await store.createMap(world.slug, 'Map A', 'x');
    const b = await store.createMap(world.slug, 'Map B', 'x');
    const bFile = path.join(store.recordsDir(world.slug, 'maps'), `${b.id}.yaml`);
    const bBefore = await fs.readFile(bFile, 'utf8');

    await store.updateMap(world.slug, a.id, { title: 'Map A (renamed)' });
    expect(await fs.readFile(bFile, 'utf8')).toBe(bBefore);
    expect((await store.listMaps(world.slug)).map((m) => m.title)).toEqual(['Map A (renamed)', 'Map B']);

    // Adding a type writes a type record and leaves world.yaml alone
    const worldYamlBefore = await fs.readFile(worldYamlPath, 'utf8');
    const updated = await store.updateWorld(world.slug, { entityTypes: [...world.entityTypes, starship] });
    expect(updated.entityTypes.at(-1)).toEqual(starship);
    expect(await fs.readFile(worldYamlPath, 'utf8')).toBe(worldYamlBefore);

    // Deleting a type moves its record to the trash, and order is kept
    const withoutCharacter = updated.entityTypes.filter((t) => t.id !== 'character');
    const after = await store.updateWorld(world.slug, { entityTypes: withoutCharacter });
    expect(after.entityTypes.map((t) => t.id)).toEqual(withoutCharacter.map((t) => t.id));
    const trashedTypes = await fs.readdir(store.worldTrashDir(world.slug, 'types'));
    expect(trashedTypes.some((f) => f.endsWith('character.yaml'))).toBe(true);

    // Theme changes still go to world.yaml
    await store.updateWorld(world.slug, { subtitle: 'Ashes' });
    expect(await fs.readFile(worldYamlPath, 'utf8')).toContain('Ashes');
  });

  it('reads sync conflict copies, keeps the newest, and deletes every copy', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'novel' });
    const map = await store.createMap(world.slug, 'Harbor', 'x');
    const dir = store.recordsDir(world.slug, 'maps');
    await fs.writeFile(
      path.join(dir, `${map.id}-DESKTOP-PC2.yaml`),
      yaml.dump({ ...map, title: 'Harbor (PC 2)', updatedAt: '2099-01-01T00:00:00.000Z' })
    );

    const maps = await store.listMaps(world.slug);
    expect(maps).toHaveLength(1);
    expect(maps[0].title).toBe('Harbor (PC 2)');

    await store.deleteMap(world.slug, map.id);
    expect(await store.listMaps(world.slug)).toHaveLength(0);
    expect(await fs.readdir(dir)).toHaveLength(0);
  });

  it('gives images found in assets/ the same ID on every PC', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'novel' });
    await fs.writeFile(path.join(store.assetsDir(world.slug), 'gate.png'), 'png');
    const first = (await store.listArtAssets(world.slug))[0];

    // A second PC that hasn't received the record yet discovers the same file
    await fs.rm(store.recordsDir(world.slug, 'art'), { recursive: true });
    const second = (await store.listArtAssets(world.slug))[0];
    expect(second.id).toBe(first.id);
    expect(await store.listArtAssets(world.slug)).toHaveLength(1);
  });

  it('opens a World from a newer Loreloom read-only', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'novel' });
    const map = await store.createMap(world.slug, 'Harbor', 'x');
    const worldYamlPath = path.join(store.worldDir(world.slug), 'world.yaml');
    const raw = yaml.load(await fs.readFile(worldYamlPath, 'utf8')) as Record<string, unknown>;
    await fs.writeFile(worldYamlPath, yaml.dump({ ...raw, formatVersion: WORLD_FORMAT_VERSION + 1 }));

    expect(await store.listMaps(world.slug)).toHaveLength(1);
    await expect(store.updateMap(world.slug, map.id, { title: 'x' })).rejects.toThrow(/newer version of Loreloom/);
    await expect(store.updateWorld(world.slug, { subtitle: 'x' })).rejects.toThrow(/newer version of Loreloom/);
    await expect(store.saveArtAssetFromBuffer(world.slug, 'a.png', Buffer.from('x'))).rejects.toThrow(
      /newer version of Loreloom/
    );
  });
});
