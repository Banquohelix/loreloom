import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { z } from 'zod';
import type { WorkspaceStore } from './workspace-store';
import type { IndexEngine } from './index-engine';
import { NEEDS_TRIAGE_TAG } from '../shared/types';
import type { ArtAsset, ArtCategory, Entry, EntryPropertyValue, EntryRelationship, MapPin, WorldConfig } from '../shared/types';
import { TEMPLATE_TYPE_ID, applyTemplate, templatesForType } from '../shared/templates';

/**
 * Loreloom's MCP tools: what Claude, ChatGPT, Grok and other assistants can do in your Worlds.
 * Every write goes through the same WorkspaceStore paths as the editor (atomic saves, conflict
 * detection, OneDrive-safe retries) and is indexed straight away. There are no delete tools.
 */

export interface McpToolContext {
  store: WorkspaceStore;
  index: IndexEngine;
  /** Writes are refused when false (read-only mode). */
  allowWrites: boolean;
  /** Tag new AI-created entries `needs-triage` so they show up for review. */
  markDrafts: boolean;
  /** Name of the connected assistant, e.g. "claude-ai" (from the MCP handshake). */
  clientName?: string;
  /** Told about every write, so the app can refresh and show what changed. */
  onChange?: (change: McpChange) => void;
  /** Downloads an image for save_concept_art; injectable for tests. */
  fetchImage?: (url: string) => Promise<Buffer>;
}

export interface McpChange {
  worldSlug: string;
  kind: 'entry' | 'art' | 'map';
  action: string;
  title: string;
  client?: string;
}

export interface McpToolResult {
  text: string;
  data?: unknown;
  isError?: boolean;
}

export interface McpToolDef {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  input: z.ZodRawShape;
  run: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<McpToolResult>;
}

class ToolError extends Error {}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// Lookups

async function resolveWorld(ctx: McpToolContext, ref: unknown): Promise<WorldConfig> {
  const worlds = await ctx.store.listWorlds();
  const key = String(ref ?? '').trim().toLowerCase();
  if (!key && worlds.length === 1) return worlds[0];
  const found = worlds.find((w) => w.slug.toLowerCase() === key || w.name.toLowerCase() === key);
  if (!found) {
    throw new ToolError(
      `World not found: "${String(ref ?? '')}". Worlds: ${worlds.map((w) => `${w.name} (${w.slug})`).join(', ') || 'none'}.`
    );
  }
  return found;
}

async function resolveEntry(ctx: McpToolContext, world: WorldConfig, ref: unknown): Promise<Entry> {
  const key = String(ref ?? '').trim().replace(/^\[\[|\]\]$/g, '');
  if (!key) throw new ToolError('Give an entry id or title.');
  const byId = await ctx.store.readEntryById(world.slug, key);
  if (byId) return byId;
  const lower = key.toLowerCase();
  const match = ctx.index
    .queryCollection({ worldSlug: world.slug })
    .find((e) => e.title.toLowerCase() === lower || e.slug.toLowerCase() === lower);
  const entry = match ? await ctx.store.readEntryById(world.slug, match.id) : null;
  if (!entry) throw new ToolError(`Entry not found in ${world.name}: "${key}". Use search_lore to find it.`);
  return entry;
}

function resolveType(world: WorldConfig, ref: unknown) {
  const key = String(ref ?? 'page').trim().toLowerCase();
  const type = world.entityTypes.find(
    (t) => t.id.toLowerCase() === key || t.name.toLowerCase() === key || t.pluralName.toLowerCase() === key
  );
  if (!type) {
    throw new ToolError(`Unknown type "${String(ref)}". Types in ${world.name}: ${world.entityTypes.map((t) => t.id).join(', ')}.`);
  }
  return type;
}

function folderForType(typeId: string, pluralName: string): string {
  if (typeId === 'page') return 'lore';
  if (typeId === TEMPLATE_TYPE_ID) return 'templates';
  return (
    pluralName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'lore'
  );
}

function requireWrites(ctx: McpToolContext): void {
  if (!ctx.allowWrites) {
    throw new ToolError('Loreloom is in read-only mode for assistants. Ask the user to allow changes in Loreloom → AI Assistants.');
  }
}

function summarizeEntry(e: Entry, world: WorldConfig) {
  return {
    id: e.id,
    world: world.slug,
    title: e.title,
    type: e.type,
    tags: e.tags,
    path: e.relativePath,
    updatedAt: e.updatedAt,
  };
}

function cleanProperties(input: unknown): Record<string, EntryPropertyValue | null> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, EntryPropertyValue | null> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === null) out[k] = null;
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.map((x) => String(x));
  }
  return out;
}

function mergeProperties(
  base: Record<string, EntryPropertyValue>,
  patch: Record<string, EntryPropertyValue | null>
): Record<string, EntryPropertyValue> {
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Images

function sniffImage(buf: Buffer): { ext: string } | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: '.webp' };
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return { ext: '.gif' };
  return null;
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = address.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

/** Downloads an https image, refusing local-network addresses and anything over 25 MB. */
export async function fetchPublicImage(url: string): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ToolError('image_url is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') throw new ToolError('image_url must be an https:// link.');
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ToolError('image_url points to a local or private address, which is not allowed.');
  }
  const res = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new ToolError(`Could not download the image (HTTP ${res.status}).`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new ToolError('The image is larger than 25 MB.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new ToolError('The image is larger than 25 MB.');
  return buf;
}

function decodeBase64Image(input: string): Buffer {
  const raw = input.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 0) throw new ToolError('image_base64 is empty or not base64.');
  if (buf.length > MAX_IMAGE_BYTES) throw new ToolError('The image is larger than 25 MB.');
  return buf;
}

function safeImageName(title: string, ext: string): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'concept-art';
  return `${base}${ext}`;
}

// ---------------------------------------------------------------------------------------------
// Tools

const worldArg = z.string().optional().describe('World name or slug. Optional when the workspace has one World.');
const entryArg = z.string().describe('Entry id or exact title');
const ART_CATEGORIES = ['character', 'environment', 'prop', 'mood', 'map', 'other'] as const;

export const LORELOOM_TOOLS: McpToolDef[] = [
  {
    name: 'list_worlds',
    title: 'List Worlds',
    description: 'List the Worlds (story vaults) in this Loreloom workspace, with entry counts.',
    readOnly: true,
    input: {},
    run: async (ctx) => {
      const worlds = await ctx.store.listWorlds();
      const data = worlds.map((w) => ({
        slug: w.slug,
        name: w.name,
        subtitle: w.subtitle,
        medium: w.medium,
        entries: ctx.index.queryCollection({ worldSlug: w.slug }).length,
      }));
      return { text: data.map((w) => `${w.name} (${w.slug}): ${w.entries} entries`).join('\n') || 'No Worlds yet.', data };
    },
  },
  {
    name: 'get_world_schema',
    title: 'Get World schema',
    description:
      'Entity types (Character, Location, …) with their property fields and entry counts, plus available templates. Read this before creating entries so types and properties match.',
    readOnly: true,
    input: { world: worldArg },
    run: async (ctx, args) => {
      const world = await resolveWorld(ctx, args.world);
      const entries = ctx.index.queryCollection({ worldSlug: world.slug });
      const types = world.entityTypes.map((t) => ({
        id: t.id,
        name: t.name,
        pluralName: t.pluralName,
        entries: entries.filter((e) => e.type === t.id).length,
        fields: t.fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.fieldType,
          ...(f.options ? { options: f.options } : {}),
          ...(f.targetTypes ? { linksTo: f.targetTypes } : {}),
        })),
        templates: templatesForType(entries, t.id).map((tpl) => tpl.title),
      }));
      return {
        text: `${world.name}: ${types.length} types. Relation values are "[[Entry Title]]" strings; checkbox values are true/false.`,
        data: { world: world.slug, name: world.name, types },
      };
    },
  },
  {
    name: 'search_lore',
    title: 'Search lore',
    description: 'Full-text search over entry titles, aliases, tags and text. Returns ranked matches with snippets.',
    readOnly: true,
    input: {
      query: z.string().describe('Words to search for'),
      world: worldArg,
      limit: z.number().int().min(1).max(50).optional(),
    },
    run: async (ctx, args) => {
      const world = args.world ? await resolveWorld(ctx, args.world) : null;
      const hits = ctx.index
        .searchGlobal(String(args.query ?? ''), 50)
        .filter((h) => !world || h.worldSlug === world.slug)
        .slice(0, Number(args.limit ?? 15));
      return {
        text: hits.length ? hits.map((h) => `- ${h.title} [${h.type}] (${h.worldSlug}/${h.entryId}): ${h.snippet}`).join('\n') : 'No matches.',
        data: hits,
      };
    },
  },
  {
    name: 'list_entries',
    title: 'List entries',
    description: 'List entries in a World, optionally by type or tag, newest first.',
    readOnly: true,
    input: {
      world: worldArg,
      type: z.string().optional().describe('Type id, e.g. character'),
      tag: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    run: async (ctx, args) => {
      const world = await resolveWorld(ctx, args.world);
      const type = args.type ? resolveType(world, args.type).id : undefined;
      const all = ctx.index.queryCollection({ worldSlug: world.slug, type, tag: args.tag ? String(args.tag) : undefined });
      const offset = Number(args.offset ?? 0);
      const page = all.slice(offset, offset + Number(args.limit ?? 50));
      return {
        text: `${all.length} entries${type ? ` of type ${type}` : ''}.\n` + page.map((e) => `- ${e.title} [${e.type}] id=${e.id}`).join('\n'),
        data: { total: all.length, entries: page.map((e) => ({ id: e.id, title: e.title, type: e.type, tags: e.tags, excerpt: e.excerpt })) },
      };
    },
  },
  {
    name: 'read_entry',
    title: 'Read entry',
    description:
      'Read one entry: Markdown body, type, tags, properties, typed relationships and backlinks. Use its updatedAt as expected_updated_at when replacing the body.',
    readOnly: true,
    input: { entry: entryArg, world: worldArg },
    run: async (ctx, args) => {
      const world = await resolveWorld(ctx, args.world);
      const e = await resolveEntry(ctx, world, args.entry);
      const titles = new Map(ctx.index.queryCollection({ worldSlug: world.slug }).map((s) => [s.id, s.title]));
      const relationships = (e.relationships ?? []).map((r) => ({ label: r.label, target: titles.get(r.targetId) ?? r.targetId }));
      const backlinks = ctx.index.getBacklinks(world.slug, e.id).map((b) => ({ from: b.sourceTitle, context: b.context }));
      const data = { ...summarizeEntry(e, world), properties: e.properties, relationships, backlinks, body: e.body };
      return { text: `# ${e.title} [${e.type}]\n\n${e.body}`, data };
    },
  },
  {
    name: 'create_entry',
    title: 'Create entry',
    description:
      'Create a new lore entry (character, location, faction, …) with Markdown text, tags and properties. Use [[Entry Title]] to link entries, and Obsidian callouts like "> [!canon] Title" or "> [!secret] GM note". Optionally start from a template.',
    readOnly: false,
    input: {
      title: z.string().min(1),
      type: z.string().optional().describe('Type id or name (see get_world_schema). Default: page'),
      body: z.string().optional().describe('Markdown'),
      tags: z.array(z.string()).optional(),
      properties: z.record(z.string(), z.any()).optional().describe('Field key → value (see get_world_schema)'),
      template: z.string().optional().describe('Template title or id to start from'),
      world: worldArg,
    },
    run: async (ctx, args) => {
      requireWrites(ctx);
      const world = await resolveWorld(ctx, args.world);
      const type = resolveType(world, args.type);
      const title = String(args.title).trim();
      let fromTemplate: ReturnType<typeof applyTemplate> | null = null;
      if (args.template) {
        const tpl = await resolveEntry(ctx, world, args.template);
        fromTemplate = applyTemplate(tpl, { title, typeId: type.id, typeName: type.name });
      }
      const props = mergeProperties(fromTemplate?.properties ?? {}, cleanProperties(args.properties));
      const tags = Array.from(
        new Set([...(fromTemplate?.tags ?? []), ...((args.tags as string[] | undefined) ?? []), ...(ctx.markDrafts ? [NEEDS_TRIAGE_TAG] : [])])
      );
      const body = [fromTemplate?.body, args.body ? String(args.body) : ''].filter((b) => b && b.trim()).join('\n\n');
      const created = await ctx.store.createEntry({
        worldSlug: world.slug,
        title,
        type: type.id,
        folder: folderForType(type.id, type.pluralName),
        body,
        tags,
        properties: props,
        secondaryTypes: fromTemplate?.secondaryTypes,
      });
      ctx.index.upsertEntry(created);
      ctx.onChange?.({ worldSlug: world.slug, kind: 'entry', action: 'created', title: created.title, client: ctx.clientName });
      return { text: `Created "${created.title}" [${created.type}] id=${created.id}.`, data: summarizeEntry(created, world) };
    },
  },
  {
    name: 'update_entry',
    title: 'Update entry',
    description:
      'Change an entry. Prefer append (adds text at the end, optionally under a new heading). To replace the whole body, pass expected_updated_at from read_entry so a newer edit is never overwritten. properties are merged; set a key to null to remove it.',
    readOnly: false,
    input: {
      entry: entryArg,
      world: worldArg,
      title: z.string().optional(),
      append: z.string().optional().describe('Markdown to add at the end'),
      append_heading: z.string().optional().describe('Heading to put above the appended text'),
      body: z.string().optional().describe('Full replacement body (needs expected_updated_at)'),
      expected_updated_at: z.string().optional(),
      add_tags: z.array(z.string()).optional(),
      remove_tags: z.array(z.string()).optional(),
      properties: z.record(z.string(), z.any()).optional(),
    },
    run: async (ctx, args) => {
      requireWrites(ctx);
      const world = await resolveWorld(ctx, args.world);
      const current = await resolveEntry(ctx, world, args.entry);
      let body = current.body;
      if (args.body !== undefined) {
        if (!args.expected_updated_at) throw new ToolError('Replacing the body needs expected_updated_at (from read_entry). Or use append.');
        if (String(args.expected_updated_at) !== current.updatedAt) {
          throw new ToolError(`"${current.title}" changed since you read it (now ${current.updatedAt}). Read it again before replacing.`);
        }
        body = String(args.body);
      }
      if (args.append) {
        const heading = args.append_heading ? `## ${String(args.append_heading).trim()}\n\n` : '';
        body = `${body.replace(/\s+$/, '')}\n\n${heading}${String(args.append).trim()}\n`;
      }
      const removed = new Set(((args.remove_tags as string[] | undefined) ?? []).map((t) => t.toLowerCase()));
      const tags = Array.from(new Set([...current.tags.filter((t) => !removed.has(t.toLowerCase())), ...((args.add_tags as string[] | undefined) ?? [])]));
      const updated = await ctx.store.updateEntry({
        worldSlug: world.slug,
        id: current.id,
        baseBody: current.body,
        ...(args.title ? { title: String(args.title).trim() } : {}),
        ...(body !== current.body ? { body } : {}),
        tags,
        properties: mergeProperties(current.properties, cleanProperties(args.properties)),
      });
      ctx.index.upsertEntry(updated);
      ctx.onChange?.({ worldSlug: world.slug, kind: 'entry', action: 'updated', title: updated.title, client: ctx.clientName });
      const note = updated.conflictCopy
        ? ` It changed on another device at the same moment, so your version was saved as "${updated.conflictCopy.title}".`
        : '';
      return { text: `Updated "${updated.title}".${note}`, data: summarizeEntry(updated, world) };
    },
  },
  {
    name: 'add_relationship',
    title: 'Add relationship',
    description: 'Add a labelled relationship between two entries, e.g. Kael "Member of" Ashbound Order. Shown in the graph.',
    readOnly: false,
    input: {
      from: entryArg,
      to: entryArg,
      label: z.string().min(1).describe('e.g. Allied with, Located in, Member of, Rival of'),
      world: worldArg,
    },
    run: async (ctx, args) => {
      requireWrites(ctx);
      const world = await resolveWorld(ctx, args.world);
      const from = await resolveEntry(ctx, world, args.from);
      const to = await resolveEntry(ctx, world, args.to);
      const label = String(args.label).trim();
      const exists = (from.relationships ?? []).some((r) => r.targetId === to.id && r.label.toLowerCase() === label.toLowerCase());
      if (exists) return { text: `"${from.title}" already has "${label}" → "${to.title}".` };
      const relationships: EntryRelationship[] = [...(from.relationships ?? []), { id: crypto.randomUUID(), targetId: to.id, label }];
      const updated = await ctx.store.updateEntry({ worldSlug: world.slug, id: from.id, relationships });
      ctx.index.upsertEntry(updated);
      ctx.onChange?.({ worldSlug: world.slug, kind: 'entry', action: 'linked', title: `${from.title} → ${to.title}`, client: ctx.clientName });
      return { text: `Added "${from.title}" ${label} "${to.title}".` };
    },
  },
  {
    name: 'list_concept_art',
    title: 'List concept art',
    description: 'List concept art in a World (id, title, category, tags, caption).',
    readOnly: true,
    input: { world: worldArg, search: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    run: async (ctx, args) => {
      const world = await resolveWorld(ctx, args.world);
      const q = String(args.search ?? '').toLowerCase();
      const assets = (await ctx.store.listArtAssets(world.slug))
        .filter((a) => !q || `${a.title} ${a.caption} ${a.tags.join(' ')}`.toLowerCase().includes(q))
        .slice(0, Number(args.limit ?? 50));
      const data = assets.map((a) => ({ id: a.id, title: a.title, category: a.category, tags: a.tags, caption: a.caption, file: a.relativePath }));
      return { text: data.map((a) => `- ${a.title} [${a.category}] id=${a.id}`).join('\n') || 'No concept art yet.', data };
    },
  },
  {
    name: 'save_concept_art',
    title: 'Save concept art',
    description:
      "Save an image (e.g. one you generated) into the World's concept art gallery with a title, caption and tags. Pass image_base64 (or a data: URL) or a public https image_url. Optionally attach it to an entry as its cover, portrait, or inline image.",
    readOnly: false,
    input: {
      title: z.string().min(1),
      image_base64: z.string().optional(),
      image_url: z.string().optional(),
      caption: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.enum(ART_CATEGORIES).optional(),
      attach_to_entry: z.string().optional().describe('Entry id or title'),
      attach_as: z.enum(['cover', 'portrait', 'inline']).optional(),
      world: worldArg,
    },
    run: async (ctx, args) => {
      requireWrites(ctx);
      const world = await resolveWorld(ctx, args.world);
      let buf: Buffer;
      if (args.image_base64) buf = decodeBase64Image(String(args.image_base64));
      else if (args.image_url) buf = await (ctx.fetchImage ?? fetchPublicImage)(String(args.image_url));
      else throw new ToolError('Pass image_base64 or image_url.');
      const kind = sniffImage(buf);
      if (!kind) throw new ToolError('That is not a PNG, JPEG, WebP or GIF image.');
      const title = String(args.title).trim();
      const saved = await ctx.store.saveArtAssetFromBuffer(world.slug, safeImageName(title, kind.ext), buf, (args.category as ArtCategory) ?? 'other');
      const tags = Array.from(new Set([...((args.tags as string[] | undefined) ?? []), ...(ctx.markDrafts ? [NEEDS_TRIAGE_TAG] : [])]));
      const asset: ArtAsset = await ctx.store.updateArtAsset(world.slug, saved.id, {
        title,
        caption: args.caption ? String(args.caption) : '',
        tags,
      });
      let attached = '';
      if (args.attach_to_entry) {
        const entry = await resolveEntry(ctx, world, args.attach_to_entry);
        const as = String(args.attach_as ?? 'inline');
        const patch =
          as === 'cover'
            ? { coverAssetId: asset.id }
            : as === 'portrait'
              ? { portraitAssetId: asset.id }
              : {
                  body: `${entry.body.replace(/\s+$/, '')}\n\n![${title.replace(/[[\]]/g, '')}](${asset.relativePath.replace(/ /g, '%20')})\n`,
                  baseBody: entry.body,
                };
        const updated = await ctx.store.updateEntry({ worldSlug: world.slug, id: entry.id, ...patch });
        ctx.index.upsertEntry(updated);
        attached = ` Attached to "${entry.title}" as ${as}.`;
      }
      ctx.onChange?.({ worldSlug: world.slug, kind: 'art', action: 'saved', title, client: ctx.clientName });
      return { text: `Saved concept art "${title}" id=${asset.id}.${attached}`, data: { id: asset.id, file: asset.relativePath } };
    },
  },
  {
    name: 'list_maps',
    title: 'List maps',
    description: 'List interactive maps in a World with their pins.',
    readOnly: true,
    input: { world: worldArg },
    run: async (ctx, args) => {
      const world = await resolveWorld(ctx, args.world);
      const maps = await ctx.store.listMaps(world.slug);
      const data = maps.map((m) => ({ id: m.id, title: m.title, artId: m.assetId, pins: m.pins.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y, entryId: p.entryId })) }));
      return { text: data.map((m) => `- ${m.title} id=${m.id} (${m.pins.length} pins)`).join('\n') || 'No maps yet.', data };
    },
  },
  {
    name: 'create_map',
    title: 'Create map',
    description: 'Create an interactive map from a concept art image already in the gallery (see save_concept_art / list_concept_art).',
    readOnly: false,
    input: { title: z.string().min(1), art: z.string().describe('Concept art id or title'), world: worldArg },
    run: async (ctx, args) => {
      requireWrites(ctx);
      const world = await resolveWorld(ctx, args.world);
      const key = String(args.art).toLowerCase();
      const art = (await ctx.store.listArtAssets(world.slug)).find((a) => a.id === args.art || a.title.toLowerCase() === key || a.filename.toLowerCase() === key);
      if (!art) throw new ToolError(`Concept art not found: "${String(args.art)}".`);
      const map = await ctx.store.createMap(world.slug, String(args.title), art.id);
      ctx.onChange?.({ worldSlug: world.slug, kind: 'map', action: 'created', title: map.title, client: ctx.clientName });
      return { text: `Created map "${map.title}" id=${map.id}.`, data: { id: map.id } };
    },
  },
  {
    name: 'add_map_pin',
    title: 'Add map pin',
    description: 'Place a pin on a map. x and y are percentages (0–100) of the image width and height from the top-left. Optionally link the pin to an entry.',
    readOnly: false,
    input: {
      map: z.string().describe('Map id or title'),
      x: z.number().min(0).max(100),
      y: z.number().min(0).max(100),
      label: z.string().min(1),
      entry: z.string().optional().describe('Entry id or title to link'),
      note: z.string().optional(),
      color: z.string().optional().describe('CSS colour, e.g. #c2410c'),
      world: worldArg,
    },
    run: async (ctx, args) => {
      requireWrites(ctx);
      const world = await resolveWorld(ctx, args.world);
      const key = String(args.map).toLowerCase();
      const map = (await ctx.store.listMaps(world.slug)).find((m) => m.id === args.map || m.title.toLowerCase() === key);
      if (!map) throw new ToolError(`Map not found: "${String(args.map)}".`);
      const entry = args.entry ? await resolveEntry(ctx, world, args.entry) : null;
      const pin: MapPin = {
        id: crypto.randomUUID(),
        x: Number(args.x),
        y: Number(args.y),
        label: String(args.label),
        color: /^#[0-9a-f]{3,8}$/i.test(String(args.color ?? '')) ? String(args.color) : '#c2410c',
        ...(entry ? { entryId: entry.id } : {}),
        ...(args.note ? { note: String(args.note) } : {}),
      };
      await ctx.store.updateMap(world.slug, map.id, { pins: [...map.pins, pin] });
      ctx.onChange?.({ worldSlug: world.slug, kind: 'map', action: 'pinned', title: `${pin.label} on ${map.title}`, client: ctx.clientName });
      return { text: `Pinned "${pin.label}" on "${map.title}"${entry ? ` (linked to ${entry.title})` : ''}.` };
    },
  },
];

/** Runs a tool, turning expected problems into readable errors for the assistant. */
export async function runLoreloomTool(ctx: McpToolContext, name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const tool = LORELOOM_TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool: ${name}`, isError: true };
  try {
    return await tool.run(ctx, args ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: err instanceof ToolError ? message : `Loreloom error: ${message}`, isError: true };
  }
}
