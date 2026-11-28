/** How many recently opened pages Loreloom remembers per World. */
export const RECENT_LIMIT = 12;

/** Moves `id` to the front of the recents list, dropping duplicates and anything past the limit. */
export function pushRecent(list: readonly string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, limit);
}

/** Reads a stored recents list, ignoring anything malformed (e.g. an older format or a hand edit). */
export function parseRecents(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** localStorage key for a World's recents. Keyed by World id so renaming the World keeps them. */
export function recentsStorageKey(worldId: string): string {
  return `loreloom:recent:${worldId}`;
}
