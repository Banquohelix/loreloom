import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import {
  findArtLinkSuggestions,
  findDuplicateGroups,
  mergeDuplicateEntries,
} from '../world-hygiene';

describe('WorldHygiene', () => {
  let tmpDir: string;
  let store: WorkspaceStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-hygiene-'));
    store = new WorkspaceStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects duplicate entries and merges tags, properties, and unique prose without data loss', async () => {
    const world = await store.createWorld({ name: 'Neon Ash', medium: 'video-game' });
    const primary = await store.createEntry({
      worldSlug: world.slug,
      title: 'Ashgate',
      type: 'location',
      folder: 'Places',
      tags: ['city'],
      properties: { region: 'Sector Nine' },
      body: 'A multi-layered cyberpunk megacity clinging to the wasteland.',
    });
    const duplicate = await store.createEntry({
      worldSlug: world.slug,
      title: 'Ashgate',
      type: 'page',
      folder: 'Places',
      tags: ['starter'],
      properties: { climate: 'Acid rain' },
      body: 'Extra intake lore about the flooded Undercity canals.',
    });

    const all = await store.listAllEntriesInWorld(world.slug);
    const groups = findDuplicateGroups(all);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);

    const merged = await mergeDuplicateEntries(store, world.slug, primary.id, [duplicate.id]);
    expect(merged.tags).toEqual(expect.arrayContaining(['city', 'starter']));
    expect(merged.properties.region).toBe('Sector Nine');
    expect(merged.properties.climate).toBe('Acid rain');
    expect(merged.body).toContain('flooded Undercity canals');

    const remaining = await store.listAllEntriesInWorld(world.slug);
    expect(remaining).toHaveLength(1);
  });

  it('suggests high-confidence art links from note body references and medium links from filename matches', async () => {
    const world = await store.createWorld({ name: 'Neon Ash', medium: 'video-game' });
    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const vehicleArt = await store.saveArtAssetFromBuffer(
      world.slug,
      'k80_civic_runner_stock.png',
      fakePng,
      'prop'
    );
    const charArt = await store.saveArtAssetFromBuffer(
      world.slug,
      'kael_vorn_portrait.png',
      fakePng,
      'character'
    );

    const vehicleEntry = await store.createEntry({
      worldSlug: world.slug,
      title: 'K-80 Civic Runner',
      type: 'vehicle',
      body: 'Compact combat frame.\n- Image: k80_civic_runner_stock.png',
    });
    const charEntry = await store.createEntry({
      worldSlug: world.slug,
      title: 'Kael Vorn',
      type: 'character',
      body: 'Exiled warden.',
    });

    const suggestions = findArtLinkSuggestions(
      [vehicleEntry, charEntry],
      [vehicleArt, charArt]
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].confidence).toBe('high');
    expect(suggestions[0].entryId).toBe(vehicleEntry.id);
    expect(suggestions[0].suggestedSlot).toBe('cover');
    expect(suggestions[1].confidence).toBe('medium');
    expect(suggestions[1].entryId).toBe(charEntry.id);
    expect(suggestions[1].suggestedSlot).toBe('portrait');
  });
});
