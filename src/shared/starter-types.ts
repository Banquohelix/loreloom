import type { EntityTypeDef } from './types';

export const STARTER_ENTITY_TYPES: EntityTypeDef[] = [
  {
    id: 'page',
    name: 'Lore Page',
    pluralName: 'Lore Pages',
    icon: 'file-text',
    color: '#64748b',
    defaultView: 'table',
    builtIn: true,
    fields: [
      { key: 'era', label: 'Era', fieldType: 'text' },
      { key: 'status', label: 'Status', fieldType: 'select', options: ['Draft', 'Canon', 'Retconned', 'Needs Art'] },
    ],
  },
  {
    id: 'character',
    name: 'Character',
    pluralName: 'Characters',
    icon: 'user',
    color: '#d97706',
    defaultView: 'gallery',
    builtIn: true,
    fields: [
      { key: 'role', label: 'Role', fieldType: 'text' },
      { key: 'faction', label: 'Faction', fieldType: 'text' },
      { key: 'species', label: 'Species / Ancestry', fieldType: 'text' },
      { key: 'status', label: 'Status', fieldType: 'select', options: ['Alive', 'Deceased', 'Missing', 'Unknown'] },
    ],
  },
  {
    id: 'location',
    name: 'Location',
    pluralName: 'Locations',
    icon: 'map-pin',
    color: '#059669',
    defaultView: 'gallery',
    builtIn: true,
    fields: [
      { key: 'region', label: 'Region', fieldType: 'text' },
      { key: 'climate', label: 'Climate / Biome', fieldType: 'text' },
      { key: 'ruler', label: 'Controlling Faction', fieldType: 'text' },
    ],
  },
  {
    id: 'faction',
    name: 'Faction',
    pluralName: 'Factions',
    icon: 'shield',
    color: '#7c3aed',
    defaultView: 'gallery',
    builtIn: true,
    fields: [
      { key: 'alignment', label: 'Ethos / Alignment', fieldType: 'text' },
      { key: 'headquarters', label: 'Headquarters', fieldType: 'text' },
      { key: 'influence', label: 'Influence', fieldType: 'select', options: ['Local', 'Regional', 'Continental', 'Global'] },
    ],
  },
  {
    id: 'item',
    name: 'Item / Artifact',
    pluralName: 'Items & Artifacts',
    icon: 'sparkles',
    color: '#e11d48',
    defaultView: 'gallery',
    builtIn: true,
    fields: [
      { key: 'rarity', label: 'Rarity', fieldType: 'select', options: ['Common', 'Uncommon', 'Rare', 'Relic', 'Mythic'] },
      { key: 'owner', label: 'Current Holder', fieldType: 'text' },
      { key: 'origin', label: 'Origin', fieldType: 'text' },
    ],
  },
  {
    id: 'event',
    name: 'Timeline Event',
    pluralName: 'Timeline',
    icon: 'clock',
    color: '#0284c7',
    defaultView: 'timeline',
    builtIn: true,
    fields: [
      { key: 'date', label: 'In-World Date', fieldType: 'text' },
      { key: 'era', label: 'Era', fieldType: 'text' },
      { key: 'impact', label: 'Impact', fieldType: 'select', options: ['Minor', 'Major', 'Epoch-Defining'] },
    ],
  },
];

export function cloneStarterEntityTypes(): EntityTypeDef[] {
  return STARTER_ENTITY_TYPES.map((t) => ({
    ...t,
    fields: t.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined })),
  }));
}
