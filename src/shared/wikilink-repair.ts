/**
 * Loreloom <= 0.6.5 saved wikilinks through Turndown's default escaping, writing
 * `[[Old_Town|x]]` to disk as `\[\[Old\_Town|x\]\]`, which broke backlinks, the graph and Obsidian.
 * This restores the original link syntax. Idempotent: clean Markdown is returned unchanged.
 */
export function repairEscapedWikilinks(markdown: string): string {
  if (!markdown.includes('\\[\\[')) return markdown;
  return markdown.replace(/\\\[\\\[([^\n]+?)\\\]\\\]/g, (_m, inner: string) => {
    const unescaped = inner.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1');
    return `[[${unescaped}]]`;
  });
}

/** Normalizes a Markdown body for equality checks (line endings, trailing whitespace). */
export function normalizeBodyForCompare(body: string): string {
  return body.replace(/\r\n/g, '\n').trim();
}
