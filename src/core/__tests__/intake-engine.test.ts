import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import {
  IntakeEngine,
  NEEDS_TRIAGE_TAG,
  classifyArtAsset,
  classifyTextNote,
} from '../intake-engine';
import { cloneStarterEntityTypes } from '../../shared/starter-types';

describe('IntakeEngine', () => {
  let tmpWorkspace: string;
  let tmpDropFolder: string;
  let store: WorkspaceStore;
  let engine: IntakeEngine;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-intake-ws-'));
    tmpDropFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-brimstone-'));
    store = new WorkspaceStore(tmpWorkspace);
    engine = new IntakeEngine();
  });

  afterEach(async () => {
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
    await fs.rm(tmpDropFolder, { recursive: true, force: true });
  });

  it('classifies AI-generated notes by folder, headings/body keywords, and falls back to needs-triage', () => {
    const types = cloneStarterEntityTypes();

    const charNote = classifyTextNote(
      'vex_character_sheet.md',
      '# Vex Calder\n- **Role:** Smuggler\n- **Faction:** Neon Ash Syndicate\n- **Status:** Alive\n',
      types
    );
    expect(charNote.typeId).toBe('character');
    expect(charNote.needsTriage).toBe(false);
    expect(charNote.extractedProperties.role).toBe('Smuggler');
    expect(charNote.extractedProperties.faction).toBe('Neon Ash Syndicate');

    const bodyInferredLocation = classifyTextNote(
      'gemini_output_04.txt',
      '# The Cinder Docks\nClimate: Acid rain and ash fog\nPopulation: 40,000\n',
      types
    );
    expect(bodyInferredLocation.typeId).toBe('location');
    expect(bodyInferredLocation.needsTriage).toBe(false);

    const ambiguous = classifyTextNote(
      'random_brainstorm.txt',
      'Some vague poetic fragments about rain and neon.',
      types
    );
    expect(ambiguous.typeId).toBe('page');
    expect(ambiguous.needsTriage).toBe(true);
    expect(ambiguous.suggestedTags).toContain(NEEDS_TRIAGE_TAG);
  });

  it('classifies concept art images by filename and folder and flags ambiguous art', () => {
    expect(classifyArtAsset('Maps/brimstone_worldmap_v2.png').category).toBe('map');
    expect(classifyArtAsset('kael_portrait_final.webp').category).toBe('character');
    expect(classifyArtAsset('neon_ash_skyline_vista.jpg').category).toBe('environment');

    const ambiguous = classifyArtAsset('IMG_4021.png');
    expect(ambiguous.category).toBe('other');
    expect(ambiguous.needsTriage).toBe(true);
    expect(ambiguous.suggestedTags).toContain(NEEDS_TRIAGE_TAG);
  });

  it('non-destructively syncs a drop folder, skips unchanged files on re-sync, and updates modified notes', async () => {
    const world = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });

    await fs.mkdir(path.join(tmpDropFolder, 'Characters'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDropFolder, 'Characters', 'ash_warden.md'),
      '# Ash Warden\n- **Role:** Enforcer\n- **Status:** Alive\n\nGuards the slag gates.'
    );
    await fs.writeFile(
      path.join(tmpDropFolder, 'brainstorm.txt'),
      'Loose thoughts from Claude.'
    );
    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await fs.writeFile(path.join(tmpDropFolder, 'brimstone_city_map.png'), fakePng);

    // First sync
    const first = await engine.syncWorldIntake(store, world, [tmpDropFolder]);
    expect(first.importedEntries).toBe(2);
    expect(first.importedArt).toBe(1);
    expect(first.needsTriageCount).toBe(1);
    expect(first.skippedUnchanged).toBe(0);

    // Second sync with no changes -> everything skipped
    const second = await engine.syncWorldIntake(store, world, [tmpDropFolder]);
    expect(second.importedEntries).toBe(0);
    expect(second.importedArt).toBe(0);
    expect(second.skippedUnchanged).toBe(3);

    // Modify existing note -> updates in place without duplicating
    await fs.writeFile(
      path.join(tmpDropFolder, 'Characters', 'ash_warden.md'),
      '# Ash Warden\n- **Role:** Enforcer\n- **Status:** Alive\n\nGuards the slag gates and carries a cinder lance.'
    );
    const third = await engine.syncWorldIntake(store, world, [tmpDropFolder]);
    expect(third.updatedEntries).toBe(1);
    expect(third.importedEntries).toBe(0);

    const allEntries = await store.listAllEntriesInWorld(world.slug);
    expect(allEntries).toHaveLength(2);
    expect(allEntries.find((e) => e.title === 'Ash Warden')?.body).toContain('cinder lance');
  });

  it('reclassifies previously triaged items after a new custom EntityType (like Vehicles) is added', async () => {
    let world = await store.createWorld({ name: 'Neon Ash', medium: 'novel' });
    await store.createEntry({
      worldSlug: world.slug,
      title: 'Nomad Ash Vehicle',
      type: 'page',
      folder: 'intake',
      tags: ['intake', NEEDS_TRIAGE_TAG],
      body: '- **Manufacturer:** Helix Works\nFast armored skiff.',
    });

    // Add custom Vehicle type to the world
    world = await store.updateWorld(world.slug, {
      entityTypes: [
        ...world.entityTypes,
        {
          id: 'vehicle',
          name: 'Vehicle',
          pluralName: 'Vehicles',
          icon: 'rocket',
          color: '#0ea5e9',
          defaultView: 'gallery',
          fields: [{ key: 'manufacturer', label: 'Manufacturer', fieldType: 'text' }],
        },
      ],
    });

    const report = await engine.reclassifyTriageItems(store, world);
    expect(report.reclassifiedEntries).toBe(1);
    expect(report.remainingTriage).toBe(0);

    const updated = (await store.listAllEntriesInWorld(world.slug))[0];
    expect(updated.type).toBe('vehicle');
    expect(updated.tags).not.toContain(NEEDS_TRIAGE_TAG);
    expect(updated.properties.manufacturer).toBe('Helix Works');
  });
});
