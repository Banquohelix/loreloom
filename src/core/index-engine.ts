import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type {
  BacklinkRef,
  CollectionQuery,
  Entry,
  EntrySummary,
  GraphEdge,
  GraphNode,
  SearchHit,
  WorldConfig,
  WorldGraph,
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

/** Rewrites `[[Old Title]]`, `[[Old Title|label]]` and `[[Old Title#heading]]` to point at `newTitle`. */
export function rewriteWikilinks(markdown: string, oldKeys: string[], newTitle: string): string {
  const lowered = new Set(oldKeys.map((k) => k.toLowerCase()));
  return markdown.replace(
    /(?<!!)\[\[([^\]|#]+)((?:#[^\]|]+)?(?:\|[^\]]+)?)\]\]/g,
    (full, target: string, rest: string) => (lowered.has(target.trim().toLowerCase()) ? `[[${newTitle}${rest}]]` : full)
  );
}

/** `aliases:` frontmatter (Obsidian convention) as a clean list of strings. */
export function getEntryAliases(entry: Pick<Entry, 'extraFrontmatter'>): string[] {
  const raw = entry.extraFrontmatter?.aliases ?? entry.extraFrontmatter?.alias;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return Array.from(new Set(list.map((a) => String(a).trim()).filter(Boolean)));
}

/** Two or more files in one World that share the same frontmatter `id` (e.g. OneDrive conflict copies). */
export interface DuplicateIdConflict {
  worldSlug: string;
  id: string;
  relativePaths: string[];
}

interface EntryRow {
  id: string;
  world_slug: string;
  title: string;
  slug: string;
  type: string;
  secondary_types_json: string;
  relationships_json: string;
  folder: string;
  relative_path: string;
  tags_json: string;
  properties_json: string;
  cover_asset_id: string | null;
  portrait_asset_id: string | null;
  updated_at: string;
  excerpt: string;
}

/** Bump to drop and rebuild the (disposable) local index when its schema changes. */
const SCHEMA_VERSION = 2;

const SUMMARY_COLUMNS =
  'id, world_slug, title, slug, type, secondary_types_json, relationships_json, folder, relative_path, tags_json, properties_json, cover_asset_id, portrait_asset_id, updated_at, excerpt';

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Turns free text into a safe FTS5 prefix query (`ash* sea*`), or null when nothing is searchable. */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .trim()
    .replace(/[^\p{L}\p{N}\s_]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`);
  return tokens.length > 0 ? tokens.join(' ') : null;
}

/**
 * Machine-local rebuildable SQLite + FTS5 index stored strictly outside OneDrive/Google Drive.
 * Accelerates Collection filtering, global full-text search, and [[wikilink]] backlink queries.
 * Entries are keyed by (world_slug, id), so copying a World can't make entries vanish.
 */
export class IndexEngine {
  private db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  private duplicateIds = new Map<string, DuplicateIdConflict[]>();

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /** Runs `fn` in one transaction: thousands of inserts become one fsync, and readers never see a half-built index. */
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private initSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version !== SCHEMA_VERSION) {
      // The index is a cache of the Markdown files; rebuilding is always safe.
      this.db.exec(`
        DROP TABLE IF EXISTS worlds;
        DROP TABLE IF EXISTS entries;
        DROP TABLE IF EXISTS links;
        DROP TABLE IF EXISTS entries_fts;
      `);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worlds (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entries (
        id TEXT NOT NULL,
        world_slug TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        type TEXT NOT NULL,
        secondary_types_json TEXT NOT NULL DEFAULT '[]',
        relationships_json TEXT NOT NULL DEFAULT '[]',
        aliases_json TEXT NOT NULL DEFAULT '[]',
        folder TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        properties_json TEXT NOT NULL,
        cover_asset_id TEXT,
        portrait_asset_id TEXT,
        updated_at TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (world_slug, id)
      );

      CREATE INDEX IF NOT EXISTS idx_entries_world_type ON entries(world_slug, type);
      CREATE INDEX IF NOT EXISTS idx_entries_world_title ON entries(world_slug, title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_entries_world_path ON entries(world_slug, relative_path);

      CREATE TABLE IF NOT EXISTS links (
        world_slug TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_key TEXT NOT NULL,
        context TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_links_target ON links(world_slug, target_key);
      CREATE INDEX IF NOT EXISTS idx_links_source ON links(world_slug, source_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        entry_id UNINDEXED,
        world_slug UNINDEXED,
        title,
        tags,
        body
      );
    `);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  async rebuildWorkspace(store: WorkspaceStore): Promise<{ indexedEntries: number; indexedWorlds: number }> {
    const worlds = await store.listWorlds();
    // Read every file first (async), then swap the index contents in one transaction
    const perWorld: Array<{ world: WorldConfig; entries: Entry[] }> = [];
    for (const world of worlds) {
      perWorld.push({ world, entries: await store.listAllEntriesInWorld(world.slug) });
    }

    let indexedEntries = 0;
    this.transaction(() => {
      this.db.exec('DELETE FROM worlds; DELETE FROM entries; DELETE FROM links; DELETE FROM entries_fts;');
      this.duplicateIds.clear();
      for (const { world, entries } of perWorld) {
        this.upsertWorld(world);
        this.duplicateIds.set(world.slug, findDuplicateIds(world.slug, entries));
        for (const entry of entries) {
          this.writeEntryRows(entry);
          indexedEntries++;
        }
      }
    });

    return { indexedEntries, indexedWorlds: worlds.length };
  }

  async syncWorld(store: WorkspaceStore, world: WorldConfig): Promise<number> {
    const entries = await store.listAllEntriesInWorld(world.slug);
    this.transaction(() => {
      this.upsertWorld(world);
      this.deleteWorldRows(world.slug, false);
      this.duplicateIds.set(world.slug, findDuplicateIds(world.slug, entries));
      for (const entry of entries) this.writeEntryRows(entry);
    });
    return entries.length;
  }

  upsertWorld(world: Pick<WorldConfig, 'slug' | 'name'>): void {
    this.stmt('INSERT OR REPLACE INTO worlds (slug, name) VALUES (?, ?)').run(world.slug, world.name);
  }

  removeWorld(worldSlug: string): void {
    this.transaction(() => this.deleteWorldRows(worldSlug, true));
    this.duplicateIds.delete(worldSlug);
  }

  private deleteWorldRows(worldSlug: string, includeWorld: boolean): void {
    if (includeWorld) this.stmt('DELETE FROM worlds WHERE slug = ?').run(worldSlug);
    this.stmt('DELETE FROM entries WHERE world_slug = ?').run(worldSlug);
    this.stmt('DELETE FROM links WHERE world_slug = ?').run(worldSlug);
    this.stmt('DELETE FROM entries_fts WHERE world_slug = ?').run(worldSlug);
  }

  upsertEntry(entry: Entry, world?: Pick<WorldConfig, 'slug' | 'name'>): void {
    this.transaction(() => {
      if (world) this.upsertWorld(world);
      this.writeEntryRows(entry);
    });
  }

  private writeEntryRows(entry: Entry): void {
    this.stmt(
      `INSERT OR REPLACE INTO entries
      (id, world_slug, title, slug, type, secondary_types_json, relationships_json, aliases_json, folder, relative_path, tags_json, properties_json, cover_asset_id, portrait_asset_id, updated_at, excerpt, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id,
      entry.worldSlug,
      entry.title,
      entry.slug,
      entry.type,
      JSON.stringify(entry.secondaryTypes ?? []),
      JSON.stringify(entry.relationships ?? []),
      JSON.stringify(getEntryAliases(entry)),
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

    this.stmt('DELETE FROM entries_fts WHERE world_slug = ? AND entry_id = ?').run(entry.worldSlug, entry.id);
    this.stmt('INSERT INTO entries_fts (entry_id, world_slug, title, tags, body) VALUES (?, ?, ?, ?, ?)').run(
      entry.id,
      entry.worldSlug,
      [entry.title, ...getEntryAliases(entry)].join(' '),
      entry.tags.join(' '),
      entry.body
    );

    this.stmt('DELETE FROM links WHERE world_slug = ? AND source_id = ?').run(entry.worldSlug, entry.id);
    const insertLink = this.stmt('INSERT INTO links (world_slug, source_id, target_key, context) VALUES (?, ?, ?, ?)');
    for (const link of extractWikilinks(entry.body)) {
      insertLink.run(entry.worldSlug, entry.id, link.target.toLowerCase(), link.context);
    }
  }

  removeEntry(worldSlug: string, entryId: string): void {
    this.transaction(() => {
      this.stmt('DELETE FROM entries WHERE world_slug = ? AND id = ?').run(worldSlug, entryId);
      this.stmt('DELETE FROM entries_fts WHERE world_slug = ? AND entry_id = ?').run(worldSlug, entryId);
      this.stmt('DELETE FROM links WHERE world_slug = ? AND source_id = ?').run(worldSlug, entryId);
    });
  }

  /** Removes whatever entry is indexed at this file path (used when a file is deleted on disk). */
  removeEntryByPath(worldSlug: string, relativePath: string): string | null {
    const row = this.stmt('SELECT id FROM entries WHERE world_slug = ? AND relative_path = ?').get(
      worldSlug,
      relativePath
    ) as { id: string } | undefined;
    if (!row) return null;
    this.removeEntry(worldSlug, row.id);
    return row.id;
  }

  /** Fast id → file lookup so the store doesn't parse every file to find one entry. */
  getEntryRelativePath(worldSlug: string, entryId: string): string | null {
    const row = this.stmt('SELECT relative_path FROM entries WHERE world_slug = ? AND id = ?').get(
      worldSlug,
      entryId
    ) as { relative_path: string } | undefined;
    return row?.relative_path ?? null;
  }

  getDuplicateIdConflicts(worldSlug: string): DuplicateIdConflict[] {
    return this.duplicateIds.get(worldSlug) ?? [];
  }

  queryCollection(query: CollectionQuery): EntrySummary[] {
    const clauses: string[] = ['world_slug = ?'];
    const params: Array<string> = [query.worldSlug];

    if (query.type && query.type !== 'all') {
      clauses.push("(type = ? OR secondary_types_json LIKE ? ESCAPE '\\')");
      params.push(query.type, `%"${escapeLike(query.type)}"%`);
    }

    if (query.search && query.search.trim()) {
      const fts = toFtsQuery(query.search);
      const like = `%${escapeLike(query.search.trim())}%`;
      if (fts) {
        clauses.push(
          `(title LIKE ? ESCAPE '\\' OR id IN (SELECT entry_id FROM entries_fts WHERE entries_fts MATCH ? AND world_slug = ?))`
        );
        params.push(like, fts, query.worldSlug);
      } else {
        clauses.push("title LIKE ? ESCAPE '\\'");
        params.push(like);
      }
    }

    if (query.tag && query.tag.trim()) {
      clauses.push("tags_json LIKE ? ESCAPE '\\'");
      params.push(`%"${escapeLike(query.tag.trim())}"%`);
    }

    const orderCol = query.sortBy === 'title' ? 'title COLLATE NOCASE' : 'updated_at';
    const orderDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM entries WHERE ${clauses.join(' AND ')} ORDER BY ${orderCol} ${orderDir}`)
      .all(...params) as unknown as EntryRow[];
    return rows.map((row) => this.rowToSummary(row));
  }

  /** Keys a [[wikilink]] can use to reach this entry: title, file slug and aliases. */
  private linkKeysFor(worldSlug: string, entryId: string): string[] | null {
    const target = this.stmt('SELECT title, slug, aliases_json FROM entries WHERE world_slug = ? AND id = ?').get(
      worldSlug,
      entryId
    ) as { title: string; slug: string; aliases_json: string } | undefined;
    if (!target) return null;
    const aliases = safeJson<string[]>(target.aliases_json, []);
    return Array.from(new Set([target.title, target.slug, ...aliases].map((k) => k.toLowerCase())));
  }

  getBacklinks(worldSlug: string, entryId: string): BacklinkRef[] {
    const keys = this.linkKeysFor(worldSlug, entryId);
    if (!keys) return [];
    return this.db
      .prepare(
        `SELECT DISTINCT e.id as sourceId, e.title as sourceTitle, e.type as sourceType, l.context as context
         FROM links l
         JOIN entries e ON e.world_slug = l.world_slug AND e.id = l.source_id
         WHERE l.world_slug = ?
           AND l.source_id != ?
           AND l.target_key IN (${keys.map(() => '?').join(', ')})`
      )
      .all(worldSlug, entryId, ...keys) as unknown as BacklinkRef[];
  }

  /** Entries whose body links to this entry by any of its keys (used to rewrite links on rename). */
  getLinkingEntryIds(worldSlug: string, entryId: string): string[] {
    return Array.from(new Set(this.getBacklinks(worldSlug, entryId).map((b) => b.sourceId)));
  }

  getWorldGraph(worldSlug: string): WorldGraph {
    const entryRows = this.stmt(
      'SELECT id, title, slug, type, relationships_json, aliases_json FROM entries WHERE world_slug = ?'
    ).all(worldSlug) as Array<{
      id: string;
      title: string;
      slug: string;
      type: string;
      relationships_json: string;
      aliases_json: string;
    }>;

    const idSet = new Set(entryRows.map((r) => r.id));
    const idByKey = new Map<string, string>();
    for (const row of entryRows) {
      for (const alias of safeJson<string[]>(row.aliases_json, [])) {
        if (!idByKey.has(alias.toLowerCase())) idByKey.set(alias.toLowerCase(), row.id);
      }
    }
    for (const row of entryRows) {
      idByKey.set(row.slug.toLowerCase(), row.id);
      idByKey.set(row.title.toLowerCase(), row.id);
    }

    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];
    const degree = new Map<string, number>();
    const addEdge = (sourceId: string, targetId: string, label?: string) => {
      const pairKey = sourceId < targetId ? `${sourceId}::${targetId}` : `${targetId}::${sourceId}`;
      if (edgeSet.has(pairKey)) return;
      edgeSet.add(pairKey);
      edges.push({ sourceId, targetId, label });
      degree.set(sourceId, (degree.get(sourceId) ?? 0) + 1);
      degree.set(targetId, (degree.get(targetId) ?? 0) + 1);
    };

    // 1. Typed Relationships first (labeled edges)
    for (const row of entryRows) {
      for (const rel of safeJson<Array<{ targetId: string; label?: string }>>(row.relationships_json, [])) {
        if (!rel.targetId || rel.targetId === row.id || !idSet.has(rel.targetId)) continue;
        addEdge(row.id, rel.targetId, rel.label || undefined);
      }
    }

    // 2. Wikilink edges (unlabeled)
    const linkRows = this.stmt('SELECT source_id, target_key FROM links WHERE world_slug = ?').all(worldSlug) as Array<{
      source_id: string;
      target_key: string;
    }>;
    for (const link of linkRows) {
      const targetId = idByKey.get(link.target_key);
      if (!targetId || targetId === link.source_id) continue;
      addEdge(link.source_id, targetId);
    }

    const nodes: GraphNode[] = entryRows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      connectionCount: degree.get(row.id) ?? 0,
    }));

    return { nodes, edges };
  }

  getEntriesLinkingAsset(worldSlug: string, assetId: string, assetFilename: string): EntrySummary[] {
    const rows = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}
         FROM entries
         WHERE world_slug = ?
           AND (cover_asset_id = ? OR portrait_asset_id = ? OR body LIKE ? ESCAPE '\\')`
      )
      .all(worldSlug, assetId, assetId, `%${escapeLike(assetFilename)}%`) as unknown as EntryRow[];
    return rows.map((row) => this.rowToSummary(row));
  }

  /** Global full-text search, ranked by BM25 with title (and aliases) weighted above tags and body. */
  searchGlobal(rawQuery: string, limit = 25): SearchHit[] {
    const fts = toFtsQuery(rawQuery);
    if (!fts) return [];
    return this.db
      .prepare(
        `SELECT
           e.id as entryId,
           e.world_slug as worldSlug,
           COALESCE(w.name, e.world_slug) as worldName,
           e.title as title,
           e.type as type,
           snippet(entries_fts, 4, '[', ']', '…', 14) as snippet
         FROM entries_fts
         JOIN entries e ON e.id = entries_fts.entry_id AND e.world_slug = entries_fts.world_slug
         LEFT JOIN worlds w ON w.slug = e.world_slug
         WHERE entries_fts MATCH ?
         ORDER BY bm25(entries_fts, 0.0, 0.0, 10.0, 4.0, 1.0)
         LIMIT ?`
      )
      .all(fts, limit) as unknown as SearchHit[];
  }

  private rowToSummary(row: EntryRow): EntrySummary {
    return {
      id: row.id,
      worldSlug: row.world_slug,
      title: row.title,
      slug: row.slug,
      type: row.type,
      secondaryTypes: safeJson(row.secondary_types_json, []),
      relationships: safeJson(row.relationships_json, []),
      folder: row.folder,
      relativePath: row.relative_path,
      tags: safeJson(row.tags_json, []),
      properties: safeJson(row.properties_json, {}),
      coverAssetId: row.cover_asset_id ?? undefined,
      portraitAssetId: row.portrait_asset_id ?? undefined,
      updatedAt: row.updated_at,
      excerpt: row.excerpt,
    };
  }
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function findDuplicateIds(worldSlug: string, entries: Entry[]): DuplicateIdConflict[] {
  const byId = new Map<string, string[]>();
  for (const e of entries) {
    const list = byId.get(e.id) ?? [];
    list.push(e.relativePath);
    byId.set(e.id, list);
  }
  return Array.from(byId.entries())
    .filter(([, paths]) => paths.length > 1)
    .map(([id, relativePaths]) => ({ worldSlug, id, relativePaths: relativePaths.sort() }));
}
