import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  BacklinkRef,
  CollectionQuery,
  Entry,
  EntrySummary,
  SearchHit,
  WorldConfig,
} from '../shared/types';
import type { WorkspaceStore } from './workspace-store';

export interface WikilinkExtraction {
  target: string;
  context: string;
}

export function extractWikilinks(markdown: string): WikilinkExtraction[] {
  const results: WikilinkExtraction[] = [];
  const regex = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const target = match[1].trim();
    if (!target) continue;
    const start = Math.max(0, match.index - 40);
    const end = Math.min(markdown.length, match.index + match[0].length + 40);
    const context = markdown.slice(start, end).replace(/\s+/g, ' ').trim();
    results.push({ target, context });
  }
  return results;
}

interface EntryRow {
  id: string;
  world_slug: string;
  title: string;
  slug: string;
  type: string;
  secondary_types_json: string;
  folder: string;
  relative_path: string;
  tags_json: string;
  properties_json: string;
  cover_asset_id: string | null;
  portrait_asset_id: string | null;
  updated_at: string;
  excerpt: string;
}

/**
 * Machine-local rebuildable SQLite + FTS5 index stored strictly outside OneDrive/Google Drive.
 * Accelerates Collection filtering, global full-text search, and [[wikilink]] backlink queries.
 */
export class IndexEngine {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS worlds (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        world_slug TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        type TEXT NOT NULL,
        secondary_types_json TEXT NOT NULL DEFAULT '[]',
        folder TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        properties_json TEXT NOT NULL,
        cover_asset_id TEXT,
        portrait_asset_id TEXT,
        updated_at TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        body TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entries_world_type ON entries(world_slug, type);
      CREATE INDEX IF NOT EXISTS idx_entries_world_title ON entries(world_slug, title COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS links (
        world_slug TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_key TEXT NOT NULL,
        context TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_links_target ON links(world_slug, target_key);
      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        entry_id UNINDEXED,
        world_slug UNINDEXED,
        title,
        tags,
        body
      );
    `);

    // Non-destructive migration for existing local index.db files
    const cols = this.db.prepare('PRAGMA table_info(entries)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'secondary_types_json')) {
      this.db.exec("ALTER TABLE entries ADD COLUMN secondary_types_json TEXT NOT NULL DEFAULT '[]'");
    }
  }

  close(): void {
    this.db.close();
  }

  async rebuildWorkspace(store: WorkspaceStore): Promise<{ indexedEntries: number; indexedWorlds: number }> {
    const worlds = await store.listWorlds();
    this.db.exec('DELETE FROM worlds; DELETE FROM entries; DELETE FROM links; DELETE FROM entries_fts;');

    const insertWorld = this.db.prepare('INSERT OR REPLACE INTO worlds (slug, name) VALUES (?, ?)');
    let indexedEntries = 0;

    for (const world of worlds) {
      insertWorld.run(world.slug, world.name);
      const entries = await store.listAllEntriesInWorld(world.slug);
      for (const entry of entries) {
        this.upsertEntry(entry, world);
        indexedEntries++;
      }
    }

    return { indexedEntries, indexedWorlds: worlds.length };
  }

  async syncWorld(store: WorkspaceStore, world: WorldConfig): Promise<number> {
    this.db.prepare('INSERT OR REPLACE INTO worlds (slug, name) VALUES (?, ?)').run(world.slug, world.name);
    this.db.prepare('DELETE FROM entries WHERE world_slug = ?').run(world.slug);
    this.db.prepare('DELETE FROM links WHERE world_slug = ?').run(world.slug);
    this.db.prepare('DELETE FROM entries_fts WHERE world_slug = ?').run(world.slug);

    const entries = await store.listAllEntriesInWorld(world.slug);
    for (const entry of entries) {
      this.upsertEntry(entry, world);
    }
    return entries.length;
  }

  removeWorld(worldSlug: string): void {
    this.db.prepare('DELETE FROM worlds WHERE slug = ?').run(worldSlug);
    this.db.prepare('DELETE FROM entries WHERE world_slug = ?').run(worldSlug);
    this.db.prepare('DELETE FROM links WHERE world_slug = ?').run(worldSlug);
    this.db.prepare('DELETE FROM entries_fts WHERE world_slug = ?').run(worldSlug);
  }

  upsertEntry(entry: Entry, world?: Pick<WorldConfig, 'slug' | 'name'>): void {
    if (world) {
      this.db
        .prepare('INSERT OR REPLACE INTO worlds (slug, name) VALUES (?, ?)')
        .run(world.slug, world.name);
    }

    this.db
      .prepare(
        `INSERT OR REPLACE INTO entries
        (id, world_slug, title, slug, type, secondary_types_json, folder, relative_path, tags_json, properties_json, cover_asset_id, portrait_asset_id, updated_at, excerpt, body)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.worldSlug,
        entry.title,
        entry.slug,
        entry.type,
        JSON.stringify(entry.secondaryTypes ?? []),
        entry.folder,
        entry.relativePath,
        JSON.stringify(entry.tags),
        JSON.stringify(entry.properties),
        entry.coverAssetId ?? null,
        entry.portraitAssetId ?? null,
        entry.updatedAt,
        entry.excerpt,
        entry.body
      );

    this.db.prepare('DELETE FROM entries_fts WHERE entry_id = ?').run(entry.id);
    this.db
      .prepare(
        'INSERT INTO entries_fts (entry_id, world_slug, title, tags, body) VALUES (?, ?, ?, ?, ?)'
      )
      .run(entry.id, entry.worldSlug, entry.title, entry.tags.join(' '), entry.body);

    this.db.prepare('DELETE FROM links WHERE source_id = ?').run(entry.id);
    const links = extractWikilinks(entry.body);
    const insertLink = this.db.prepare(
      'INSERT INTO links (world_slug, source_id, target_key, context) VALUES (?, ?, ?, ?)'
    );
    for (const link of links) {
      insertLink.run(entry.worldSlug, entry.id, link.target.toLowerCase(), link.context);
    }
  }

  removeEntry(entryId: string): void {
    this.db.prepare('DELETE FROM entries WHERE id = ?').run(entryId);
    this.db.prepare('DELETE FROM entries_fts WHERE entry_id = ?').run(entryId);
    this.db.prepare('DELETE FROM links WHERE source_id = ?').run(entryId);
  }

  queryCollection(query: CollectionQuery): EntrySummary[] {
    const clauses: string[] = ['world_slug = ?'];
    const params: Array<string> = [query.worldSlug];

    if (query.type && query.type !== 'all') {
      clauses.push('(type = ? OR secondary_types_json LIKE ?)');
      params.push(query.type, `%"${query.type}"%`);
    }

    if (query.search && query.search.trim()) {
      clauses.push('(title LIKE ? OR excerpt LIKE ? OR tags_json LIKE ?)');
      const pattern = `%${query.search.trim()}%`;
      params.push(pattern, pattern, pattern);
    }

    if (query.tag && query.tag.trim()) {
      clauses.push('tags_json LIKE ?');
      params.push(`%"${query.tag.trim()}"%`);
    }

    const orderCol = query.sortBy === 'title' ? 'title COLLATE NOCASE' : 'updated_at';
    const orderDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const sql = `
      SELECT id, world_slug, title, slug, type, secondary_types_json, folder, relative_path, tags_json, properties_json, cover_asset_id, portrait_asset_id, updated_at, excerpt
      FROM entries
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${orderCol} ${orderDir}
    `;

    const rows = this.db.prepare(sql).all(...params) as unknown as EntryRow[];
    return rows.map((row) => this.rowToSummary(row));
  }

  getBacklinks(worldSlug: string, entryId: string): BacklinkRef[] {
    const target = this.db
      .prepare('SELECT title, slug FROM entries WHERE world_slug = ? AND id = ?')
      .get(worldSlug, entryId) as { title: string; slug: string } | undefined;

    if (!target) return [];

    const rows = this.db
      .prepare(
        `SELECT DISTINCT e.id as sourceId, e.title as sourceTitle, e.type as sourceType, l.context as context
         FROM links l
         JOIN entries e ON e.id = l.source_id
         WHERE l.world_slug = ?
           AND l.source_id != ?
           AND (l.target_key = ? OR l.target_key = ?)`
      )
      .all(
        worldSlug,
        entryId,
        target.title.toLowerCase(),
        target.slug.toLowerCase()
      ) as unknown as BacklinkRef[];

    return rows;
  }

  getEntriesLinkingAsset(worldSlug: string, assetId: string, assetFilename: string): EntrySummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, world_slug, title, slug, type, secondary_types_json, folder, relative_path, tags_json, properties_json, cover_asset_id, portrait_asset_id, updated_at, excerpt
         FROM entries
         WHERE world_slug = ?
           AND (cover_asset_id = ? OR portrait_asset_id = ? OR body LIKE ?)`
      )
      .all(worldSlug, assetId, assetId, `%${assetFilename}%`) as unknown as EntryRow[];

    return rows.map((row) => this.rowToSummary(row));
  }

  searchGlobal(rawQuery: string, limit = 25): SearchHit[] {
    const trimmed = rawQuery.trim();
    if (!trimmed) return [];

    const safeTokens = trimmed
      .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `${t}*`)
      .join(' ');

    if (!safeTokens) return [];

    const rows = this.db
      .prepare(
        `SELECT
           e.id as entryId,
           e.world_slug as worldSlug,
           COALESCE(w.name, e.world_slug) as worldName,
           e.title as title,
           e.type as type,
           snippet(entries_fts, 4, '[', ']', '…', 14) as snippet
         FROM entries_fts
         JOIN entries e ON e.id = entries_fts.entry_id
         LEFT JOIN worlds w ON w.slug = e.world_slug
         WHERE entries_fts MATCH ?
         LIMIT ?`
      )
      .all(safeTokens, limit) as unknown as SearchHit[];

    return rows;
  }

  private rowToSummary(row: EntryRow): EntrySummary {
    return {
      id: row.id,
      worldSlug: row.world_slug,
      title: row.title,
      slug: row.slug,
      type: row.type,
      secondaryTypes: JSON.parse(row.secondary_types_json || '[]'),
      folder: row.folder,
      relativePath: row.relative_path,
      tags: JSON.parse(row.tags_json || '[]'),
      properties: JSON.parse(row.properties_json || '{}'),
      coverAssetId: row.cover_asset_id ?? undefined,
      portraitAssetId: row.portrait_asset_id ?? undefined,
      updatedAt: row.updated_at,
      excerpt: row.excerpt,
    };
  }
}
