import type { EntryPropertyValue, PropertyFieldDef, PropertyFieldType } from './types';

export const PROPERTY_FIELD_TYPES: Array<{ id: PropertyFieldType; label: string }> = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Select' },
  { id: 'multi-select', label: 'Multi-select' },
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
  };
}

/** Normalizes a stored property value for display in a field of the given type. */
export function readPropertyValue(field: PropertyFieldDef, value: EntryPropertyValue | undefined): EntryPropertyValue | undefined {
  if (value === undefined || value === '') return undefined;
  switch (field.fieldType) {
    case 'multi-select':
      return Array.isArray(value)
        ? value
        : String(value)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? n : String(value);
    }
    default:
      return Array.isArray(value) ? value.join(', ') : value;
  }
}

/** Converts an input's raw value into what gets saved (numbers as numbers, multi-select as arrays). */
export function coercePropertyInput(field: PropertyFieldDef, raw: string | string[]): EntryPropertyValue | undefined {
  if (Array.isArray(raw)) return raw.length > 0 ? raw : undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (field.fieldType === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (field.fieldType === 'multi-select') {
    const list = trimmed.split(',').map((v) => v.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  return trimmed;
}
