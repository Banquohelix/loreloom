import type { EntityTypeDef, EntrySummary, PropertyFieldDef } from './types';

export interface BoardColumn {
  value: string; // '' for unassigned
  label: string;
  entries: EntrySummary[];
}

export const FALLBACK_STATUS_FIELD: PropertyFieldDef = {
  key: 'status',
  label: 'Status',
  fieldType: 'select',
  options: ['Draft', 'In Progress', 'Canon'],
};

export function getBoardGroupableFields(entityType: EntityTypeDef): PropertyFieldDef[] {
  const selectFields = entityType.fields.filter(
    (f) => f.fieldType === 'select' && Array.isArray(f.options) && f.options.length > 0
  );
  return selectFields.length > 0 ? selectFields : [FALLBACK_STATUS_FIELD];
}

export function pickDefaultBoardField(entityType: EntityTypeDef): PropertyFieldDef {
  const fields = getBoardGroupableFields(entityType);
  return fields.find((f) => f.key.toLowerCase() === 'status') ?? fields[0];
}

export function groupEntriesIntoColumns(
  entries: EntrySummary[],
  field: PropertyFieldDef
): BoardColumn[] {
  const options = field.options ?? [];
  const optionLowerToCanonical = new Map(options.map((o) => [o.toLowerCase(), o]));

  const buckets = new Map<string, EntrySummary[]>();
  buckets.set('', []);
  for (const opt of options) {
    buckets.set(opt, []);
  }

  for (const entry of entries) {
    const raw = entry.properties?.[field.key];
    const str = raw !== undefined && raw !== null ? String(raw).trim() : '';
    const canonical = optionLowerToCanonical.get(str.toLowerCase());
    if (canonical) {
      buckets.get(canonical)!.push(entry);
    } else if (str) {
      // Preserve custom values not in options list as their own column
      if (!buckets.has(str)) buckets.set(str, []);
      buckets.get(str)!.push(entry);
    } else {
      buckets.get('')!.push(entry);
    }
  }

  const columns: BoardColumn[] = [];
  const unassigned = buckets.get('') ?? [];
  if (unassigned.length > 0) {
    columns.push({ value: '', label: 'Unassigned', entries: unassigned });
  }
  for (const [val, items] of buckets.entries()) {
    if (val === '') continue;
    columns.push({ value: val, label: val, entries: items });
  }

  return columns;
}
