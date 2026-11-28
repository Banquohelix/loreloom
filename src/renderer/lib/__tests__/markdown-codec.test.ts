import { describe, expect, it } from 'vitest';
import { editorHtmlToMarkdown, markdownToEditorHtml } from '../markdown-codec';

const PREFIX = 'loreloom-asset://brimstone/';
const resolve = (rel: string) => `${PREFIX}${rel.split('/').map(encodeURIComponent).join('/')}`;
const roundTrip = (md: string) => editorHtmlToMarkdown(markdownToEditorHtml(md, resolve), PREFIX);

describe('markdown codec round-trip', () => {
  it('never escapes wikilinks (including aliases and underscores)', () => {
    const md = 'See [[Iron Citadel]] and [[Old_Town|the old town]] or [[Kael#Backstory]].';
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps GFM task lists with checked state and nesting', () => {
    const md = '- [x] Draft the Ashen Pact\n- [ ] Name the moons\n    - [ ] Second moon';
    const html = markdownToEditorHtml(md, resolve);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(roundTrip(md)).toBe(md);
  });

  it('serializes TipTap-shaped task items', () => {
    const tiptapHtml =
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done</p></div></li>' +
      '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Todo [[Kael]]</p></div></li></ul>';
    expect(editorHtmlToMarkdown(tiptapHtml, PREFIX)).toBe('- [x] Done\n- [ ] Todo [[Kael]]');
  });

  it('keeps links, strikethrough, and deep headings', () => {
    const md = '#### Lineage\n\nRead [the codex](https://example.com/codex) — ~~retconned~~ lore.';
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps tables, including TipTap table markup', () => {
    const md = '| Name | Faction |\n| --- | --- |\n| Kael | Ash Wardens |';
    expect(roundTrip(md)).toBe(md);

    const tiptapHtml =
      '<table style="min-width: 50px"><colgroup><col><col></colgroup><tbody>' +
      '<tr><th colspan="1" rowspan="1"><p>Name</p></th><th colspan="1" rowspan="1"><p>Faction</p></th></tr>' +
      '<tr><td colspan="1" rowspan="1"><p>Kael</p></td><td colspan="1" rowspan="1"><p>Ash Wardens</p></td></tr>' +
      '</tbody></table>';
    expect(editorHtmlToMarkdown(tiptapHtml, PREFIX)).toBe(md);
  });

  it('rewrites asset images to portable relative paths', () => {
    const md = '![Map](assets/neon-ash-map.png)';
    const html = markdownToEditorHtml(md, resolve);
    expect(html).toContain(`${PREFIX}assets/neon-ash-map.png`);
    expect(roundTrip(md)).toBe(md);
  });

  it('encodes spaces and parentheses in image paths', () => {
    const html = `<img src="${PREFIX}assets/my%20file%20(1).png" alt="x">`;
    const md = editorHtmlToMarkdown(html, PREFIX);
    expect(md).toBe('![x](assets/my%20file%20%281%29.png)');
    expect(markdownToEditorHtml(md, resolve)).toContain(`${PREFIX}assets/my%20file%20(1).png`);
  });
});
