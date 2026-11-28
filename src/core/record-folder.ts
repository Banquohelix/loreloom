import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { assertSafeSegment, withFsRetry } from './fs-safety';
import { atomicWriteFile, exists, moveToTrash, notifyWrite } from './fs-io';

interface LoadedRecord<T> {
  record: T;
  file: string;
  canonical: boolean;
}

/**
 * A folder holding one small YAML file per record (`<id>.yaml`).
 *
 * Shared manifests (one file listing every art asset, map or board) turn edits on two PCs into
 * OneDrive/Google Drive conflict copies. With one file per record, editing different records on
 * different PCs never touches the same file. When the same record is edited on two PCs, the sync
 * client's conflict copy (`<id>-DESKTOP.yaml`) is read too: the newer `updatedAt` wins, and
 * removing the record removes every copy so it can't come back.
 */
export class RecordFolder<T extends { id: string }> {
  constructor(
    public readonly dir: string,
    private readonly normalize: (raw: unknown) => T | null = defaultNormalize
  ) {}

  fileFor(id: string): string {
    return path.join(this.dir, `${assertSafeSegment(id, 'record id')}.yaml`);
  }

  private async load(): Promise<Map<string, LoadedRecord<T>[]>> {
    const byId = new Map<string, LoadedRecord<T>[]>();
    if (!(await exists(this.dir))) return byId;
    const names = await fs.readdir(this.dir);
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.yaml') || name.endsWith('.tmp')) continue;
      const file = path.join(this.dir, name);
      try {
        const record = this.normalize(yaml.load(await withFsRetry(() => fs.readFile(file, 'utf8'))));
        if (!record || typeof record.id !== 'string' || !record.id) continue;
        const list = byId.get(record.id) ?? [];
        list.push({ record, file, canonical: name === `${record.id}.yaml` });
        byId.set(record.id, list);
      } catch {
        // Malformed or still-syncing file: skip it this time, it is read again on the next list
      }
    }
    return byId;
  }

  private static pick<T>(copies: LoadedRecord<T>[]): LoadedRecord<T> {
    const stamp = (r: LoadedRecord<T>) => String((r.record as { updatedAt?: unknown }).updatedAt ?? '');
    return [...copies].sort((a, b) => {
      const byTime = stamp(b).localeCompare(stamp(a));
      if (byTime !== 0) return byTime;
      return Number(b.canonical) - Number(a.canonical);
    })[0];
  }

  async list(): Promise<T[]> {
    const byId = await this.load();
    return Array.from(byId.values()).map((copies) => RecordFolder.pick(copies).record);
  }

  async get(id: string): Promise<T | null> {
    const file = this.fileFor(id);
    if (await exists(file)) {
      try {
        const record = this.normalize(yaml.load(await withFsRetry(() => fs.readFile(file, 'utf8'))));
        if (record && record.id === id) {
          // A conflict copy might be newer; only then pay for a full folder read
          const names = await fs.readdir(this.dir);
          if (!names.some((n) => n !== `${id}.yaml` && n.startsWith(`${id}`) && n.endsWith('.yaml'))) {
            return record;
          }
        }
      } catch {
        // Fall through to a full read
      }
    }
    const copies = (await this.load()).get(id);
    return copies ? RecordFolder.pick(copies).record : null;
  }

  /** Writes the record to `<id>.yaml`. Returns false (and writes nothing) if it is unchanged. */
  async put(record: T): Promise<boolean> {
    const file = this.fileFor(record.id);
    const content = yaml.dump(record, { noRefs: true });
    try {
      if ((await fs.readFile(file, 'utf8')) === content) return false;
    } catch {
      // New record
    }
    await atomicWriteFile(file, content);
    return true;
  }

  /** Removes every file for this record. With `trashDir`, they are moved there instead of deleted. */
  async remove(id: string, trashDir?: string): Promise<void> {
    const copies = (await this.load()).get(id) ?? [];
    const files = new Set(copies.map((c) => c.file));
    const canonical = this.fileFor(id);
    if (await exists(canonical)) files.add(canonical);
    for (const file of files) {
      if (trashDir) {
        await moveToTrash(file, trashDir, path.basename(file));
      } else {
        notifyWrite(file);
        await withFsRetry(() => fs.rm(file, { force: true }));
      }
    }
  }
}

function defaultNormalize<T extends { id: string }>(raw: unknown): T | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as T) : null;
}
