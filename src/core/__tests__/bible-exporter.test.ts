import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import { BIBLE_IMAGE_SIZES, buildWorldBibleHtml, writeWorldBibleHtmlFile } from '../bible-exporter';

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

  it('streams to a file with per-use resized art and skips art that has not synced', async () => {
    const world = await store.createWorld({ name: 'Brimstone Story Vault', medium: 'novel' });
    const art = await store.saveArtAssetFromBuffer(world.slug, 'ash-sea.png', Buffer.from('png-bytes'));
    // A record whose image hasn't synced to this PC yet
    await fs.writeFile(
      path.join(store.recordsDir(world.slug, 'art'), 'ghost.yaml'),
      "id: ghost\nworldSlug: brimstone-story-vault\nfilename: not-synced.png\nrelativePath: assets/not-synced.png\ntitle: Ghost\ncategory: other\ntags: []\ncaption: ''\ncreatedAt: '2026-01-01T00:00:00.000Z'\n"
    );
    expect((await store.listArtAssets(world.slug)).find((a) => a.id === 'ghost')?.missing).toBe(true);
    await store.createEntry({
      worldSlug: world.slug,
      title: 'Kael',
      type: 'character',
      coverAssetId: art.id,
      portraitAssetId: art.id,
      body: 'Sketch:\n\n![sea](assets/ash-sea.png)',
    });

    const requested: number[] = [];
    const encoder = async (_abs: string, maxDimension: number) => {
      requested.push(maxDimension);
      return `data:image/jpeg;base64,SIZE${maxDimension}`;
    };
    const outPath = path.join(tmpDir, 'bible.html');
    const counts = await writeWorldBibleHtmlFile(
      store,
      world,
      { worldSlug: world.slug, includedTypeIds: ['character'], includeArtGallery: true, appearance: 'dark' },
      outPath,
      encoder
    );

    const html = await fs.readFile(outPath, 'utf8');
    expect(counts).toEqual({ entryCount: 1, artCount: 1 });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain(`SIZE${BIBLE_IMAGE_SIZES.cover}`);
    expect(html).toContain(`SIZE${BIBLE_IMAGE_SIZES.portrait}`);
    expect(html).toContain(`SIZE${BIBLE_IMAGE_SIZES.gallery}`);
    expect(html).toContain(`<img src="data:image/jpeg;base64,SIZE${BIBLE_IMAGE_SIZES.inline}" alt="sea"`);
    expect(html).not.toContain('Ghost');
    expect(requested).toHaveLength(4);
  });
  it('renders callouts as styled asides, and collapsible ones open so they print', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'novel' });
    const kael = await store.createEntry({
      worldSlug: world.slug,
      title: 'Kael Vorn',
      type: 'character',
      body: '> [!canon] Birth\n> Born in 3E 212.\n\n> [!spoiler]- Fate\n> Betrays the [[Kael Vorn|Citadel]].\n\n> Plain quote.',
    });
    expect(kael.excerpt).toBe('Birth Born in 3E 212. Fate Betrays the Citadel. Plain quote.');

    const { html } = await buildWorldBibleHtml(store, world, {
      worldSlug: world.slug,
      includedTypeIds: ['character'],
      includeArtGallery: false,
      appearance: 'light',
    });
    expect(html).toContain('<aside class="callout callout-canon"><div class="callout-title">Canon: Birth</div>');
    expect(html).toContain('<details class="callout callout-spoiler" open><summary class="callout-title">Spoiler: Fate</summary>');
    expect(html).toContain(`href="#entry-${kael.id}"`);
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('[!canon]');
  });
});
