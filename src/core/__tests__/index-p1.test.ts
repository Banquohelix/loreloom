import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import { IndexEngine, rewriteWikilinks, toFtsQuery } from '../index-engine';

describe('IndexEngine (P1)', () => {
  let tmpDir: string;
  let store: WorkspaceStore;
  let index: IndexEngine;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-idx-p1-'));
    store = new WorkspaceStore(tmpDir);
    await store.ensureInitialized();
    index = new IndexEngine(':memory:');
  });

  afterEach(async () => {
    index.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('keeps entries with the same id in different Worlds (copied World folders)', async () => {
    const a = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    const b = await store.createWorld({ name: 'Brimstone Copy', medium: 'video-game' });
    for (const w of [a, b]) {
      await fs.writeFile(
        path.join(store.worldDir(w.slug), 'entries', 'kael.md'),
        `---\nid: same-id\ntitle: Kael (${w.name})\n---\nBody\n`
      );
    }
    await index.rebuildWorkspace(store);
    expect(index.queryCollection({ worldSlug: a.slug })).toHaveLength(1);
    expect(index.queryCollection({ worldSlug: b.slug })).toHaveLength(1);

    index.removeEntry(a.slug, 'same-id');
    expect(index.queryCollection({ worldSlug: a.slug })).toHaveLength(0);
    expect(index.queryCollection({ worldSlug: b.slug })).toHaveLength(1);
  });

  it('reports files that share an id and lets the store give one a new id', async () => {
    const w = await store.createWorld({ name: 'Neon Ash', medium: 'video-game' });
    const dir = path.join(store.worldDir(w.slug), 'entries');
    await fs.writeFile(path.join(dir, 'vex.md'), '---\nid: dup\ntitle: Vex\n---\nA\n');
    await fs.writeFile(path.join(dir, 'vex-DESKTOP-1.md'), '---\nid: dup\ntitle: Vex\n---\nB\n');
    await index.rebuildWorkspace(store);

    const conflicts = index.getDuplicateIdConflicts(w.slug);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].relativePaths).toEqual(['vex-DESKTOP-1.md', 'vex.md']);

    const fixed = await store.reassignEntryId(w.slug, 'vex-DESKTOP-1.md');
    expect(fixed.id).not.toBe('dup');
    await index.syncWorld(store, (await store.listWorlds())[0]);
    expect(index.getDuplicateIdConflicts(w.slug)).toHaveLength(0);
    expect(index.queryCollection({ worldSlug: w.slug })).toHaveLength(2);
  });

  it('ranks title matches first and treats % and _ literally in collection search', async () => {
    const w = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    await store.createEntry({ worldSlug: w.slug, title: 'Harbor Notes', body: 'The citadel looms over everything. Citadel citadel.' });
    const citadel = await store.createEntry({ worldSlug: w.slug, title: 'Iron Citadel', body: 'A fortress.' });
    await store.createEntry({ worldSlug: w.slug, title: '100% Ash', body: 'x' });
    await store.createEntry({ worldSlug: w.slug, title: '1000 Ashes', body: 'y' });
    await index.rebuildWorkspace(store);

    expect(index.searchGlobal('citadel')[0].entryId).toBe(citadel.id);
    expect(index.queryCollection({ worldSlug: w.slug, search: '%' }).map((e) => e.title)).toEqual(['100% Ash']);
    // Body text is now searchable from collections too (via FTS), not just the 180-char excerpt
    expect(index.queryCollection({ worldSlug: w.slug, search: 'looms' }).map((e) => e.title)).toEqual(['Harbor Notes']);
    expect(toFtsQuery('"); DROP TABLE entries; --')).toBe('"DROP"* "TABLE"* "entries"*');
  });

  it('resolves backlinks and graph edges through aliases', async () => {
    const w = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    const dir = path.join(store.worldDir(w.slug), 'entries');
    await fs.writeFile(path.join(dir, 'kael.md'), '---\nid: kael\ntitle: Kael Vorn\naliases: [The Ash Knight]\n---\nBio\n');
    await fs.writeFile(path.join(dir, 'ballad.md'), '---\nid: ballad\ntitle: Ballad\n---\nSung of [[The Ash Knight]].\n');
    await index.rebuildWorkspace(store);

    expect(index.getBacklinks(w.slug, 'kael').map((b) => b.sourceId)).toEqual(['ballad']);
    expect(index.getWorldGraph(w.slug).edges).toHaveLength(1);
    expect(index.searchGlobal('ash knight')[0].entryId).toBe('kael');
  });

  it('supports incremental per-file updates and fast id lookups', async () => {
    const w = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
    const kael = await store.createEntry({ worldSlug: w.slug, title: 'Kael', folder: 'characters', body: 'v1' });
    await index.rebuildWorkspace(store);
    store.setEntryLocator((slug, id) => index.getEntryRelativePath(slug, id));

    expect(index.getEntryRelativePath(w.slug, kael.id)).toBe('characters/kael.md');
    expect((await store.readEntryById(w.slug, kael.id))?.body.trim()).toBe('v1');

    // A file synced from another PC: index just that file
    const full = path.join(store.worldDir(w.slug), 'entries', 'characters', 'kael.md');
    await fs.writeFile(full, (await fs.readFile(full, 'utf8')).replace('v1', 'v2 from laptop'));
    const fresh = await store.readEntryAtRelativePath(w.slug, 'characters/kael.md');
    index.upsertEntry(fresh!);
    expect(index.searchGlobal('laptop')[0].entryId).toBe(kael.id);

    expect(index.removeEntryByPath(w.slug, 'characters/kael.md')).toBe(kael.id);
    expect(index.queryCollection({ worldSlug: w.slug })).toHaveLength(0);
    // A stale locator falls back to scanning the files
    store.setEntryLocator(() => 'wrong/path.md');
    expect((await store.readEntryById(w.slug, kael.id))?.title).toBe('Kael');
  });

  it('rewrites wikilinks to a renamed entry, keeping labels and headings', () => {
    const md = 'See [[Old Name]], [[old name|the hero]], [[Old Name#Youth]] and [[Other]] plus ![[Old Name]].';
    expect(rewriteWikilinks(md, ['Old Name'], 'Kael Vorn')).toBe(
      'See [[Kael Vorn]], [[Kael Vorn|the hero]], [[Kael Vorn#Youth]] and [[Other]] plus ![[Old Name]].'
    );
  });
});
