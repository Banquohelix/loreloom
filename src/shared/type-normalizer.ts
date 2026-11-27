import type { EntityTypeDef } from './types';

const CANONICAL_SYNONYMS: Record<string, string> = {
  // Locations / Places / Countries
  location: 'location',
  locations: 'location',
  place: 'location',
  places: 'location',
  region: 'location',
  regions: 'location',
  country: 'location',
  countries: 'location',
  nation: 'location',
  nations: 'location',
  kingdom: 'location',
  kingdoms: 'location',
  city: 'location',
  cities: 'location',
  town: 'location',
  village: 'location',
  landmark: 'location',
  realm: 'location',
  realms: 'location',
  continent: 'location',
  geography: 'location',
  setting: 'location',
  area: 'location',
  biome: 'location',
  district: 'location',

  // Characters / People
  character: 'character',
  characters: 'character',
  npc: 'character',
  npcs: 'character',
  person: 'character',
  people: 'character',
  cast: 'character',
  hero: 'character',
  villain: 'character',
  protagonist: 'character',
  companion: 'character',

  // Factions
  faction: 'faction',
  factions: 'faction',
  guild: 'faction',
  guilds: 'faction',
  org: 'faction',
  organization: 'faction',
  organizations: 'faction',
  house: 'faction',
  clan: 'faction',
  order: 'faction',
  syndicate: 'faction',
  empire: 'faction',
  cult: 'faction',

  // Items / Artifacts
  item: 'item',
  items: 'item',
  artifact: 'item',
  artifacts: 'item',
  relic: 'item',
  relics: 'item',
  weapon: 'item',
  weapons: 'item',
  gear: 'item',
  equipment: 'item',
  prop: 'item',
  tool: 'item',

  // Events / History / Timeline
  event: 'event',
  events: 'event',
  timeline: 'event',
  history: 'event',
  chronicle: 'event',
  era: 'event',
  epoch: 'event',
  war: 'event',
  battle: 'event',

  // General Lore Pages
  page: 'page',
  lore: 'page',
  note: 'page',
  guide: 'page',
  world: 'page',
  overview: 'page',
  index: 'page',
};

/**
 * Maps a raw YAML frontmatter `type` value (e.g. `place`, `country`, `people`, `lore`)
 * onto a valid EntityType ID in the target World. Custom EntityTypes in the World
 * always take precedence over built-in synonym mapping.
 */
export function normalizeFrontmatterType(
  rawType: unknown,
  entityTypes?: EntityTypeDef[]
): string | null {
  if (typeof rawType !== 'string' || !rawType.trim()) return null;
  const clean = rawType.trim().toLowerCase().replace(/^world[-_]/, '');

  // 1. Exact match against this World's EntityTypes (including custom types like `vehicle`)
  if (entityTypes && entityTypes.length > 0) {
    for (const et of entityTypes) {
      if (
        et.id.toLowerCase() === clean ||
        et.name.toLowerCase() === clean ||
        et.pluralName.toLowerCase() === clean
      ) {
        return et.id;
      }
    }
  }

  // 2. Built-in synonym table (e.g. `place` -> `location`, `people` -> `character`)
  const mapped = CANONICAL_SYNONYMS[clean];
  if (mapped) {
    if (!entityTypes || entityTypes.some((t) => t.id === mapped)) {
      return mapped;
    }
  }

  return null;
}
