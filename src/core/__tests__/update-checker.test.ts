import { describe, it, expect } from 'vitest';
import { checkLatestGitHubRelease, compareSemver } from '../update-checker';

describe('UpdateChecker', () => {
  it('compares semantic versions accurately', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);
    expect(compareSemver('v0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
  });

  it('detects available updates and selects the Windows Setup installer asset', async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v0.3.0',
          html_url: 'https://github.com/Banquohelix/loreloom/releases/tag/v0.3.0',
          body: 'Added in-app update checker.',
          assets: [
            {
              name: 'Loreloom.0.3.0.exe',
              url: 'https://api.github.com/repos/Banquohelix/loreloom/releases/assets/1',
              browser_download_url: 'https://example.com/portable.exe',
            },
            {
              name: 'Loreloom.Setup.0.3.0.exe',
              url: 'https://api.github.com/repos/Banquohelix/loreloom/releases/assets/2',
              browser_download_url: 'https://example.com/setup.exe',
            },
          ],
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await checkLatestGitHubRelease({
      currentVersion: '0.2.0',
      token: 'ghp_test',
      fetchImpl: fakeFetch,
    });

    expect(result.status).toBe('update-available');
    expect(result.latestVersion).toBe('0.3.0');
    expect(result.installerFilename).toBe('Loreloom.Setup.0.3.0.exe');
    expect(result.installerApiUrl).toContain('/assets/2');
  });

  it('reports auth-required when private repo returns 404 without token', async () => {
    const fakeFetch = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch;

    const result = await checkLatestGitHubRelease({
      currentVersion: '0.2.0',
      fetchImpl: fakeFetch,
    });

    expect(result.status).toBe('auth-required');
  });
});
