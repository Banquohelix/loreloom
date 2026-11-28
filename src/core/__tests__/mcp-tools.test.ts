import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import { IndexEngine } from '../index-engine';
import { runLoreloomTool, type McpChange, type McpToolContext } from '../mcp-tools';

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** D9: the tools AI assistants use over MCP. */
describe('Loreloom MCP tools', () => {
  let tmpDir: string;
  let store: WorkspaceStore;
  let index: IndexEngine;
  let changes: McpChange[];
  let ctx: McpToolContext;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-mcp-'));
    store = new WorkspaceStore(tmpDir);
    await store.ensureInitialized();
    index = new IndexEngine(':memory:');
    changes = [];
    await store.createWorld({ name: 'Brimstone', medium: 'novel' });
    await index.rebuildWorkspace(store);
    ctx = { store, index, allowWrites: true, markDrafts: true, clientName: 'claude', onChange: (c) => changes.push(c) };
  });

  afterEach(async () => {
    index.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const call = (name: string, args: Record<string, unknown> = {}, context = ctx) => runLoreloomTool(context, name, args);

  it('lists Worlds and their schema', async () => {
    const worlds = await call('list_worlds');
    expect(worlds.text).toContain('Brimstone (brimstone)');
    const schema = await call('get_world_schema', { world: 'Brimstone' });
    const types = (schema.data as { types: Array<{ id: string; fields: unknown[] }> }).types;
    expect(types.map((t) => t.id)).toContain('character');
  });

  it('creates an entry, marks it for review, and finds it by search and title', async () => {
    const created = await call('create_entry', {
      title: 'Vessa Thorn',
      type: 'Character',
      body: 'A smuggler on the [[Ash Sea]].\n\n> [!secret] Motive\n> Owes the Citadel.',
      tags: ['npc'],
      properties: { role: 'Smuggler', status: 'Alive' },
    });
    expect(created.isError).toBeFalsy();
    expect(changes).toEqual([{ worldSlug: 'brimstone', kind: 'entry', action: 'created', title: 'Vessa Thorn', client: 'claude' }]);

    const read = await call('read_entry', { entry: 'vessa thorn' });
    const data = read.data as { type: string; tags: string[]; properties: Record<string, unknown>; path: string; body: string };
    expect(data.type).toBe('character');
    expect(data.tags).toEqual(['npc', 'needs-triage']);
    expect(data.properties).toMatchObject({ role: 'Smuggler' });
    expect(data.path).toMatch(/^characters\//);
    expect(data.body).toContain('> [!secret] Motive');

    const hits = await call('search_lore', { query: 'smuggler', world: 'brimstone' });
    expect(hits.text).toContain('Vessa Thorn');
  });

  it('appends safely and refuses to replace a body without a matching expected_updated_at', async () => {
    await call('create_entry', { title: 'Kael', type: 'character', body: 'Exiled.' });
    const appended = await call('update_entry', { entry: 'Kael', append: 'Born in 3E 212.', append_heading: 'History' });
    expect(appended.isError).toBeFalsy();
    const kael = (await call('read_entry', { entry: 'Kael' })).data as { body: string; updatedAt: string };
    expect(kael.body).toBe('Exiled.\n\n## History\n\nBorn in 3E 212.\n');

    const noStamp = await call('update_entry', { entry: 'Kael', body: 'Gone' });
    expect(noStamp.isError).toBe(true);
    const stale = await call('update_entry', { entry: 'Kael', body: 'Gone', expected_updated_at: '2000-01-01T00:00:00.000Z' });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/changed since you read it/);
    const ok = await call('update_entry', { entry: 'Kael', body: 'Rewritten.', expected_updated_at: kael.updatedAt, properties: { status: null, role: 'Knight' }, remove_tags: ['needs-triage'] });
    expect(ok.isError).toBeFalsy();
    const after = (await call('read_entry', { entry: 'Kael' })).data as { body: string; tags: string[]; properties: Record<string, unknown> };
    expect(after.body.trim()).toBe('Rewritten.');
    expect(after.tags).toEqual([]);
    expect(after.properties).toEqual({ role: 'Knight' });
  });

  it('adds relationships once', async () => {
    await call('create_entry', { title: 'Kael', type: 'character' });
    await call('create_entry', { title: 'Ashbound Order', type: 'faction' });
    expect((await call('add_relationship', { from: 'Kael', to: 'Ashbound Order', label: 'Member of' })).isError).toBeFalsy();
    expect((await call('add_relationship', { from: 'Kael', to: 'Ashbound Order', label: 'member of' })).text).toMatch(/already/);
    const kael = (await call('read_entry', { entry: 'Kael' })).data as { relationships: unknown[] };
    expect(kael.relationships).toEqual([{ label: 'Member of', target: 'Ashbound Order' }]);
  });

  it('saves generated concept art, attaches it, and builds a pinned map', async () => {
    await call('create_entry', { title: 'Kael', type: 'character' });
    const saved = await call('save_concept_art', {
      title: 'Kael Portrait',
      image_base64: `data:image/png;base64,${PNG.toString('base64')}`,
      caption: 'Ash-stained armour',
      category: 'character',
      attach_to_entry: 'Kael',
      attach_as: 'portrait',
    });
    expect(saved.isError).toBeFalsy();
    const art = await store.listArtAssets('brimstone');
    expect(art[0]).toMatchObject({ title: 'Kael Portrait', caption: 'Ash-stained armour', category: 'character', tags: ['needs-triage'] });
    expect(art[0].filename).toBe('kael-portrait.png');
    const kael = await store.readEntryById('brimstone', index.queryCollection({ worldSlug: 'brimstone' })[0].id);
    expect(kael?.portraitAssetId).toBe(art[0].id);

    // A map from a URL image (download injected), then a pin linked to Kael
    const withFetch = { ...ctx, fetchImage: async () => PNG };
    expect((await call('save_concept_art', { title: 'Ash Sea Map', image_url: 'https://example.com/map.png', category: 'map' }, withFetch)).isError).toBeFalsy();
    expect((await call('create_map', { title: 'The Ash Sea', art: 'Ash Sea Map' })).isError).toBeFalsy();
    const pin = await call('add_map_pin', { map: 'The Ash Sea', x: 42.5, y: 61, label: 'Kael’s camp', entry: 'Kael' });
    expect(pin.isError).toBeFalsy();
    const [map] = await store.listMaps('brimstone');
    expect(map.pins[0]).toMatchObject({ x: 42.5, y: 61, label: 'Kael’s camp', entryId: kael?.id });
  });

  it('rejects non-images and unsafe image URLs', async () => {
    const notImage = await call('save_concept_art', { title: 'x', image_base64: Buffer.from('hello world').toString('base64') });
    expect(notImage.isError).toBe(true);
    const http = await call('save_concept_art', { title: 'x', image_url: 'http://example.com/a.png' });
    expect(http.text).toMatch(/https/);
    const local = await call('save_concept_art', { title: 'x', image_url: 'https://localhost/a.png' });
    expect(local.text).toMatch(/local or private/);
  });

  it('refuses every write in read-only mode, and explains bad names', async () => {
    const readOnly = { ...ctx, allowWrites: false };
    for (const [name, args] of [
      ['create_entry', { title: 'X' }],
      ['update_entry', { entry: 'X', append: 'y' }],
      ['save_concept_art', { title: 'x', image_base64: PNG.toString('base64') }],
      ['create_map', { title: 'm', art: 'a' }],
    ] as const) {
      const r = await call(name, args as Record<string, unknown>, readOnly);
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/read-only/);
    }
    expect(changes).toHaveLength(0);
    expect((await call('create_entry', { title: 'X', type: 'spaceship' })).text).toMatch(/Unknown type "spaceship"/);
    expect((await call('read_entry', { entry: 'Nobody', world: 'Nowhere' })).text).toMatch(/World not found/);
    expect((await call('nope')).isError).toBe(true);
  });
});
