import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../workspace-store';
import { ObsidianImporter } from '../obsidian-importer';

describe('ObsidianImporter', () => {
  let tmpWorkspace: string;
  let tmpVault: string;
  let store: WorkspaceStore;
  let importer: ObsidianImporter;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-imp-ws-'));
    tmpVault = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-imp-vault-'));
    store = new WorkspaceStore(tmpWorkspace);
    importer = new ObsidianImporter();

    // Create a realistic sample Obsidian vault
    await fs.mkdir(path.join(tmpVault, '.obsidian'), { recursive: true });
    await fs.writeFile(path.join(tmpVault, '.obsidian', 'app.json'), '{}');

    await fs.mkdir(path.join(tmpVault, 'Characters'), { recursive: true });
    await fs.mkdir(path.join(tmpVault, 'Locations'), { recursive: true });
    await fs.mkdir(path.join(tmpVault, 'Attachments'), { recursive: true });

    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await fs.writeFile(path.join(tmpVault, 'Attachments', 'lyra-concept.png'), fakePng);

    await fs.writeFile(
      path.join(tmpVault, 'Characters', 'Lyra Ashwood.md'),
      `---
role: Archivist
faction: Ember Choir
tags: [mage, hero]
---
![[lyra-concept.png|Lyra Portrait]]

Lyra studies forbidden relics at [[Sunspire Library]] and hunts [[Missing Note]]. #arcane
`
    );

    await fs.writeFile(
      path.join(tmpVault, 'Locations', 'Sunspire Library.md'),
      `---
type: place
---
# Sunspire Library
A towering archive of glass and bronze.
`
    );
  });

  afterEach(async () => {
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
    await fs.rm(tmpVault, { recursive: true, force: true });
  });

  it('scans a vault and non-destructively imports notes, frontmatter, tags, links, and embedded images', async () => {
    const preview = await importer.scanVault(tmpVault);
    expect(preview.noteCount).toBe(2);
    expect(preview.imageCount).toBe(1);
    expect(preview.frontmatterKeys).toContain('role');

    const report = await importer.importVault(store, {
      vaultPath: tmpVault,
      newWorldName: 'Ember Chronicles',
      newWorldMedium: 'novel',
    });

    expect(report.importedNotes).toBe(2);
    expect(report.copiedAssets).toBe(1);
    expect(report.resolvedLinks).toBe(1);
    expect(report.unresolvedLinks).toHaveLength(1);
    expect(report.unresolvedLinks[0].target).toBe('Missing Note');

    const entries = await store.listAllEntriesInWorld(report.worldSlug);
    const lyra = entries.find((e) => e.title === 'Lyra Ashwood');
    expect(lyra).toBeDefined();
    expect(lyra?.type).toBe('character');
    expect(lyra?.tags).toEqual(expect.arrayContaining(['mage', 'hero', 'arcane']));
    expect(lyra?.properties.role).toBe('Archivist');
    expect(lyra?.body).toContain('![Lyra Portrait](assets/lyra-concept.png)');
    expect(lyra?.portraitAssetId).toBeDefined();

    // Ensure Obsidian frontmatter `type: place` normalizes to Loreloom's `location`
    const sunspire = entries.find((e) => e.title === 'Sunspire Library');
    expect(sunspire?.type).toBe('location');

    // Ensure original vault is untouched
    const originalStillExists = await fs.readFile(
      path.join(tmpVault, 'Characters', 'Lyra Ashwood.md'),
      'utf8'
    );
    expect(originalStillExists).toContain('![[lyra-concept.png|Lyra Portrait]]');
  });
});
