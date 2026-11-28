import { describe, it, expect } from 'vitest';
import {
  groupEntriesIntoColumns,
  pickDefaultBoardField,
} from '../../shared/board-utils';
import type { EntityTypeDef, EntrySummary } from '../../shared/types';

function makeEntry(id: string, title: string, properties: EntrySummary['properties']): EntrySummary {
  return {
    id,
    worldSlug: 'brimstone',
    title,
    slug: id,
    type: 'question',
    folder: 'Questions',
    relativePath: `Questions/${id}.md`,
    tags: [],
    properties,
    updatedAt: '2026-11-27T00:00:00.000Z',
    excerpt: `${title} excerpt`,
  };
}

describe('BoardUtils', () => {
  it('picks status field by default and groups entries into Kanban columns', () => {
    const questionType: EntityTypeDef = {
      id: 'question',
      name: 'Open Question',
      pluralName: 'Open Questions',
      icon: 'compass',
      color: '#0891b2',
      defaultView: 'board',
      fields: [
        { key: 'priority', label: 'Priority', fieldType: 'select', options: ['Low', 'High'] },
        { key: 'status', label: 'Status', fieldType: 'select', options: ['Open', 'In Progress', 'Decided'] },
      ],
    };

    const field = pickDefaultBoardField(questionType);
    expect(field.key).toBe('status');

    const cols = groupEntriesIntoColumns(
      [
        makeEntry('q1', 'What sleeps beneath Bellamare?', { status: 'Open' }),
        makeEntry('q2', 'When did railways open?', { status: 'Decided' }),
        makeEntry('q3', 'World origin', {}),
      ],
      field
    );

    expect(cols.map((c) => c.label)).toEqual(['Unassigned', 'Open', 'In Progress', 'Decided']);
    expect(cols[0].entries).toHaveLength(1);
    expect(cols[1].entries[0].id).toBe('q1');
    expect(cols[3].entries[0].id).toBe('q2');
  });
});
