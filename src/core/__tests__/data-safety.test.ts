import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { WorkspaceStore } from '../workspace-store';
import { IntakeEngine, INTAKE_UPDATE_TAG } from '../intake-engine';
import { repairEscapedWikilinks } from '../../shared/wikilink-repair';

/** Regression tests for the P0 data-loss fixes (review 2026-11-27). */
describe('data safety', () => {
  let tmpDir: string;
  let dropDir: string;
  let store: WorkspaceStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-safety-'));
    dropDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-drop-'));
    store = new WorkspaceStore(tmpDir);
    await store.ensureInitialized();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(dropDir, { recursive: true, force: true });
  });

  it('preserves unknown frontmatter keys and normalizes YAML dates on save', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    const file = path.join(store.worldDir(world.slug), 'entries', 'kael.md');
    await fs.writeFile(
      file,
      '---\nid: kael\ntitle: Kael\naliases:\n  - The Ash Knight\ncssclasses: [wide]\nborn: 2024-01-01\nproperties:\n  firstSeen: 2023-05-06\n---\nBody\n'
    );

    const loaded = await store.readEntryById(world.slug, 'kael');
    expect(loaded?.properties.firstSeen).toBe('2023-05-06');
    await store.updateEntry({ worldSlug: world.slug, id: 'kael', body: 'New body' });

    const raw = await fs.readFile(file, 'utf8');
    expect(raw).toContain('The Ash Knight');
    expect(raw).toContain('cssclasses');
    expect(raw).toContain('born:');
    expect(raw).toContain('firstSeen:');
    const reread = await store.readEntryById(world.slug, 'kael');
    expect(reread?.extraFrontmatter?.aliases).toEqual(['The Ash Knight']);
    expect(reread?.extraFrontmatter?.born).toBe('2024-01-01');
  });

  it('forks a conflict copy instead of overwriting a body changed on another PC', async () => {
    const world = await store.createWorld({ name: 'Neon Ash', medium: 'video-game' });
    const entry = await store.createEntry({ worldSlug: world.slug, title: 'Vex', body: 'Original' });

    // Another PC syncs a change to the same file
    await store.updateEntry({ worldSlug: world.slug, id: entry.id, body: 'Edited on laptop' });

    // This PC's editor still holds the original as its base
    const res = await store.updateEntry({
      worldSlug: world.slug,
      id: entry.id,
      body: 'Edited on desktop',
      baseBody: 'Original',
    });

    expect(res.conflictCopy).toBeDefined();
    expect(res.body.trim()).toBe('Edited on laptop');
    const kept = await store.readEntryById(world.slug, entry.id);
    expect(kept?.body.trim()).toBe('Edited on laptop');
    const copy = await store.readEntryById(world.slug, res.conflictCopy!.id);
    expect(copy?.body.trim()).toBe('Edited on desktop');
    expect(copy?.tags).toContain('conflict');

    // Matching base saves normally
    const ok = await store.updateEntry({
      worldSlug: world.slug,
      id: entry.id,
      body: 'Merged',
      baseBody: 'Edited on laptop\n',
    });
    expect(ok.conflictCopy).toBeUndefined();
    expect(ok.body).toBe('Merged');
  });

  it('serializes concurrent updates so a tag change cannot drop a body change', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    const entry = await store.createEntry({ worldSlug: world.slug, title: 'Kael', body: 'v1' });
    await Promise.all([
      store.updateEntry({ worldSlug: world.slug, id: entry.id, body: 'v2 body' }),
      store.updateEntry({ worldSlug: world.slug, id: entry.id, tags: ['knight'] }),
    ]);
    const final = await store.readEntryById(world.slug, entry.id);
    expect(final?.body.trim()).toBe('v2 body');
    expect(final?.tags).toEqual(['knight']);
  });

  it('moves deleted entries, art, and worlds to .trash instead of erasing them', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    const entry = await store.createEntry({ worldSlug: world.slug, title: 'Doomed', body: 'keep me' });
    await store.deleteEntry(world.slug, entry.id);
    expect(await store.readEntryById(world.slug, entry.id)).toBeNull();
    const trashed = await fs.readdir(store.worldTrashDir(world.slug, 'entries'));
    expect(trashed.some((f) => f.endsWith('doomed.md'))).toBe(true);

    const asset = await store.saveArtAssetFromBuffer(world.slug, 'sigil.png', Buffer.from('png'));
    await store.updateArtAsset(world.slug, asset.id, { caption: 'House sigil' });
    await store.deleteArtAsset(world.slug, asset.id);
    const trashedArt = await fs.readdir(store.worldTrashDir(world.slug, 'assets'));
    expect(trashedArt.some((f) => f.endsWith('sigil.png'))).toBe(true);
    expect(trashedArt.some((f) => f.endsWith('sigil.png.meta.yaml'))).toBe(true);

    await store.deleteWorld(world.slug);
    expect(await store.listWorlds()).toHaveLength(0);
    const trashedWorlds = await fs.readdir(path.join(tmpDir, '.trash', 'worlds'));
    expect(trashedWorlds.some((f) => f.endsWith('brimstone'))).toBe(true);
  });

  it('never prunes art metadata when the image has not synced yet', async () => {
    const world = await store.createWorld({ name: 'Neon Ash', medium: 'video-game' });
    const manifest = path.join(store.worldDir(world.slug), 'art-manifest.yaml');
    await fs.writeFile(
      manifest,
      yaml.dump({
        assets: [
          {
            id: 'a1',
            worldSlug: world.slug,
            filename: 'skyline.png',
            relativePath: 'assets/skyline.png',
            title: 'Skyline',
            category: 'environment',
            tags: ['neon'],
            caption: 'Hand-written caption',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    const listed = await store.listArtAssets(world.slug);
    expect(listed).toHaveLength(1);
    expect(listed[0].missing).toBe(true);

    // The legacy manifest was migrated to a per-record file, which keeps the metadata
    const raw = await fs.readFile(path.join(store.recordsDir(world.slug, 'art'), 'a1.yaml'), 'utf8');
    expect(raw).toContain('Hand-written caption');
    expect(raw).not.toContain('missing');
  });

  it('keeps every asset record when images are saved concurrently', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    await Promise.all(
      ['a.png', 'b.png', 'c.png', 'd.png'].map((n) =>
        store.saveArtAssetFromBuffer(world.slug, n, Buffer.from(n))
      )
    );
    const listed = await store.listArtAssets(world.slug);
    expect(listed.map((a) => a.filename).sort()).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
  });

  it('repairs wikilinks escaped by the old editor', async () => {
    expect(repairEscapedWikilinks('See \\[\\[Old\\_Town|the old town\\]\\] and \\[\\[Iron Citadel\\]\\].')).toBe(
      'See [[Old_Town|the old town]] and [[Iron Citadel]].'
    );
    expect(repairEscapedWikilinks('Clean [[Link]] and snake\\_case')).toBe('Clean [[Link]] and snake\\_case');

    const world = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    const entry = await store.createEntry({
      worldSlug: world.slug,
      title: 'Hub',
      body: 'Go to \\[\\[Iron Citadel\\]\\]',
    });
    expect(await store.repairEscapedWikilinksInWorld(world.slug)).toBe(1);
    expect((await store.readEntryById(world.slug, entry.id))?.body.trim()).toBe('Go to [[Iron Citadel]]');
    expect(await store.repairEscapedWikilinksInWorld(world.slug)).toBe(0);
  });

  describe('intake re-sync', () => {
    it('overwrites an unedited entry but never a body edited in Loreloom', async () => {
      const world = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
      const engine = new IntakeEngine();
      const note = path.join(dropDir, 'kael.md');

      await fs.writeFile(note, '# Kael\nFirst draft');
      await engine.syncWorldIntake(store, world, [dropDir]);
      let entry = (await store.listAllEntriesInWorld(world.slug)).find((e) => e.title === 'Kael')!;
      expect(entry.body).toContain('First draft');

      // Unedited: source change replaces the body
      await fs.writeFile(note, '# Kael\nSecond draft');
      const r2 = await engine.syncWorldIntake(store, world, [dropDir]);
      expect(r2.updatedEntries).toBe(1);
      entry = (await store.readEntryById(world.slug, entry.id))!;
      expect(entry.body).toContain('Second draft');
      expect(entry.body).not.toContain('First draft');

      // User edits the entry in Loreloom
      await store.updateEntry({ worldSlug: world.slug, id: entry.id, body: 'My hand-written canon' });

      // Source changes again: the edit must survive; new content is appended for review
      await fs.writeFile(note, '# Kael\nThird draft');
      await engine.syncWorldIntake(store, world, [dropDir]);
      entry = (await store.readEntryById(world.slug, entry.id))!;
      expect(entry.body).toContain('My hand-written canon');
      expect(entry.body).toContain('Third draft');
      expect(entry.tags).toContain(INTAKE_UPDATE_TAG);

      // Unchanged content (e.g. new mtime on another PC) is skipped entirely
      const before = entry.body;
      await fs.utimes(note, new Date(), new Date(Date.now() + 60_000));
      const r4 = await engine.syncWorldIntake(store, world, [dropDir]);
      expect(r4.updatedEntries).toBe(0);
      expect((await store.readEntryById(world.slug, entry.id))!.body).toBe(before);
    });

    it('replaces a changed intake image in place instead of duplicating it', async () => {
      const world = await store.createWorld({ name: 'Neon Ash', medium: 'video-game' });
      const engine = new IntakeEngine();
      const img = path.join(dropDir, 'skyline-env.png');
      await fs.writeFile(img, 'v1');
      await engine.syncWorldIntake(store, world, [dropDir]);
      const [asset] = await store.listArtAssets(world.slug);
      await store.updateArtAsset(world.slug, asset.id, { caption: 'Keep this caption' });

      await fs.writeFile(img, 'v2-bytes');
      await engine.syncWorldIntake(store, world, [dropDir]);
      const after = await store.listArtAssets(world.slug);
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(asset.id);
      expect(after[0].caption).toBe('Keep this caption');
      const bytes = await fs.readFile(path.join(store.assetsDir(world.slug), after[0].filename), 'utf8');
      expect(bytes).toBe('v2-bytes');
    });
  });
});
