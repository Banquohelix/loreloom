import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import { buildWorldBibleHtml } from '../bible-exporter';

describe('WorldBibleExporter', () => {
  let tmpDir: string;
  let store: WorkspaceStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-bible-'));
    store = new WorkspaceStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('builds a standalone World-themed HTML World Bible with embedded art and internal wikilink anchors', async () => {
    const world = await store.createWorld({
      name: 'Brimstone',
      subtitle: 'Continent of ash and railways',
      medium: 'novel',
      preset: 'parchment-lorebook',
    });

    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const art = await store.saveArtAssetFromBuffer(world.slug, 'bellamare.png', fakePng, 'environment');

    const loc = await store.createEntry({
      worldSlug: world.slug,
      title: 'Bellamare',
      type: 'location',
      coverAssetId: art.id,
      properties: { region: 'Coastal West' },
      body: 'Port city connected to [[Kael Vorn]].',
    });
    await store.createEntry({
      worldSlug: world.slug,
      title: 'Kael Vorn',
      type: 'character',
      body: 'Born in [[Bellamare]].',
    });

    const rendered = await buildWorldBibleHtml(store, world, {
      worldSlug: world.slug,
      includedTypeIds: ['location', 'character'],
      includeArtGallery: true,
      appearance: 'light',
    });

    expect(rendered.entryCount).toBe(2);
    expect(rendered.artCount).toBe(1);
    expect(rendered.html).toContain('Brimstone');
    expect(rendered.html).toContain('data:image/png;base64,');
    expect(rendered.html).toContain(`href="#entry-${loc.id}"`);
    expect(rendered.html).toContain('Concept Art Gallery');
  });
});
