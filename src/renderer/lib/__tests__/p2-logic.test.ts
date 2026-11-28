import { describe, it, expect, vi, afterEach } from 'vitest';
import { DebouncedSaver } from '../debounced-saver';
import { friendlyErrorMessage } from '../notify';
import { rankByQuery } from '../suggestion-menus';
import {
  coercePropertyInput,
  finalizeFields,
  readPropertyValue,
  uniqueTypeId,
} from '@shared/entity-type-utils';
import { groupEntriesIntoColumns } from '@shared/board-utils';
import type { EntityTypeDef, EntrySummary, PropertyFieldDef } from '@shared/types';

describe('DebouncedSaver', () => {
  afterEach(() => vi.useRealTimers());

  it('sends only the latest value after a pause, in order', async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const saver = new DebouncedSaver<string>(async (v) => {
      saved.push(v);
    }, 300);
    saver.schedule('K');
    saver.schedule('Ka');
    saver.schedule('Kael');
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(350);
    expect(saved).toEqual(['Kael']);
    saver.schedule('Kael V');
    await saver.flush();
    expect(saved).toEqual(['Kael', 'Kael V']);
  });

  it('reports errors without breaking later saves', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const saver = new DebouncedSaver<number>(
      async () => {
        if (fail) throw new Error('locked');
      },
      10,
      (e) => errors.push(e)
    );
    saver.schedule(1);
    await saver.flush();
    fail = false;
    saver.schedule(2);
    await saver.flush();
    expect(errors).toHaveLength(1);
  });
});

describe('friendlyErrorMessage', () => {
  it('strips Electron IPC wrapping', () => {
    expect(
      friendlyErrorMessage(new Error("Error invoking remote method 'entry:update': Error: Entry not found: kael"))
    ).toBe('Entry not found: kael');
    expect(friendlyErrorMessage('plain')).toBe('plain');
  });
});

describe('rankByQuery', () => {
  it('ranks prefix, then word-start, then substring, then keyword matches', () => {
    const items = ['Bullet List', 'Heading 1', 'Table', 'Checklist', 'Lore Callout / Quote'];
    expect(rankByQuery(items, 'li', (x) => x)).toEqual(['Bullet List', 'Checklist']);
    expect(rankByQuery(items, 'quo', (x) => x)).toEqual(['Lore Callout / Quote']);
    expect(rankByQuery(items, 'todo', (x) => x, (x) => (x === 'Checklist' ? ['todo'] : []))).toEqual(['Checklist']);
    expect(rankByQuery(items, '', (x) => x)).toEqual(items);
  });
});

describe('entity type utils', () => {
  it('never reuses an existing type id', () => {
    expect(uniqueTypeId('Character', ['character', 'location'])).toBe('character-2');
    expect(uniqueTypeId('Character', ['character', 'character-2'])).toBe('character-3');
    expect(uniqueTypeId('Starship', ['character'])).toBe('starship');
    expect(uniqueTypeId('魔法', [])).toBe('custom-type');
  });

  it('makes field keys unique and non-empty, keeping existing keys', () => {
    const fields = finalizeFields([
      { key: '', label: 'Hull Class', fieldType: 'text', optionsText: '' },
      { key: '', label: 'Hull class', fieldType: 'text', optionsText: '' },
      { key: '', label: '魔力', fieldType: 'number', optionsText: '' },
      { key: 'status', label: 'Current Status', fieldType: 'select', optionsText: 'Active, Lost, Active' },
      { key: '', label: '   ', fieldType: 'text', optionsText: '' },
    ]);
    expect(fields.map((f) => f.key)).toEqual(['hull_class', 'hull_class_2', 'field_3', 'status']);
    expect(fields[3].options).toEqual(['Active', 'Lost']);
  });

  it('saves numbers as numbers and multi-select as lists', () => {
    const num: PropertyFieldDef = { key: 'pop', label: 'Population', fieldType: 'number' };
    const multi: PropertyFieldDef = { key: 'tags', label: 'Allies', fieldType: 'multi-select', options: ['A', 'B'] };
    const text: PropertyFieldDef = { key: 'n', label: 'Name', fieldType: 'text' };
    expect(coercePropertyInput(num, ' 40000 ')).toBe(40000);
    expect(coercePropertyInput(num, 'about 40k')).toBe('about 40k');
    expect(coercePropertyInput(multi, 'A, B')).toEqual(['A', 'B']);
    expect(coercePropertyInput(multi, ['B'])).toEqual(['B']);
    expect(coercePropertyInput(text, '   ')).toBeUndefined();
    // Legacy comma-joined strings read back as lists
    expect(readPropertyValue(multi, 'A, B')).toEqual(['A', 'B']);
    expect(readPropertyValue(num, '12')).toBe(12);
  });
});

describe('kanban columns', () => {
  it('always includes an Unassigned column so cards can be moved back', () => {
    const type: EntityTypeDef = {
      id: 'question',
      name: 'Question',
      pluralName: 'Questions',
      icon: 'compass',
      color: '#000',
      defaultView: 'board',
      fields: [{ key: 'status', label: 'Status', fieldType: 'select', options: ['Open', 'Done'] }],
    };
    const entry = (id: string, status: string): EntrySummary => ({
      id,
      worldSlug: 'w',
      title: id,
      slug: id,
      type: 'question',
      folder: '',
      relativePath: `${id}.md`,
      tags: [],
      properties: { status },
      updatedAt: '2026-01-01T00:00:00.000Z',
      excerpt: '',
    });
    const columns = groupEntriesIntoColumns([entry('a', 'Open')], type.fields[0]);
    expect(columns[0]).toMatchObject({ value: '', label: 'Unassigned' });
    expect(columns[0].entries).toHaveLength(0);
  });
});
