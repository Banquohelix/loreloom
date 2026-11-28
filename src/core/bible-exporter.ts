import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { calloutLabel, calloutMarkedExtension } from '../shared/callouts';
import { formatPropertyValue, parseLinkValue } from '../shared/entity-type-utils';
import { resolveWorldTokens } from './theme-engine';
import type { WorkspaceStore } from './workspace-store';
import type {
  Entry,
  ExportWorldBibleOptions,
  WorldConfig,
} from '../shared/types';

/** Callouts render as styled asides; collapsible ones as <details open> so printed PDFs show them. */
const bibleMarked = new Marked({ gfm: true });
bibleMarked.use(
  calloutMarkedExtension((c, bodyHtml) => {
    const style = ['note', 'canon', 'rumor', 'secret', 'spoiler'].includes(c.kind) ? c.kind : 'note';
    const label = escapeHtml(calloutLabel(c.kind));
    const heading = c.title ? `${label}: ${escapeHtml(c.title)}` : label;
    if (c.fold) {
      return `<details class="callout callout-${style}" open><summary class="callout-title">${heading}</summary>${bodyHtml}</details>
`;
    }
    return `<aside class="callout callout-${style}"><div class="callout-title">${heading}</div>${bodyHtml}</aside>
`;
  })
);

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeAssetRel(rel: string): string {
  try {
    return decodeURIComponent(rel);
  } catch {
    return rel;
  }
}

function mimeFromExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.avif') return 'image/avif';
  return 'image/png';
}

/**
 * Turns an image file into a data URI no larger than `maxDimension` px on its longest side.
 * The Electron main process supplies a real resizer (nativeImage); the default embeds the
 * original bytes (used by tests and when no resizer is available).
 */
export type ImageEncoder = (absPath: string, maxDimension: number) => Promise<string | null>;

const embedOriginal: ImageEncoder = async (absPath) => {
  const buf = await fs.readFile(absPath);
  return `data:${mimeFromExt(absPath)};base64,${buf.toString('base64')}`;
};

/** Longest-side pixel caps per use: full-size AI art made exports exceed V8's max string length. */
export const BIBLE_IMAGE_SIZES = { cover: 1600, inline: 1600, gallery: 900, portrait: 320 } as const;
type ImageUse = keyof typeof BIBLE_IMAGE_SIZES;

export interface RenderedWorldBible {
  html: string;
  entryCount: number;
  artCount: number;
}

export interface WorldBibleCounts {
  entryCount: number;
  artCount: number;
}

type Emit = (chunk: string) => Promise<void> | void;

/**
 * Renders a self-contained, World-themed, print-ready HTML World Bible with
 * embedded base64 concept art, clickable internal [[wikilink]] anchors,
 * structured property cards, and a searchable Table of Contents.
 */
export async function buildWorldBibleHtml(
  store: WorkspaceStore,
  world: WorldConfig,
  options: Omit<ExportWorldBibleOptions, 'format'>,
  encodeImage: ImageEncoder = embedOriginal
): Promise<RenderedWorldBible> {
  const chunks: string[] = [];
  const counts = await renderWorldBible(store, world, options, (c) => void chunks.push(c), encodeImage);
  return { html: chunks.join(''), ...counts };
}

/**
 * Streams the World Bible straight to a file, one entry at a time, so large Worlds never build
 * a single giant string in memory.
 */
export async function writeWorldBibleHtmlFile(
  store: WorkspaceStore,
  world: WorldConfig,
  options: Omit<ExportWorldBibleOptions, 'format'>,
  outPath: string,
  encodeImage: ImageEncoder = embedOriginal
): Promise<WorldBibleCounts> {
  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  const streamError = new Promise<never>((_, reject) => stream.once('error', reject));
  const emit: Emit = (chunk) =>
    new Promise<void>((resolve, reject) => {
      stream.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
  try {
    const counts = await Promise.race([
      renderWorldBible(store, world, options, emit, encodeImage),
      streamError,
    ]);
    await new Promise<void>((resolve, reject) => stream.end((err?: Error | null) => (err ? reject(err) : resolve())));
    return counts;
  } catch (err) {
    stream.destroy();
    throw err;
  }
}

async function renderWorldBible(
  store: WorkspaceStore,
  world: WorldConfig,
  options: Omit<ExportWorldBibleOptions, 'format'>,
  emit: Emit,
  encodeImage: ImageEncoder
): Promise<WorldBibleCounts> {
  const [allEntries, allAssets] = await Promise.all([
    store.listAllEntriesInWorld(world.slug),
    store.listArtAssets(world.slug),
  ]);

  const includedSet = new Set(options.includedTypeIds);
  const includedEntries = allEntries.filter(
    (e) => includedSet.has(e.type) || (e.secondaryTypes ?? []).some((s) => includedSet.has(s))
  );

  // Images are encoded lazily, resized per use, and only the current entry's are held in memory
  const assetById = new Map(allAssets.map((a) => [a.id, a]));
  const assetByRel = new Map(
    allAssets.map((a) => [decodeAssetRel(a.relativePath).toLowerCase(), a])
  );
  const imageUri = async (assetId: string | undefined, use: ImageUse): Promise<string | undefined> => {
    const asset = assetId ? assetById.get(assetId) : undefined;
    if (!asset || asset.missing) return undefined;
    try {
      const abs = store.resolveAssetAbsolutePath(world.slug, asset.relativePath);
      return (await encodeImage(abs, BIBLE_IMAGE_SIZES[use])) ?? undefined;
    } catch {
      return undefined;
    }
  };

  // Anchor lookup for [[wikilinks]]
  const anchorByKey = new Map<string, string>();
  for (const e of includedEntries) {
    anchorByKey.set(e.title.toLowerCase(), `entry-${e.id}`);
    anchorByKey.set(e.slug.toLowerCase(), `entry-${e.id}`);
  }

  const renderMarkdown = async (md: string): Promise<string> => {
    // Embed inline assets as (resized) data URIs
    const inlineUris = new Map<string, string>();
    for (const m of md.matchAll(/!\[[^\]]*\]\((assets\/[^)\s]+)\)/g)) {
      const key = decodeAssetRel(m[1]).toLowerCase();
      if (inlineUris.has(key)) continue;
      const uri = await imageUri(assetByRel.get(key)?.id, 'inline');
      if (uri) inlineUris.set(key, uri);
    }
    let processed = md.replace(
      /!\[([^\]]*)\]\((assets\/[^)\s]+)\)/g,
      (_full, alt: string, rel: string) => {
        const uri = inlineUris.get(decodeAssetRel(rel).toLowerCase());
        return uri ? `![${alt}](${uri})` : '';
      }
    );
    // Turn [[wikilinks]] into internal HTML anchor links
    processed = processed.replace(
      /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
      (_full, rawTarget: string, alias?: string) => {
        const label = (alias || rawTarget).trim();
        const anchor = anchorByKey.get(rawTarget.trim().toLowerCase());
        if (anchor) {
          return `[${label}](#${anchor})`;
        }
        return `**${label}**`;
      }
    );
    return bibleMarked.parse(processed, { async: false }) as string;
  };

  const galleryAssets = allAssets.filter((a) => !a.missing);
  const tokens = resolveWorldTokens(world.theme, options.appearance);
  const isDark = options.appearance === 'dark';

  // Group entries by EntityType in the World's defined order
  const sections: Array<{ id: string; title: string; color: string; entries: Entry[] }> = [];
  for (const et of world.entityTypes) {
    if (!includedSet.has(et.id)) continue;
    const matched = includedEntries
      .filter((e) => e.type === et.id || (e.secondaryTypes ?? []).includes(et.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    if (matched.length === 0) continue;
    sections.push({ id: et.id, title: et.pluralName, color: et.color, entries: matched });
  }

  const tocHtml = sections
    .map(
      (sec) => `
      <div class="toc-group">
        <a class="toc-section" href="#section-${escapeHtml(sec.id)}">${escapeHtml(sec.title)} <span>(${sec.entries.length})</span></a>
        <div class="toc-items">
          ${sec.entries
            .map(
              (e) =>
                `<a class="toc-link" href="#entry-${escapeHtml(e.id)}">${escapeHtml(e.title)}</a>`
            )
            .join('')}
        </div>
      </div>`
    )
    .join('');

  const head = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(world.name)} — World Bible</title>
  <style>
    :root {
      --accent: ${tokens['--world-accent']};
      --accent-soft: ${tokens['--world-accent-soft']};
      --bg: ${tokens['--world-canvas-bg']};
      --muted-bg: ${tokens['--world-canvas-muted']};
      --border: ${tokens['--world-canvas-border']};
      --text: ${isDark ? '#f4f4f5' : '#18181b'};
      --muted: ${isDark ? '#a1a1aa' : '#64748b'};
      --heading-font: ${tokens['--world-heading-font']};
      --body-font: ${tokens['--world-body-font']};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--body-font);
      line-height: 1.7;
    }
    .layout { display: flex; min-height: 100vh; }
    .sidebar {
      width: 280px;
      flex-shrink: 0;
      border-right: 1px solid var(--border);
      background: var(--muted-bg);
      padding: 24px 18px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    .sidebar h1 { font-family: var(--heading-font); font-size: 1.35rem; margin: 0 0 4px; }
    .sidebar .sub { font-size: 0.78rem; color: var(--muted); margin-bottom: 16px; }
    .toc-group { margin-bottom: 14px; }
    .toc-section { display: block; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); text-decoration: none; margin-bottom: 4px; }
    .toc-section span { color: var(--muted); font-weight: 400; }
    .toc-items { display: flex; flex-direction: column; gap: 2px; padding-left: 8px; }
    .toc-link { font-size: 0.82rem; color: var(--text); opacity: 0.8; text-decoration: none; padding: 2px 0; }
    .toc-link:hover { opacity: 1; color: var(--accent); }
    .content { flex: 1; max-width: 900px; margin: 0 auto; padding: 48px 40px 80px; }
    .hero { border-bottom: 2px solid var(--border); padding-bottom: 28px; margin-bottom: 42px; }
    .hero .medium { display: inline-block; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); margin-bottom: 12px; }
    .hero h1 { font-family: var(--heading-font); font-size: 3rem; line-height: 1.1; margin: 0 0 10px; }
    .hero p { color: var(--muted); font-size: 1rem; margin: 0; }
    .collection-section { margin-bottom: 56px; }
    .section-heading { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 24px; }
    .section-heading .dot { width: 10px; height: 10px; border-radius: 50%; }
    .section-heading h2 { font-family: var(--heading-font); font-size: 2rem; margin: 0; }
    .entry-card { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; margin-bottom: 28px; background: var(--bg); break-inside: avoid; }
    .entry-cover { width: 100%; max-height: 280px; object-fit: cover; display: block; border-bottom: 1px solid var(--border); }
    .entry-inner { padding: 24px 28px; }
    .entry-header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
    .entry-portrait { width: 72px; height: 72px; border-radius: 14px; object-fit: cover; border: 1px solid var(--border); flex-shrink: 0; }
    .entry-badge { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
    .entry-header h3 { font-family: var(--heading-font); font-size: 1.85rem; margin: 2px 0 4px; line-height: 1.2; }
    .tag-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
    .prop-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; background: var(--muted-bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin: 0 0 18px; }
    .prop-grid dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .prop-grid dd { margin: 2px 0 0; font-size: 0.85rem; font-weight: 500; }
    .prose a { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); }
    .prose img { max-width: 100%; border-radius: 10px; border: 1px solid var(--border); margin: 12px 0; }
    .prose .callout { border: 1px solid var(--border); border-left: 3px solid var(--callout, var(--accent)); background: var(--muted-bg); margin: 14px 0; padding: 8px 16px 10px; border-radius: 0 8px 8px 0; break-inside: avoid; }
    .prose .callout-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--callout, var(--accent)); margin: 2px 0 4px; }
    .prose details.callout > summary { cursor: pointer; }
    .prose .callout-canon { --callout: #b8860b; }
    .prose .callout-rumor { --callout: #8b5cf6; font-style: italic; }
    .prose .callout-secret { --callout: #dc2626; }
    .prose .callout-spoiler { --callout: #64748b; }
    .prose blockquote { border-left: 3px solid var(--accent); background: var(--muted-bg); margin: 14px 0; padding: 10px 16px; border-radius: 0 8px 8px 0; font-style: italic; }
    .prose.dropcap > p:first-of-type::first-letter { font-family: var(--heading-font); float: left; font-size: 3.1rem; line-height: 0.85; padding-right: 8px; color: var(--accent); font-weight: 600; }
    .art-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px; }
    .art-card { margin: 0; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--muted-bg); break-inside: avoid; }
    .art-card img { width: 100%; height: 190px; object-fit: cover; display: block; }
    .art-card figcaption { padding: 10px 12px; font-size: 0.82rem; }
    .art-card figcaption span { display: block; font-size: 0.7rem; text-transform: uppercase; color: var(--muted); }
    .art-card figcaption p { margin: 4px 0 0; font-size: 0.78rem; color: var(--muted); }
    @media print {
      .sidebar { display: none; }
      .content { max-width: 100%; padding: 0; }
      .collection-section { page-break-before: always; }
      .collection-section:first-of-type { page-break-before: auto; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav class="sidebar">
      <h1>${escapeHtml(world.name)}</h1>
      <div class="sub">World Bible · ${includedEntries.length} entries</div>
      ${tocHtml}
      ${options.includeArtGallery && galleryAssets.length > 0 ? `<div class="toc-group"><a class="toc-section" href="#section-art-gallery">Concept Art Gallery <span>(${galleryAssets.length})</span></a></div>` : ''}
    </nav>
    <main class="content">
      <header class="hero">
        <div class="medium">${escapeHtml(world.medium.replace('-', ' '))} World Bible</div>
        <h1>${escapeHtml(world.name)}</h1>
        ${world.subtitle ? `<p>${escapeHtml(world.subtitle)}</p>` : ''}
      </header>
`;
  await emit(head);

  for (const sec of sections) {
    await emit(`
      <section class="collection-section" id="section-${escapeHtml(sec.id)}">
        <div class="section-heading">
          <span class="dot" style="background:${escapeHtml(sec.color)}"></span>
          <h2>${escapeHtml(sec.title)}</h2>
        </div>`);
    for (const entry of sec.entries) {
      const [coverUri, portraitUri, bodyHtml] = await Promise.all([
        imageUri(entry.coverAssetId, 'cover'),
        imageUri(entry.portraitAssetId, 'portrait'),
        renderMarkdown(entry.body),
      ]);
      const typeDef = world.entityTypes.find((t) => t.id === entry.type);
      // Label, and HTML value: relation links become anchors, checkboxes "Yes", empty values are skipped
      const propPairs = Object.entries(entry.properties)
        .map(([k, v]) => {
          const field = typeDef?.fields.find((f) => f.key === k);
          const label = field?.label ?? k;
          if (field?.fieldType === 'checkbox') return formatPropertyValue(field, v) ? [label, 'Yes'] : null;
          const items = (Array.isArray(v) ? v : [v]).filter((x) => x !== undefined && x !== '');
          if (items.length === 0) return null;
          const html = items
            .map((item) => {
              if (typeof item === 'string' && item.includes('[[')) {
                const { target, label: text } = parseLinkValue(item);
                const anchor = anchorByKey.get(target.toLowerCase());
                return anchor ? `<a href="#${anchor}">${escapeHtml(text)}</a>` : escapeHtml(text);
              }
              return escapeHtml(formatPropertyValue(field, item as never) || String(item));
            })
            .join(', ');
          return [label, html];
        })
        .filter((p): p is [string, string] => p !== null);
      await emit(`
          <article class="entry-card" id="entry-${escapeHtml(entry.id)}">
            ${coverUri ? `<img class="entry-cover" src="${coverUri}" alt="${escapeHtml(entry.title)}" />` : ''}
            <div class="entry-inner">
              <div class="entry-header">
                ${portraitUri ? `<img class="entry-portrait" src="${portraitUri}" alt="${escapeHtml(entry.title)}" />` : ''}
                <div>
                  <div class="entry-badge" style="color:${escapeHtml(sec.color)}">${escapeHtml(sec.title)}</div>
                  <h3>${escapeHtml(entry.title)}</h3>
                  ${
                    entry.tags.length > 0
                      ? `<div class="tag-row">${entry.tags
                          .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
                          .join('')}</div>`
                      : ''
                  }
                </div>
              </div>
              ${
                propPairs.length > 0
                  ? `<dl class="prop-grid">${propPairs
                      .map(
                        ([label, html]) => `<div><dt>${escapeHtml(label)}</dt><dd>${html}</dd></div>`
                      )
                      .join('')}</dl>`
                  : ''
              }
              <div class="prose ${world.theme.editorialDropCap ? 'dropcap' : ''}">
                ${bodyHtml}
              </div>
            </div>
          </article>`);
    }
    await emit(`
      </section>`);
  }

  let galleryCount = 0;
  if (options.includeArtGallery && galleryAssets.length > 0) {
    await emit(`
      <section class="collection-section" id="section-art-gallery">
        <div class="section-heading">
          <span class="dot" style="background:${escapeHtml(tokens['--world-accent'])}"></span>
          <h2>Concept Art Gallery</h2>
        </div>
        <div class="art-grid">`);
    for (const a of galleryAssets) {
      const uri = await imageUri(a.id, 'gallery');
      if (!uri) continue;
      galleryCount++;
      await emit(`
              <figure class="art-card">
                <img src="${uri}" alt="${escapeHtml(a.title)}" />
                <figcaption>
                  <strong>${escapeHtml(a.title)}</strong>
                  <span>${escapeHtml(a.category)}</span>
                  ${a.caption ? `<p>${escapeHtml(a.caption)}</p>` : ''}
                </figcaption>
              </figure>`);
    }
    await emit(`
        </div>
      </section>`);
  }

  await emit(`
    </main>
  </div>
</body>
</html>`);

  return {
    entryCount: includedEntries.length,
    artCount: galleryCount,
  };
}
