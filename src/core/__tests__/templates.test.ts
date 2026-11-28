import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_TYPE_ID,
  applyTemplate,
  fillPlaceholders,
  isTemplate,
  templateFromEntry,
  templateTarget,
  templatesForType,
} from '../../shared/templates';
import type { EntrySummary } from '../../shared/types';

/** C7: entry templates. */
describe('entry templates', () => {
  const summary = (id: string, title: string, extra: Partial<EntrySummary> = {}): EntrySummary => ({
    id,
    worldSlug: 'w',
    title,
    slug: id,
    type: TEMPLATE_TYPE_ID,
    folder: 'templates',
    relativePath: `templates/${id}.md`,
    tags: [],
    properties: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
    excerpt: '',
    ...extra,
  });

  it('finds templates for a type: specific ones first, then ones for any type', () => {
    const entries = [
      summary('gen', 'Generic Page'),
      summary('npc', 'Brimstone NPC', { properties: { templateFor: 'character' } }),
      summary('boss', 'Act Boss', { properties: { templateFor: 'character' } }),
      summary('city', 'City', { properties: { templateFor: 'location' } }),
      summary('kael', 'Kael', { type: 'character' }),
      summary('also', 'Also a template', { type: 'page', secondaryTypes: [TEMPLATE_TYPE_ID] }),
    ];
    expect(templatesForType(entries, 'character').map((t) => t.id)).toEqual(['boss', 'npc', 'also', 'gen']);
    expect(templatesForType(entries, 'faction').map((t) => t.id)).toEqual(['also', 'gen']);
    expect(isTemplate(entries[4])).toBe(false);
    expect(templateTarget(entries[1])).toBe('character');
    expect(templateTarget({ properties: { templateFor: ['location'] } })).toBe('location');
  });

  it('fills {{title}}, {{date}} and {{type}} placeholders', () => {
    const date = new Date(2026, 10, 28);
    expect(fillPlaceholders('# {{title}}\nA {{ TYPE }} logged {{date}}. {{unknown}}', { title: 'Vessa', type: 'Character', date })).toBe(
      '# Vessa\nA Character logged 2026-11-28. {{unknown}}'
    );
  });

  it('copies body, tags and properties but not the template markers', () => {
    const result = applyTemplate(
      {
        body: '# {{title}}\n\n> [!secret] Motive\n> ',
        tags: ['npc', 'template'],
        properties: { templateFor: 'character', status: 'Alive', allies: ['[[Kael]]'] },
        secondaryTypes: [TEMPLATE_TYPE_ID, 'faction', 'character'],
      },
      { title: 'Vessa Thorn', typeId: 'character', typeName: 'Character', date: new Date(2026, 0, 2) }
    );
    expect(result).toEqual({
      body: '# Vessa Thorn\n\n> [!secret] Motive\n> ',
      tags: ['npc'],
      properties: { status: 'Alive', allies: ['[[Kael]]'] },
      secondaryTypes: ['faction'],
    });
  });

  it('saves an entry as a template for its type', () => {
    const t = templateFromEntry(
      { title: 'Kael', type: 'character', body: 'Stats', tags: ['npc'], properties: { status: 'Alive' }, secondaryTypes: [] },
      'Character'
    );
    expect(t).toEqual({
      title: 'Character Template',
      type: TEMPLATE_TYPE_ID,
      folder: 'templates',
      body: 'Stats',
      tags: ['npc'],
      properties: { status: 'Alive', templateFor: 'character' },
      secondaryTypes: [],
    });
  });
});
