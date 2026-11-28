import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSafeSegment, resolveInside, withFsRetry } from '../fs-safety';
import { WorkspaceStore } from '../workspace-store';
import { findSha256ForFile, isTrustedReleaseAssetUrl } from '../update-checker';

describe('fs safety', () => {
  it('retries transient Windows lock errors, but not real failures', async () => {
    let calls = 0;
    const result = await withFsRetry(async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('locked by OneDrive'), { code: 'EBUSY' });
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);

    let enoent = 0;
    await expect(
      withFsRetry(async () => {
        enoent++;
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      })
    ).rejects.toThrow('missing');
    expect(enoent).toBe(1);
  });

  it('keeps paths inside their folder', () => {
    const root = path.resolve('/workspace/worlds/foo');
    expect(resolveInside(root, 'assets/a.png')).toBe(path.join(root, 'assets', 'a.png'));
    expect(() => resolveInside(root, '../foo-bar/secret.png')).toThrow();
    expect(() => resolveInside(root, '../../workspace.yaml')).toThrow();
    expect(() => assertSafeSegment('..')).toThrow();
    expect(() => assertSafeSegment('a/b')).toThrow();
    expect(assertSafeSegment('Brimstone Story Vault')).toBe('Brimstone Story Vault');
  });

  describe('store containment', () => {
    let tmpDir: string;
    let store: WorkspaceStore;
    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-fs-'));
      store = new WorkspaceStore(tmpDir);
      await store.ensureInitialized();
    });
    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('rejects world slugs, entry folders and asset paths that escape the workspace', async () => {
      const world = await store.createWorld({ name: 'Brimstone', medium: 'video-game' });
      expect(() => store.worldDir('../outside')).toThrow();
      await expect(
        store.createEntry({ worldSlug: world.slug, title: 'Escape', folder: '../../outside' })
      ).rejects.toThrow();
      expect(() => store.resolveAssetAbsolutePath(world.slug, '../brimstone-2/x.png')).toThrow();
      expect(store.resolveAssetAbsolutePath(world.slug, 'assets/x.png')).toBe(
        path.join(store.worldDir(world.slug), 'assets', 'x.png')
      );
    });
  });
});

describe('update verification helpers', () => {
  it('only trusts release assets from the Loreloom repository', () => {
    expect(isTrustedReleaseAssetUrl('https://api.github.com/repos/Banquohelix/loreloom/releases/assets/123')).toBe(true);
    expect(isTrustedReleaseAssetUrl('https://api.github.com/repos/someone/else/releases/assets/123')).toBe(false);
    expect(isTrustedReleaseAssetUrl('https://evil.example.com/repos/Banquohelix/loreloom/releases/assets/1')).toBe(false);
    expect(isTrustedReleaseAssetUrl('http://api.github.com/repos/Banquohelix/loreloom/releases/assets/1')).toBe(false);
    expect(isTrustedReleaseAssetUrl(undefined)).toBe(false);
  });

  it('finds an installer hash in SHA256SUMS, matching GitHub-renamed asset names', () => {
    const hash = 'a'.repeat(64);
    const sums = `${'b'.repeat(64)}  Loreloom.0.6.7.exe\r\n${hash}  Loreloom.Setup.0.6.7.exe\n`;
    expect(findSha256ForFile(sums, 'Loreloom.Setup.0.6.7.exe')).toBe(hash);
    expect(findSha256ForFile(`${hash} *Loreloom Setup 0.6.7.exe`, 'Loreloom.Setup.0.6.7.exe')).toBe(hash);
    expect(findSha256ForFile(sums, 'Other.exe')).toBeNull();
  });
});
