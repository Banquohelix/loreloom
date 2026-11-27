import type { EntrySummary } from './types';

export interface TimelineItem {
  entry: EntrySummary;
  era: string;
  dateLabel: string;
  impact: string;
  sortKey: number;
}

export interface TimelineEraGroup {
  era: string;
  items: TimelineItem[];
}

/**
 * Extracts a numeric chronological sort key from freeform in-world dates
 * like "420 BCE", "Year -120", "1452 AC", "2089", or numeric order fields.
 */
export function extractChronologicalKey(dateLabel: string, fallbackOrder?: unknown): number {
  if (dateLabel) {
    const lower = dateLabel.toLowerCase();
    const match = dateLabel.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      let num = Number.parseFloat(match[0]);
      if (/\b(bce|bc|before|pre)\b/.test(lower) && num > 0) {
        num = -num;
      }
      return num;
    }
  }
  if (typeof fallbackOrder === 'number' && Number.isFinite(fallbackOrder)) {
    return fallbackOrder;
  }
  if (typeof fallbackOrder === 'string' && fallbackOrder.trim()) {
    const parsed = Number.parseFloat(fallbackOrder);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.POSITIVE_INFINITY;
}

export function groupEntriesForTimeline(entries: EntrySummary[]): TimelineEraGroup[] {
  const groups = new Map<string, TimelineItem[]>();

  for (const entry of entries) {
    const props = entry.properties ?? {};
    const rawEra = props.era ?? props.period ?? props.age ?? '';
    const era = String(rawEra).trim() || 'General Timeline';
    const rawDate = props.date ?? props.year ?? props.in_world_date ?? '';
    const dateLabel = String(rawDate).trim();
    const rawImpact = props.impact ?? props.significance ?? '';
    const impact = String(rawImpact).trim();
    const sortKey = extractChronologicalKey(dateLabel, props.order);

    const item: TimelineItem = { entry, era, dateLabel, impact, sortKey };
    const arr = groups.get(era) ?? [];
    arr.push(item);
    groups.set(era, arr);
  }

  const eraGroups: TimelineEraGroup[] = Array.from(groups.entries()).map(([era, items]) => ({
    era,
    items: items.sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return a.entry.title.localeCompare(b.entry.title);
    }),
  }));

  // Sort eras by their earliest dated event, with "General Timeline" last
  return eraGroups.sort((a, b) => {
    if (a.era === 'General Timeline' && b.era !== 'General Timeline') return 1;
    if (b.era === 'General Timeline' && a.era !== 'General Timeline') return -1;
    const minA = a.items[0]?.sortKey ?? Number.POSITIVE_INFINITY;
    const minB = b.items[0]?.sortKey ?? Number.POSITIVE_INFINITY;
    if (minA !== minB) return minA - minB;
    return a.era.localeCompare(b.era);
  });
}
