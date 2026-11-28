import type { EntryPropertyValue, PropertyFieldDef, PropertyFieldType } from './types';

export const PROPERTY_FIELD_TYPES: Array<{ id: PropertyFieldType; label: string }> = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Select' },
  { id: 'multi-select', label: 'Multi-select' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'url', label: 'URL' },
  { id: 'relation', label: 'Relation (links to entries)' },
];

function slug(input: string, sep: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
}

/** An EntityType id from its name that doesn't collide with an existing one ("Character" → "character-2"). */
export function uniqueTypeId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds, (id) => id.toLowerCase()));
  const base = slug(name, '-') || 'custom-type';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export interface FieldDraft {
  /** Existing key (kept when editing so entries' saved values stay attached); empty for new fields. */
  key: string;
  label: string;
  fieldType: PropertyFieldType;
  /** Comma-separated options for select / multi-select. */
  optionsText: string;
  /** Relation fields: entity types it may link to (empty = any). */
  targetTypes?: string[];
}

/**
 * Turns edited field rows into PropertyFieldDefs: drops blank rows, keeps existing keys, derives
 * keys for new fields from their label (falling back to field_N for labels with no a–z/0–9), and
 * makes every key unique.
 */
export function finalizeFields(drafts: FieldDraft[]): PropertyFieldDef[] {
  const used = new Set<string>();
  const out: PropertyFieldDef[] = [];
  drafts.forEach((d, i) => {
    const label = d.label.trim();
    if (!label) return;
    let key = d.key.trim() || slug(label, '_') || `field_${i + 1}`;
    const base = key;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    const field: PropertyFieldDef = { key, label, fieldType: d.fieldType };
    if (d.fieldType === 'select' || d.fieldType === 'multi-select') {
      const options = Array.from(new Set(d.optionsText.split(',').map((o) => o.trim()).filter(Boolean)));
      if (options.length > 0) field.options = options;
    }
    if (d.fieldType === 'relation' && d.targetTypes && d.targetTypes.length > 0) {
      field.targetTypes = Array.from(new Set(d.targetTypes));
    }
    out.push(field);
  });
  return out;
}

export function toFieldDraft(field: PropertyFieldDef): FieldDraft {
  return {
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    optionsText: (field.options ?? []).join(', '),
    targetTypes: field.targetTypes ? [...field.targetTypes] : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Relation values are stored like Obsidian link properties: a list of "[[Entry Title]]" strings.

const LINK_VALUE = /^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]\s*$/;

/** `[[Kael Vorn|Kael]]` → { target: 'Kael Vorn', label: 'Kael' }; plain text → { target: text }. */
export function parseLinkValue(value: string): { target: string; label: string } {
  const m = LINK_VALUE.exec(value);
  if (!m) return { target: value.trim(), label: value.trim() };
  const target = m[1].trim();
  return { target, label: (m[2] ?? '').trim() || target };
}

export function toLinkValue(title: string): string {
  return `[[${title.replace(/[[\]|]/g, '').trim()}]]`;
}

function truthy(value: EntryPropertyValue): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return /^(true|yes|y|1|x|✓)$/i.test(String(value).trim());
}

function toList(value: EntryPropertyValue): string[] {
  return Array.isArray(value)
    ? value.map(String).filter((v) => v.trim())
    : String(value)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
}

/** Normalizes a stored property value for display in a field of the given type. */
export function readPropertyValue(field: PropertyFieldDef, value: EntryPropertyValue | undefined): EntryPropertyValue | undefined {
  if (value === undefined || value === '') return undefined;
  switch (field.fieldType) {
    case 'multi-select':
      return toList(value);
    case 'relation':
      // A single "[[A]], [[B]]" string (hand-edited) reads as two links
      return Array.isArray(value) ? value.map(String).filter((v) => v.trim()) : String(value).match(/\[\[[^\]]+\]\]/g) ?? toList(value);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? n : String(value);
    }
    case 'checkbox':
      return truthy(value);
    default:
      return Array.isArray(value) ? value.join(', ') : value;
  }
}

/**
 * Converts an input's raw value into what gets saved: numbers as numbers, multi-select and
 * relation as lists, checkboxes as `true` (unchecked removes the key). `undefined` = remove.
 */
export function coercePropertyInput(
  field: PropertyFieldDef,
  raw: string | string[] | boolean
): EntryPropertyValue | undefined {
  if (field.fieldType === 'checkbox') {
    return (typeof raw === 'boolean' ? raw : truthy(raw)) ? true : undefined;
  }
  if (typeof raw === 'boolean') return raw ? 'true' : undefined;
  if (Array.isArray(raw)) {
    const list = raw.map((v) => v.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (field.fieldType === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (field.fieldType === 'multi-select' || field.fieldType === 'relation') {
    const list = trimmed.split(',').map((v) => v.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  return trimmed;
}

/** Only http(s) links are opened from a URL property (the main process refuses anything else). */
export function safeExternalUrl(value: string): string | null {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
  return null;
}

/** Short plain-text form of a value for tables, cards and exports. */
export function formatPropertyValue(field: PropertyFieldDef | undefined, value: EntryPropertyValue | undefined): string {
  if (value === undefined || value === '') return '';
  if (field?.fieldType === 'checkbox') return truthy(value) ? '✓' : '';
  const read = field ? readPropertyValue(field, value) : value;
  if (read === undefined) return '';
  const list = Array.isArray(read) ? read : [read];
  return list
    .map((v) => (typeof v === 'string' && v.includes('[[') ? parseLinkValue(v).label : String(v)))
    .join(', ');
}
