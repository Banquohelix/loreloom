export const NEEDS_TRIAGE_TAG = 'needs-triage';

export type StudioAppearance = 'light' | 'dark';

export type WorldMedium =
  | 'video-game'
  | 'ttrpg'
  | 'novel'
  | 'short-story'
  | 'film'
  | 'other';

export type WorldThemePresetId =
  | 'minimal-studio'
  | 'parchment-lorebook'
  | 'scifi-slate'
  | 'dark-fantasy-ink'
  | 'botanical-codex';

export type HeadingFontStyle = 'sans' | 'serif' | 'mono';

export interface WorldTheme {
  preset: WorldThemePresetId;
  accentColor: string;
  headingFont: HeadingFontStyle;
  surfaceTint: string;
  editorialDropCap: boolean;
}

export type PropertyFieldType = 'text' | 'select' | 'multi-select' | 'date' | 'number';

export interface PropertyFieldDef {
  key: string;
  label: string;
  fieldType: PropertyFieldType;
  options?: string[];
}

export interface EntityTypeDef {
  id: string;
  name: string;
  pluralName: string;
  icon: string;
  color: string;
  defaultView: 'gallery' | 'table' | 'timeline';
  fields: PropertyFieldDef[];
  builtIn?: boolean;
}

export interface WorldConfig {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  medium: WorldMedium;
  coverAssetId?: string;
  theme: WorldTheme;
  entityTypes: EntityTypeDef[];
  createdAt: string;
  updatedAt: string;
}

export type ArtCategory =
  | 'character'
  | 'environment'
  | 'prop'
  | 'mood'
  | 'map'
  | 'other';

export interface ArtAsset {
  id: string;
  worldSlug: string;
  filename: string;
  relativePath: string;
  title: string;
  category: ArtCategory;
  tags: string[];
  caption: string;
  createdAt: string;
}

export type EntryPropertyValue = string | string[] | number | boolean;

export interface EntrySummary {
  id: string;
  worldSlug: string;
  title: string;
  slug: string;
  type: string;
  secondaryTypes?: string[];
  folder: string;
  relativePath: string;
  tags: string[];
  properties: Record<string, EntryPropertyValue>;
  coverAssetId?: string;
  portraitAssetId?: string;
  updatedAt: string;
  excerpt: string;
}

export interface Entry extends EntrySummary {
  body: string;
  createdAt: string;
}

export interface BacklinkRef {
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  context: string;
}

export interface GraphNode {
  id: string;
  title: string;
  type: string;
  connectionCount: number;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
}

export interface WorldGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MapPin {
  id: string;
  x: number; // 0..100 percentage of image width
  y: number; // 0..100 percentage of image height
  label: string;
  entryId?: string;
  color: string;
  note?: string;
}

export interface WorldMapDef {
  id: string;
  worldSlug: string;
  title: string;
  assetId: string;
  pins: MapPin[];
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateGroup {
  key: string;
  title: string;
  entries: Array<EntrySummary & { bodyLength: number }>;
}

export interface ArtLinkSuggestion {
  assetId: string;
  assetTitle: string;
  assetRelativePath: string;
  entryId: string;
  entryTitle: string;
  entryType: string;
  suggestedSlot: 'cover' | 'portrait';
  confidence: 'high' | 'medium';
  reason: string;
}

export interface SearchHit {
  entryId: string;
  worldSlug: string;
  worldName: string;
  title: string;
  type: string;
  snippet: string;
}

export interface VaultScanPreview {
  vaultPath: string;
  vaultName: string;
  noteCount: number;
  imageCount: number;
  folderCount: number;
  sampleFolders: string[];
  frontmatterKeys: string[];
}

export interface ImportReport {
  worldSlug: string;
  worldName: string;
  importedNotes: number;
  copiedAssets: number;
  resolvedLinks: number;
  unresolvedLinks: Array<{ sourceTitle: string; target: string }>;
  warnings: string[];
}

export interface WorkspaceConfig {
  name: string;
  activeWorldSlug?: string;
  studioAppearance: StudioAppearance;
  createdAt: string;
}

export interface WorkspaceState {
  rootPath: string;
  config: WorkspaceConfig;
  worlds: WorldConfig[];
}

export interface CreateWorldInput {
  name: string;
  subtitle?: string;
  medium: WorldMedium;
  preset?: WorldThemePresetId;
}

export interface CreateEntryInput {
  worldSlug: string;
  title: string;
  type?: string;
  secondaryTypes?: string[];
  folder?: string;
  body?: string;
  tags?: string[];
  properties?: Record<string, EntryPropertyValue>;
  coverAssetId?: string;
  portraitAssetId?: string;
}

export interface UpdateEntryInput {
  worldSlug: string;
  id: string;
  title?: string;
  type?: string;
  secondaryTypes?: string[];
  folder?: string;
  body?: string;
  tags?: string[];
  properties?: Record<string, EntryPropertyValue>;
  coverAssetId?: string | null;
  portraitAssetId?: string | null;
}

export interface CollectionQuery {
  worldSlug: string;
  type?: string;
  search?: string;
  tag?: string;
  sortBy?: 'updatedAt' | 'title';
  sortDir?: 'asc' | 'desc';
}

export interface ArtQuery {
  worldSlug: string;
  category?: ArtCategory | 'all';
  search?: string;
  tag?: string;
}

export interface WorkspaceExternalChangeEvent {
  worldSlug?: string;
  kind: 'entry' | 'world' | 'art';
  relativePath: string;
}

export interface IntakeImportedItem {
  kind: 'entry' | 'art';
  id: string;
  title: string;
  sourceRelPath: string;
  assignedCategory: string;
  needsTriage: boolean;
  action: 'created' | 'updated';
}

export interface IntakeSyncReport {
  worldSlug: string;
  foldersScanned: number;
  importedEntries: number;
  updatedEntries: number;
  importedArt: number;
  needsTriageCount: number;
  skippedUnchanged: number;
  items: IntakeImportedItem[];
  warnings: string[];
  syncedAt: string;
}

export interface ReclassifyTriageReport {
  reclassifiedEntries: number;
  reclassifiedArt: number;
  remainingTriage: number;
}

export interface UpdateCheckResult {
  status: 'up-to-date' | 'update-available' | 'auth-required' | 'error';
  currentVersion: string;
  latestVersion?: string;
  releaseUrl: string;
  installerApiUrl?: string;
  installerFilename?: string;
  releaseNotes?: string;
  message?: string;
}

export interface DesktopBridge {
  // Workspace lifecycle
  getSavedWorkspacePath: () => Promise<string | null>;
  pickFolder: (title?: string) => Promise<string | null>;
  pickImageFiles: () => Promise<string[]>;
  openWorkspace: (rootPath: string) => Promise<WorkspaceState>;
  updateWorkspaceConfig: (patch: Partial<WorkspaceConfig>) => Promise<WorkspaceConfig>;
  rebuildIndex: () => Promise<{ indexedEntries: number; indexedWorlds: number }>;

  // Worlds
  createWorld: (input: CreateWorldInput) => Promise<WorldConfig>;
  updateWorld: (worldSlug: string, patch: Partial<Pick<WorldConfig, 'name' | 'subtitle' | 'medium' | 'coverAssetId' | 'theme' | 'entityTypes'>>) => Promise<WorldConfig>;
  deleteWorld: (worldSlug: string) => Promise<void>;

  // Entries & Collections
  listEntries: (query: CollectionQuery) => Promise<EntrySummary[]>;
  readEntry: (worldSlug: string, id: string) => Promise<Entry | null>;
  createEntry: (input: CreateEntryInput) => Promise<Entry>;
  updateEntry: (input: UpdateEntryInput) => Promise<Entry>;
  deleteEntry: (worldSlug: string, id: string) => Promise<void>;
  getBacklinks: (worldSlug: string, entryId: string) => Promise<BacklinkRef[]>;
  getWorldGraph: (worldSlug: string) => Promise<WorldGraph>;
  searchGlobal: (query: string) => Promise<SearchHit[]>;

  // Concept Art
  listArtAssets: (query: ArtQuery) => Promise<ArtAsset[]>;
  importArtFiles: (worldSlug: string, filePaths: string[], category?: ArtCategory) => Promise<ArtAsset[]>;
  saveArtFromBuffer: (worldSlug: string, filename: string, base64Data: string, category?: ArtCategory) => Promise<ArtAsset>;
  updateArtAsset: (worldSlug: string, assetId: string, patch: Partial<Pick<ArtAsset, 'title' | 'category' | 'tags' | 'caption'>>) => Promise<ArtAsset>;
  deleteArtAsset: (worldSlug: string, assetId: string) => Promise<void>;
  getArtLinkedEntries: (worldSlug: string, assetId: string) => Promise<EntrySummary[]>;
  getAssetUrl: (worldSlug: string, relativePath: string) => string;

  // Interactive Pin Maps
  listMaps: (worldSlug: string) => Promise<WorldMapDef[]>;
  createMap: (worldSlug: string, title: string, assetId: string) => Promise<WorldMapDef>;
  updateMap: (
    worldSlug: string,
    mapId: string,
    patch: Partial<Pick<WorldMapDef, 'title' | 'assetId' | 'pins'>>
  ) => Promise<WorldMapDef>;
  deleteMap: (worldSlug: string, mapId: string) => Promise<void>;

  // World Hygiene (Duplicate Merger & Art Auto-Linker)
  findDuplicates: (worldSlug: string) => Promise<DuplicateGroup[]>;
  mergeDuplicates: (
    worldSlug: string,
    keepEntryId: string,
    removeEntryIds: string[]
  ) => Promise<Entry>;
  findArtLinkSuggestions: (worldSlug: string) => Promise<ArtLinkSuggestion[]>;

  // Obsidian Vault Importer
  scanObsidianVault: (vaultPath: string) => Promise<VaultScanPreview>;
  importObsidianVault: (options: {
    vaultPath: string;
    targetWorldSlug?: string;
    newWorldName?: string;
    newWorldMedium?: WorldMedium;
    newWorldPreset?: WorldThemePresetId;
  }) => Promise<ImportReport>;

  // External sync watcher subscription
  onWorkspaceChanged: (cb: (event: WorkspaceExternalChangeEvent) => void) => () => void;

  // Per-World Intake Drop-Folder Sync
  getWorldIntakeFolders: (worldSlug: string) => Promise<string[]>;
  setWorldIntakeFolders: (worldSlug: string, folders: string[]) => Promise<string[]>;
  runWorldIntakeSync: (worldSlug: string) => Promise<IntakeSyncReport>;
  reclassifyTriageItems: (worldSlug: string) => Promise<ReclassifyTriageReport>;
  exportWorldPromptFramework: (worldSlug: string) => Promise<string>;
  onIntakeSynced: (cb: (report: IntakeSyncReport) => void) => () => void;

  // In-App Update Checker
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadAndInstallUpdate: (installerApiUrl: string, filename: string) => Promise<void>;
  hasUpdateToken: () => Promise<boolean>;
  setUpdateToken: (token: string | null) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
}
