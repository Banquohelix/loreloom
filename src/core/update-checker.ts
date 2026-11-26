import type { UpdateCheckResult } from '../shared/types';

export const GITHUB_OWNER = 'Banquohelix';
export const GITHUB_REPO = 'loreloom';
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

export function parseSemver(version: string): [number, number, number] {
  const clean = version.trim().replace(/^v/i, '').split('-')[0];
  const parts = clean.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

interface GitHubReleaseAsset {
  name: string;
  url: string;
  browser_download_url: string;
}

interface GitHubReleasePayload {
  tag_name: string;
  html_url: string;
  body?: string;
  assets?: GitHubReleaseAsset[];
}

export async function checkLatestGitHubRelease(options: {
  currentVersion: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<UpdateCheckResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `Loreloom/${options.currentVersion}`,
  };
  if (options.token && options.token.trim()) {
    headers.Authorization = `Bearer ${options.token.trim()}`;
  }

  try {
    const res = await fetchFn(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers }
    );

    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return {
        status: 'auth-required',
        currentVersion: options.currentVersion,
        releaseUrl: RELEASES_PAGE_URL,
        message: options.token
          ? 'GitHub token could not access this private repository. Check token permissions (Contents: Read-only).'
          : 'This repository is private. Add a read-only GitHub token once for 1-click in-app updates, or open the Releases page in your browser.',
      };
    }

    if (!res.ok) {
      return {
        status: 'error',
        currentVersion: options.currentVersion,
        releaseUrl: RELEASES_PAGE_URL,
        message: `GitHub API returned HTTP ${res.status}.`,
      };
    }

    const data = (await res.json()) as GitHubReleasePayload;
    const latestVersion = (data.tag_name || '').replace(/^v/i, '');
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const setupAsset =
      assets.find((a) => /setup.*\.exe$/i.test(a.name)) ??
      assets.find((a) => /\.exe$/i.test(a.name));

    const cmp = compareSemver(options.currentVersion, latestVersion);
    if (cmp < 0) {
      return {
        status: 'update-available',
        currentVersion: options.currentVersion,
        latestVersion,
        releaseUrl: data.html_url || RELEASES_PAGE_URL,
        installerApiUrl: setupAsset?.url,
        installerFilename: setupAsset?.name,
        releaseNotes: data.body?.trim() || '',
      };
    }

    return {
      status: 'up-to-date',
      currentVersion: options.currentVersion,
      latestVersion,
      releaseUrl: data.html_url || RELEASES_PAGE_URL,
      message: `You are running the latest version (v${options.currentVersion}).`,
    };
  } catch (err) {
    return {
      status: 'error',
      currentVersion: options.currentVersion,
      releaseUrl: RELEASES_PAGE_URL,
      message: (err as Error).message || 'Could not reach GitHub.',
    };
  }
}
