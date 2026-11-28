import path from 'node:path';

const TRANSIENT_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EMFILE']);

/**
 * Retries a filesystem operation that failed with a transient Windows error. OneDrive, Google
 * Drive and antivirus scanners briefly lock files they are syncing or scanning, so a rename or
 * unlink that fails once usually succeeds a moment later.
 */
export async function withFsRetry<T>(op: () => Promise<T>, attempts = 6): Promise<T> {
  let delay = 40;
  for (let i = 1; ; i++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= attempts || !code || !TRANSIENT_FS_CODES.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 1000);
    }
  }
}

/** Rejects names that could escape their parent folder (`..`, separators, drive letters). */
export function assertSafeSegment(name: string, what = 'name'): string {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[\\/:*?"<>|\0]/.test(name)
  ) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * Resolves `relative` under `root` and throws if the result is outside `root`.
 * Uses a trailing separator so `worlds/foo` cannot match `worlds/foo-bar`.
 */
export function resolveInside(root: string, relative: string): string {
  const base = path.resolve(root);
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Path escapes its folder: ${relative}`);
  }
  return resolved;
}
