import type { CreateEntryInput, Entry, EntityTypeDef, EntryPropertyValue, EntrySummary } from './types';

/**
 * Entry templates are ordinary entries in a "Templates" collection (type id `template`). A
 * template's optional `templateFor` property names the type it creates; without it, the template
 * is offered for every type. `{{title}}`, `{{date}}` and `{{type}}` in its body are filled in.
 */
export const TEMPLATE_TYPE_ID = 'template';
export const TEMPLATE_FOR_KEY = 'templateFor';

export const TEMPLATE_TYPE_DEF: EntityTypeDef = {
  id: TEMPLATE_TYPE_ID,
  name: 'Template',
  pluralName: 'Templates',
  icon: 'layers',
  color: '#64748b',
  defaultView: 'gallery',
  fields: [],
};

type TemplateLike = Pick<EntrySummary, 'id' | 'type' | 'secondaryTypes' | 'properties' | 'title'>;

export function isTemplate(entry: Pick<EntrySummary, 'type' | 'secondaryTypes'>): boolean {
  return entry.type === TEMPLATE_TYPE_ID || (entry.secondaryTypes ?? []).includes(TEMPLATE_TYPE_ID);
}

/** The type a template creates, or null if it's for any type. */
export function templateTarget(entry: Pick<EntrySummary, 'properties'>): string | null {
  const raw = entry.properties?.[TEMPLATE_FOR_KEY];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Templates offered when creating an entry of `typeId`: ones made for it first, then general ones. */
export function templatesForType<T extends TemplateLike>(entries: T[], typeId: string): T[] {
  const templates = entries.filter(isTemplate);
  const specific = templates.filter((t) => templateTarget(t) === typeId);
  const general = templates.filter((t) => templateTarget(t) === null);
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title);
  return [...specific.sort(byTitle), ...general.sort(byTitle)];
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Replaces `{{title}}`, `{{date}}` and `{{type}}` (case-insensitive, spaces allowed). */
export function fillPlaceholders(text: string, values: { title: string; type: string; date: Date }): string {
  return text.replace(/\{\{\s*(title|date|type)\s*\}\}/gi, (_m, key: string) => {
    switch (key.toLowerCase()) {
      case 'title':
        return values.title;
      case 'date':
        return isoDate(values.date);
      default:
        return values.type;
    }
  });
}

/**
 * What a new entry gets from a template: body (placeholders filled), tags, properties and extra
 * collections. The template's own markers (`template` type/tag, `templateFor`) are not copied.
 */
export function applyTemplate(
  template: Pick<Entry, 'body' | 'tags' | 'properties' | 'secondaryTypes'>,
  target: { title: string; typeId: string; typeName: string; date?: Date }
): Pick<CreateEntryInput, 'body' | 'tags' | 'properties' | 'secondaryTypes'> {
  const properties: Record<string, EntryPropertyValue> = {};
  for (const [k, v] of Object.entries(template.properties ?? {})) {
    if (k === TEMPLATE_FOR_KEY) continue;
    properties[k] = Array.isArray(v) ? [...v] : v;
  }
  const secondaryTypes = (template.secondaryTypes ?? []).filter((t) => t !== TEMPLATE_TYPE_ID && t !== target.typeId);
  return {
    body: fillPlaceholders(template.body ?? '', { title: target.title, type: target.typeName, date: target.date ?? new Date() }),
    tags: (template.tags ?? []).filter((t) => t.toLowerCase() !== TEMPLATE_TYPE_ID),
    properties,
    secondaryTypes,
  };
}

/** A new template copied from an existing entry, made for that entry's type. */
export function templateFromEntry(
  entry: Pick<Entry, 'title' | 'type' | 'body' | 'tags' | 'properties' | 'secondaryTypes'>,
  typeName: string
): Pick<CreateEntryInput, 'title' | 'type' | 'folder' | 'body' | 'tags' | 'properties' | 'secondaryTypes'> {
  return {
    title: `${typeName} Template`,
    type: TEMPLATE_TYPE_ID,
    folder: 'templates',
    body: entry.body,
    tags: entry.tags.filter((t) => t.toLowerCase() !== TEMPLATE_TYPE_ID),
    properties: { ...entry.properties, [TEMPLATE_FOR_KEY]: entry.type },
    secondaryTypes: (entry.secondaryTypes ?? []).filter((t) => t !== TEMPLATE_TYPE_ID),
  };
}
