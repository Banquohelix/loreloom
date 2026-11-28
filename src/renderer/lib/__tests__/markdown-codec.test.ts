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

describe('callouts (Obsidian syntax)', () => {
  it('round-trips lore callouts, titles, folds and nested content', () => {
    const md = [
      '> [!canon] The Treaty of Ash',
      '> Signed in **3E 212** by [[Kael Vorn]].',
      '>',
      '> - Ceasefire',
      '> - Border at the [[Ash Sea]]',
      '',
      'Between callouts.',
      '',
      '> [!spoiler]- How it ends',
      '> Kael betrays the Citadel.',
      '',
      '> [!secret]+',
      '> The GM knows.',
    ].join('\n');
    const html = markdownToEditorHtml(md, resolve);
    expect(html).toContain('data-callout="canon"');
    expect(html).toContain('data-title="The Treaty of Ash"');
    expect(html).toContain('data-fold="-"');
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps unknown Obsidian callout types, empty callouts and nested callouts', () => {
    const md = ['> [!warning] Mind the gap', '> > [!rumor] Whispered', '> > Kael lives.', '', '> [!note]'].join('\n');
    expect(roundTrip(md)).toBe(md);
  });

  it('leaves ordinary blockquotes alone', () => {
    const md = '> Just a quote with [[Kael]].';
    expect(markdownToEditorHtml(md, resolve)).toContain('<blockquote>');
    expect(roundTrip(md)).toBe(md);
  });
});

describe('lists', () => {
  it('writes `- item` and `1. item` instead of rewriting lists with extra spaces', () => {
    const md = '- Ash\n- Ember\n    - Cinder\n\n1. First age\n2. Second age';
    expect(roundTrip('- Ash\n- Ember\n\n1. First age\n2. Second age')).toBe('- Ash\n- Ember\n\n1. First age\n2. Second age');
    expect(roundTrip(md)).toBe('- Ash\n- Ember\n  - Cinder\n\n1. First age\n2. Second age');
  });

  it('writes TipTap-shaped lists (<li><p>…</p></li>) tight, keeping multi-paragraph items', () => {
    const tiptap =
      '<ul><li><p>Ash</p></li><li><p>Ember</p><ul><li><p>Cinder</p></li></ul></li></ul>' +
      '<ol><li><p>First</p><p>More about the first age.</p></li><li><p>Second</p></li></ol>';
    expect(editorHtmlToMarkdown(tiptap, PREFIX)).toBe(
      '- Ash\n- Ember\n  - Cinder\n\n1. First\n   \n   More about the first age.\n2. Second'.replace('   \n', '\n')
    );
  });
});
