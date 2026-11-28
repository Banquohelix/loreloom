import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { withFsRetry } from './fs-safety';

export async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Observes files Loreloom itself writes or removes, so the workspace watcher can ignore its own
 * echoes instead of re-indexing and refreshing the UI after every save.
 */
export const fileWriteObserver: { onWrite: ((absPath: string) => void) | null } = { onWrite: null };

export function notifyWrite(absPath: string): void {
  try {
    fileWriteObserver.onWrite?.(path.resolve(absPath));
  } catch {
    // Observer failures must never break a save
  }
}

/** Writes via a temp file + rename so a crash or sync client never sees a half-written file. */
export async function atomicWriteFile(filePath: string, content: string | Buffer): Promise<void> {
  notifyWrite(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tempPath, content);
  try {
    await withFsRetry(() => fs.rename(tempPath, filePath));
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

export function trashStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Moves a file or folder into a trash folder instead of deleting it permanently. */
export async function moveToTrash(sourcePath: string, trashDir: string, name: string): Promise<string> {
  await fs.mkdir(trashDir, { recursive: true });
  const dest = path.join(trashDir, `${trashStamp()}__${name}`);
  notifyWrite(sourcePath);
  try {
    await withFsRetry(() => fs.rename(sourcePath, dest));
  } catch {
    // Fallback for cross-device or locked folders: copy then remove
    await fs.cp(sourcePath, dest, { recursive: true });
    await withFsRetry(() => fs.rm(sourcePath, { recursive: true, force: true }));
  }
  return dest;
}
