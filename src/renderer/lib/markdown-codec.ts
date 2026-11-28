import { Marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { calloutMarkedExtension, escapeHtmlAttr, serializeCallout, type CalloutFold } from '@shared/callouts';

/**
 * Lossless-as-possible bridge between on-disk Markdown (the source of truth, Obsidian-compatible)
 * and the TipTap editor's HTML. Every rule here exists because a round-trip used to lose content:
 *  - `[[wikilinks]]` must never be backslash-escaped
 *  - GFM task lists must load as TipTap taskList/taskItem nodes
 *  - tables, strikethrough and links must survive
 *  - Obsidian callouts (`> [!canon] Title`) load as callout blocks and save back unchanged
 */

const WIKILINK_SPLIT = /(!?\[\[[^[\]\n]+\]\])/;

const marked = new Marked({ gfm: true });
marked.use({
  renderer: {
    list(token) {
      if (!token.items.some((item) => item.task)) return false;
      let body = '';
      for (const item of token.items) {
        let inner = this.parser.parse(item.tokens, !!item.loose).trim();
        if (!/^<(p|ul|ol|pre|blockquote|h[1-6]|table)\b/i.test(inner)) {
          // Tight list items render inline text with no <p>; TaskItem expects `paragraph block*`.
          const blockStart = inner.search(/<(ul|ol|pre|blockquote|table)\b/i);
          inner =
            blockStart === -1
              ? `<p>${inner}</p>`
              : `<p>${inner.slice(0, blockStart).trim()}</p>${inner.slice(blockStart)}`;
        }
        const checked = item.task && item.checked ? 'true' : 'false';
        body += `<li data-type="taskItem" data-checked="${checked}">${inner}</li>\n`;
      }
      return `<ul data-type="taskList">\n${body}</ul>\n`;
    },
  },
});

// Callouts become TipTap callout nodes (see callout-extension.tsx)
marked.use(
  calloutMarkedExtension(
    (c, bodyHtml) =>
      `<div data-callout="${escapeHtmlAttr(c.kind)}" data-fold="${c.fold}" data-title="${escapeHtmlAttr(c.title)}">${
        bodyHtml || '<p></p>'
      }</div>\n`
  )
);

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  // Blank nodes skip the rules, so an empty callout would otherwise vanish on save
  blankReplacement: (_content, node) => {
    const el = node as HTMLElement;
    if (el.nodeName === 'DIV' && el.hasAttribute?.('data-callout')) return `\n\n${calloutMarkdown(el, '')}\n\n`;
    return (node as unknown as { isBlock?: boolean }).isBlock ? '\n\n' : '';
  },
});
turndown.use(gfm);

// `- item` / `1. item` like Obsidian and most editors (Turndown's default is `-   item`, which
// rewrote every list in a file on its first save). Task items have their own rule below.
turndown.addRule('compactListItem', {
  filter: 'li',
  replacement: (content, node) => {
    const parent = node.parentNode as HTMLElement | null;
    let prefix = '- ';
    if (parent?.nodeName === 'OL') {
      const start = Number(parent.getAttribute('start') || 1);
      prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
    }
    // TipTap wraps every item in <p>, so trailing blank lines are dropped (lists are written tight)
    const body = content
      .replace(/^\n+/, '')
      .replace(/\s+$/, '')
      .replace(/\n\n+(?=\s*(?:[-*+]|\d+\.) )/g, '\n') // nested list directly under the item text
      .replace(/\n/gm, `\n${' '.repeat(prefix.length)}`)
      .replace(/^ +$/gm, '');
    return prefix + body + (node.nextSibling ? '\n' : '');
  },
});

// Rules added later take precedence over plugin rules.
turndown.addRule('tiptapTaskItem', {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const checked = el.getAttribute('data-checked') === 'true';
    const body = content
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      .replace(/\n\n+(?=\s*- )/g, '\n') // nested list directly under the item text
      .replace(/\n/gm, '\n    ');
    return `- [${checked ? 'x' : ' '}] ${body}${el.nextSibling ? '\n' : ''}`;
  },
});

function calloutMarkdown(el: HTMLElement, content: string): string {
  const fold = (el.getAttribute('data-fold') || '') as CalloutFold;
  return serializeCallout(
    el.getAttribute('data-callout') || 'note',
    fold === '+' || fold === '-' ? fold : '',
    (el.getAttribute('data-title') || '').replace(/\s+/g, ' ').trim(),
    content
  );
}

turndown.addRule('callout', {
  filter: (node) => node.nodeName === 'DIV' && (node as HTMLElement).hasAttribute('data-callout'),
  replacement: (content, node) => `\n\n${calloutMarkdown(node as HTMLElement, content)}\n\n`,
});

turndown.addRule('strikethroughDouble', {
  filter: ['del', 's', 'strike'] as TurndownService.Filter,
  replacement: (content) => `~~${content}~~`,
});

let currentAssetUrlPrefix = '';
turndown.addRule('portableImage', {
  filter: 'img',
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const alt = (el.getAttribute('alt') || '').replace(/[[\]]/g, '');
    let src = el.getAttribute('src') || '';
    if (currentAssetUrlPrefix && src.startsWith(currentAssetUrlPrefix)) {
      src = src
        .slice(currentAssetUrlPrefix.length)
        .split('/')
        .map(safeDecode)
        .join('/');
    }
    return src ? `![${alt}](${encodeMarkdownPath(src)})` : '';
  },
});

// TipTap wraps table cell content in <p>; GFM table cells must stay on one line.
turndown.addRule('tableCellParagraph', {
  filter: (node) =>
    node.nodeName === 'P' &&
    !!node.parentNode &&
    (node.parentNode.nodeName === 'TD' || node.parentNode.nodeName === 'TH'),
  replacement: (content, node) => `${content.replace(/\n+/g, ' ')}${node.nextSibling ? ' ' : ''}`,
});

const baseEscape = turndown.escape.bind(turndown);
turndown.escape = (text: string) =>
  text
    .split(WIKILINK_SPLIT)
    .map((part, i) => (i % 2 === 1 ? part : baseEscape(part)))
    .join('');


function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

/** Encode characters that would break a Markdown link destination (spaces, parentheses). */
function encodeMarkdownPath(relPath: string): string {
  return relPath.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export function markdownToEditorHtml(md: string, resolveAssetUrl: (relativePath: string) => string): string {
  const withAssetUrls = md.replace(
    /!\[([^\]]*)\]\((assets\/[^)\s]+)\)/g,
    (_m, alt: string, rel: string) => `![${alt}](${resolveAssetUrl(safeDecode(rel))})`
  );
  return marked.parse(withAssetUrls, { async: false }) as string;
}

export function editorHtmlToMarkdown(html: string, assetUrlPrefix: string): string {
  // TipTap emits <colgroup> before <tbody>, which stops the GFM plugin detecting a header row.
  const cleaned = html.replace(/<colgroup>[\s\S]*?<\/colgroup>/g, '');
  currentAssetUrlPrefix = assetUrlPrefix;
  try {
    return turndown.turndown(cleaned);
  } finally {
    currentAssetUrlPrefix = '';
  }
}
