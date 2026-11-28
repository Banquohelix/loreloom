import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import { IndexEngine, extractPropertyLinks, humanizePropertyKey, rewritePropertyLinks } from '../index-engine';
import { buildWorldBibleHtml } from '../bible-exporter';
import {
  coercePropertyInput,
  finalizeFields,
  formatPropertyValue,
  parseLinkValue,
  readPropertyValue,
  safeExternalUrl,
  toLinkValue,
} from '../../shared/entity-type-utils';
import type { EntityTypeDef, PropertyFieldDef } from '../../shared/types';

/** C3: checkbox, URL and typed Relation properties. */
describe('property types', () => {
  const relation: PropertyFieldDef = { key: 'faction', label: 'Faction', fieldType: 'relation', targetTypes: ['faction'] };
  const checkbox: PropertyFieldDef = { key: 'alive', label: 'Alive', fieldType: 'checkbox' };

  it('saves checkboxes as true and removes the key when unchecked', () => {
    expect(coercePropertyInput(checkbox, true)).toBe(true);
    expect(coercePropertyInput(checkbox, false)).toBeUndefined();
    // Hand-written or Obsidian values read as checked
    for (const v of [true, 'true', 'yes', 'Yes', 1, 'x']) expect(readPropertyValue(checkbox, v as never)).toBe(true);
    for (const v of [false, 'false', 'no', 0]) expect(readPropertyValue(checkbox, v as never)).toBe(false);
    expect(formatPropertyValue(checkbox, true)).toBe('✓');
  });

  it('stores relations as Obsidian links and reads hand-written variants', () => {
    expect(toLinkValue('Ashbound Order')).toBe('[[Ashbound Order]]');
    expect(toLinkValue('Odd [name]|x')).toBe('[[Odd namex]]');
    expect(parseLinkValue('[[Kael Vorn|Kael]]')).toEqual({ target: 'Kael Vorn', label: 'Kael' });
    expect(parseLinkValue('[[Kael Vorn#Youth]]')).toEqual({ target: 'Kael Vorn', label: 'Kael Vorn' });
    expect(coercePropertyInput(relation, ['[[A]]', ' ', '[[B]]'])).toEqual(['[[A]]', '[[B]]']);
    expect(coercePropertyInput(relation, [])).toBeUndefined();
    expect(readPropertyValue(relation, '[[A]], [[B]]')).toEqual(['[[A]]', '[[B]]']);
    expect(readPropertyValue(relation, '[[A]]')).toEqual(['[[A]]']);
    expect(formatPropertyValue(relation, ['[[Ashbound Order]]', '[[Kael Vorn|Kael]]'])).toBe('Ashbound Order, Kael');
  });

  it('keeps relation target types when finalizing fields, and only for relations', () => {
    const fields = finalizeFields([
      { key: '', label: 'Faction', fieldType: 'relation', optionsText: '', targetTypes: ['faction', 'faction'] },
      { key: '', label: 'Allies', fieldType: 'relation', optionsText: '', targetTypes: [] },
      { key: '', label: 'Wiki', fieldType: 'url', optionsText: '', targetTypes: ['faction'] },
    ]);
    expect(fields[0]).toEqual({ key: 'faction', label: 'Faction', fieldType: 'relation', targetTypes: ['faction'] });
    expect(fields[1].targetTypes).toBeUndefined();
    expect(fields[2].targetTypes).toBeUndefined();
  });

  it('opens only http(s) URLs', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeExternalUrl('example.com/wiki')).toBe('https://example.com/wiki');
    expect(safeExternalUrl('file:///C:/Windows/calc.exe')).toBeNull();
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('just words')).toBeNull();
  });

  it('extracts and rewrites links in property values', () => {
    const props = { faction: ['[[Ashbound Order]]', '[[Iron Citadel|the Citadel]]'], mentor: '[[Old Wren]]', age: 34 };
    expect(extractPropertyLinks(props)).toEqual([
      { key: 'faction', target: 'Ashbound Order' },
      { key: 'faction', target: 'Iron Citadel' },
      { key: 'mentor', target: 'Old Wren' },
    ]);
    expect(rewritePropertyLinks(props, ['iron citadel'], 'Iron Bastion')).toEqual({
      ...props,
      faction: ['[[Ashbound Order]]', '[[Iron Bastion|the Citadel]]'],
    });
    expect(rewritePropertyLinks(props, ['Nobody'], 'X')).toBeNull();
    expect(humanizePropertyKey('home_faction')).toBe('Home faction');
    expect(humanizePropertyKey('homeFaction')).toBe('Home faction');
  });
});

describe('relation properties in the store, index and World Bible', () => {
  let tmpDir: string;
  let store: WorkspaceStore;
  let index: IndexEngine;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-props-'));
    store = new WorkspaceStore(tmpDir);
    await store.ensureInitialized();
    index = new IndexEngine(':memory:');
  });

  afterEach(async () => {
    index.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes Obsidian-readable frontmatter and counts relations as backlinks and labeled graph edges', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'novel' });
    const order = await store.createEntry({ worldSlug: world.slug, title: 'Ashbound Order', type: 'faction', body: '' });
    const kael = await store.createEntry({
      worldSlug: world.slug,
      title: 'Kael Vorn',
      type: 'character',
      body: 'No body links.',
      properties: { faction: ['[[Ashbound Order]]'], alive: true, wiki: 'https://example.com/kael' },
    });

    const raw = await fs.readFile(path.join(store.worldDir(world.slug), 'entries', kael.relativePath), 'utf8');
    expect(raw).toMatch(/faction:\n\s+- '\[\[Ashbound Order\]\]'/);
    expect(raw).toMatch(/alive: true/);
    const reread = await store.readEntryById(world.slug, kael.id);
    expect(reread?.properties).toMatchObject({ faction: ['[[Ashbound Order]]'], alive: true });

    const refreshed = (await store.listWorlds()).find((w) => w.slug === world.slug)!;
    await index.syncWorld(store, refreshed);
    const backlinks = index.getBacklinks(world.slug, order.id);
    expect(backlinks).toEqual([expect.objectContaining({ sourceId: kael.id, context: 'Faction: Ashbound Order' })]);
    const graph = index.getWorldGraph(world.slug);
    expect(graph.edges).toContainEqual({ sourceId: kael.id, targetId: order.id, label: 'Faction' });
  });

  it('shows relation links as anchors and uses field labels in the World Bible', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'novel' });
    const characterType = world.entityTypes.find((t) => t.id === 'character')!;
    const withFields: EntityTypeDef = {
      ...characterType,
      fields: [
        ...characterType.fields,
        { key: 'sworn_to', label: 'Sworn To', fieldType: 'relation' },
        { key: 'alive', label: 'Alive', fieldType: 'checkbox' },
      ],
    };
    const updated = await store.updateWorld(world.slug, {
      entityTypes: world.entityTypes.map((t) => (t.id === 'character' ? withFields : t)),
    });
    const order = await store.createEntry({ worldSlug: world.slug, title: 'Ashbound Order', type: 'character', body: '' });
    await store.createEntry({
      worldSlug: world.slug,
      title: 'Kael Vorn',
      type: 'character',
      body: '',
      properties: { sworn_to: ['[[Ashbound Order]]', '[[Nobody Yet]]'], alive: true },
    });

    const { html } = await buildWorldBibleHtml(store, updated, {
      worldSlug: world.slug,
      includedTypeIds: ['character'],
      includeArtGallery: false,
      appearance: 'light',
    });
    expect(html).toContain(`<dt>Sworn To</dt><dd><a href="#entry-${order.id}">Ashbound Order</a>, Nobody Yet</dd>`);
    expect(html).toContain('<dt>Alive</dt><dd>Yes</dd>');
    expect(html).not.toContain('[[Ashbound Order]]');
  });
});
