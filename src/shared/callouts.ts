import { Lexer, type MarkedExtension, type Tokens } from 'marked';

/**
 * Callouts use Obsidian's syntax, so files stay readable and editable in Obsidian:
 *
 *   > [!canon] The Treaty of Ash
 *   > Signed in 3E 212 by…
 *
 * A `-` after the type makes it collapsible and closed by default (`> [!spoiler]- Ending`), `+`
 * collapsible and open. Unknown types (Obsidian's `info`, `warning`, …) are kept as written.
 */
export const CALLOUT_HEADER = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/;

export type CalloutFold = '' | '+' | '-';

export interface CalloutStyle {
  id: string;
  label: string;
  description: string;
}

/** Lore styles offered in the editor. Any other type still renders, styled as a note. */
export const LORE_CALLOUTS: CalloutStyle[] = [
  { id: 'note', label: 'Note', description: 'A highlighted aside' },
  { id: 'canon', label: 'Canon', description: 'Established, official lore' },
  { id: 'rumor', label: 'Rumor', description: 'Hearsay, in-world misinformation' },
  { id: 'secret', label: 'GM Secret', description: 'Hidden from players' },
  { id: 'spoiler', label: 'Spoiler', description: 'Collapsed until opened' },
];

export function calloutLabel(kind: string): string {
  const known = LORE_CALLOUTS.find((c) => c.id === kind.toLowerCase());
  if (known) return known.label;
  return kind.charAt(0).toUpperCase() + kind.slice(1).replace(/[-_]+/g, ' ');
}

export interface ParsedCallout {
  kind: string;
  fold: CalloutFold;
  title: string;
  /** Markdown inside the callout, without the header line */
  body: string;
}

/** Parses a blockquote's inner Markdown as a callout, or returns null if it isn't one. */
export function parseCallout(blockquoteText: string): ParsedCallout | null {
  const newline = blockquoteText.indexOf('\n');
  const first = (newline === -1 ? blockquoteText : blockquoteText.slice(0, newline)).trim();
  const m = CALLOUT_HEADER.exec(first);
  if (!m) return null;
  return {
    kind: m[1].toLowerCase(),
    fold: m[2] as CalloutFold,
    title: m[3].trim(),
    body: newline === -1 ? '' : blockquoteText.slice(newline + 1),
  };
}

/** Writes a callout back to Markdown. `bodyMarkdown` is already-converted inner Markdown. */
export function serializeCallout(kind: string, fold: CalloutFold, title: string, bodyMarkdown: string): string {
  const header = `> [!${kind || 'note'}]${fold}${title ? ` ${title}` : ''}`;
  const lines = bodyMarkdown.replace(/^\n+|\n+$/g, '').split('\n');
  const body = lines.length === 1 && lines[0] === '' ? [] : lines.map((l) => (l ? `> ${l}` : '>'));
  return [header, ...body].join('\n');
}

export function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * marked extension that renders callouts with `render(callout, bodyHtml)` instead of a plain
 * blockquote. Ordinary blockquotes are untouched.
 */
export function calloutMarkedExtension(render: (callout: ParsedCallout, bodyHtml: string) => string): MarkedExtension {
  return {
    renderer: {
      blockquote(token: Tokens.Blockquote) {
        const callout = parseCallout(token.text);
        if (!callout) return false;
        const bodyHtml = callout.body.trim() ? this.parser.parse(Lexer.lex(callout.body, this.options)) : '';
        return render(callout, bodyHtml);
      },
    },
  };
}
