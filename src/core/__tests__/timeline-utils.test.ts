import { describe, it, expect } from 'vitest';
import { extractChronologicalKey, groupEntriesForTimeline } from '../../shared/timeline-utils';
import type { EntrySummary } from '../../shared/types';

function makeEvent(id: string, title: string, properties: EntrySummary['properties']): EntrySummary {
  return {
    id,
    worldSlug: 'brimstone',
    title,
    slug: id,
    type: 'event',
    folder: 'events',
    relativePath: `events/${id}.md`,
    tags: [],
    properties,
    updatedAt: '2026-11-27T00:00:00.000Z',
    excerpt: `${title} summary`,
  };
}

describe('TimelineUtils', () => {
  it('parses negative, BCE, and positive in-world dates chronologically', () => {
    expect(extractChronologicalKey('400 BCE')).toBe(-400);
    expect(extractChronologicalKey('Year 125 AC')).toBe(125);
    expect(extractChronologicalKey('', 3)).toBe(3);
  });

  it('groups events by Era and orders chronologically within and across eras', () => {
    const events = [
      makeEvent('e3', 'Railways Open', { era: 'Industrial Age', date: 'Year 142' }),
      makeEvent('e1', 'The Fall', { era: 'Fallen Age', date: '300 BCE', impact: 'Epoch-Defining' }),
      makeEvent('e2', 'Reunification Pact', { era: 'Industrial Age', date: 'Year 80' }),
      makeEvent('e4', 'Undated Legend', {}),
    ];

    const groups = groupEntriesForTimeline(events);
    expect(groups.map((g) => g.era)).toEqual([
      'Fallen Age',
      'Industrial Age',
      'General Timeline',
    ]);
    expect(groups[1].items.map((i) => i.entry.title)).toEqual([
      'Reunification Pact',
      'Railways Open',
    ]);
  });
});
