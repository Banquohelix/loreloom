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
  defaultView: 'gallery' | 'table' | 'timeline' | 'board';
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
  /** Transient (never persisted): the manifest record exists but the file has not synced/arrived yet. */
  missing?: boolean;
}

export type EntryPropertyValue = string | string[] | number | boolean;

export interface EntryRelationship {
  id: string;
  targetId: string;
  label: string;
}

export interface EntrySummary {
  id: string;
  worldSlug: string;
  title: string;
  slug: string;
  type: string;
  secondaryTypes?: string[];
  relationships?: EntryRelationship[];
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
  /** Frontmatter keys Loreloom does not manage (aliases, cssclasses, custom keys); preserved verbatim on save. */
  extraFrontmatter?: Record<string, unknown>;
}

/** Returned from updateEntry. When `conflictCopy` is set, the entry changed on disk (e.g. another PC)
 * since the editor loaded it: the on-disk version was kept and the incoming edit saved as a copy. */
export interface UpdateEntryResult extends Entry {
  conflictCopy?: { id: string; title: string };
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
  label?: string;
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

export interface BoardItem {
  id: string;
  kind: 'art' | 'note' | 'swatch';
  x: number;
  y: number;
  width: number;
  assetId?: string;
  title?: string;
  text?: string;
  color?: string;
  entryId?: string;
}

export interface MoodboardDef {
  id: string;
  worldSlug: string;
  title: string;
  items: BoardItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ExportWorldBibleOptions {
  worldSlug: string;
  format: 'html' | 'pdf';
  includedTypeIds: string[];
  includeArtGallery: boolean;
  appearance: StudioAppearance;
}

export interface ExportWorldBibleResult {
  outputPath: string;
  entryCount: number;
  artCount: number;
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
  relationships?: EntryRelationship[];
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
  relationships?: EntryRelationship[];
  folder?: string;
  body?: string;
  tags?: string[];
  properties?: Record<string, EntryPropertyValue>;
  coverAssetId?: string | null;
  portraitAssetId?: string | null;
  /** Body the editor last loaded/saved. If the file's body differs, the save is forked into a conflict copy. */
  baseBody?: string;
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

export type TrashKind = 'entry' | 'art' | 'map' | 'board' | 'type';

/** Something deleted from a World and kept in `<world>/.trash/` so it can be restored. */
export interface TrashItem {
  /** `<kind>/<file name in the trash folder>` */
  id: string;
  kind: TrashKind;
  title: string;
  /** ISO time it was deleted */
  deletedAt: string;
  /** Where it lived before, e.g. `characters/kael.md` or `gate.png` */
  originalName: string;
}

export interface TrashRestoreResult {
  kind: TrashKind;
  title: string;
  /** The restored entry, asset, map, board or type ID */
  restoredId: string;
  /** For entries: the restored file's path relative to `entries/` */
  relativePath?: string;
  /** True when the original name or ID was taken, so it came back under a new one */
  renamed: boolean;
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
  /** GitHub API URL of the release's SHA256SUMS.txt asset, used to verify the installer. */
  checksumsApiUrl?: string;
  releaseNotes?: string;
  message?: string;
}

/** Two or more files in one World that share the same frontmatter `id` (e.g. a sync conflict copy). */
export interface DuplicateIdConflict {
  worldSlug: string;
  id: string;
  relativePaths: string[];
}

export interface DesktopBridge {
  // Workspace lifecycle
  getSavedWorkspacePath: () => Promise<string | null>;
  pickFolder: (title?: string) => Promise<string | null>;
  pickImageFiles: () => Promise<string[]>;
  openWorkspace: (rootPath: string) => Promise<WorkspaceState>;
  updateWorkspaceConfig: (patch: Partial<WorkspaceConfig>) => Promise<WorkspaceConfig>;
  /** Re-reads world.yaml files only (cheap), e.g. after a World changed on another PC. */
  listWorlds: () => Promise<WorldConfig[]>;
  rebuildIndex: () => Promise<{ indexedEntries: number; indexedWorlds: number }>;

  // Worlds
  createWorld: (input: CreateWorldInput) => Promise<WorldConfig>;
  updateWorld: (worldSlug: string, patch: Partial<Pick<WorldConfig, 'name' | 'subtitle' | 'medium' | 'coverAssetId' | 'theme' | 'entityTypes'>>) => Promise<WorldConfig>;
  deleteWorld: (worldSlug: string) => Promise<void>;

  // Entries & Collections
  listEntries: (query: CollectionQuery) => Promise<EntrySummary[]>;
  readEntry: (worldSlug: string, id: string) => Promise<Entry | null>;
  createEntry: (input: CreateEntryInput) => Promise<Entry>;
  updateEntry: (input: UpdateEntryInput) => Promise<UpdateEntryResult>;
  deleteEntry: (worldSlug: string, id: string) => Promise<void>;
  /** Rewrites `[[oldTitle]]` links across the World to the entry's current title. */
  renameEntryLinks: (worldSlug: string, entryId: string, oldTitle: string) => Promise<{ updatedEntries: number }>;
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
  /** URL of a cached, downscaled copy (longest side `size` px) for grids, cards and pickers. */
  getThumbnailUrl: (worldSlug: string, relativePath: string, size: 128 | 256 | 512 | 1024 | 1600) => string;

  // Interactive Pin Maps
  listMaps: (worldSlug: string) => Promise<WorldMapDef[]>;
  createMap: (worldSlug: string, title: string, assetId: string) => Promise<WorldMapDef>;
  updateMap: (
    worldSlug: string,
    mapId: string,
    patch: Partial<Pick<WorldMapDef, 'title' | 'assetId' | 'pins'>>
  ) => Promise<WorldMapDef>;
  deleteMap: (worldSlug: string, mapId: string) => Promise<void>;

  // Visual Moodboards / Reference Canvases
  listBoards: (worldSlug: string) => Promise<MoodboardDef[]>;
  createBoard: (worldSlug: string, title: string) => Promise<MoodboardDef>;
  updateBoard: (
    worldSlug: string,
    boardId: string,
    patch: Partial<Pick<MoodboardDef, 'title' | 'items'>>
  ) => Promise<MoodboardDef>;
  deleteBoard: (worldSlug: string, boardId: string) => Promise<void>;

  // World Bible Export (HTML / PDF) & Snapshot Backup
  exportWorldBible: (options: ExportWorldBibleOptions) => Promise<ExportWorldBibleResult | null>;
  exportWorldZip: (worldSlug: string) => Promise<{ outputPath: string } | null>;
  openLocalFile: (filePath: string) => Promise<void>;

  // World Hygiene (Duplicate Merger & Art Auto-Linker)
  findDuplicates: (worldSlug: string) => Promise<DuplicateGroup[]>;
  mergeDuplicates: (
    worldSlug: string,
    keepEntryId: string,
    removeEntryIds: string[]
  ) => Promise<Entry>;
  findDuplicateIds: (worldSlug: string) => Promise<DuplicateIdConflict[]>;
  listTrash: (worldSlug: string) => Promise<TrashItem[]>;
  restoreTrashItem: (worldSlug: string, itemId: string) => Promise<TrashRestoreResult>;
  deleteTrashItemForever: (worldSlug: string, itemId: string) => Promise<void>;
  reassignEntryId: (worldSlug: string, relativePath: string) => Promise<Entry>;
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
  /** Main asks the renderer to flush pending saves before the window closes; call the returned ack when done. */
  onBeforeClose: (cb: () => Promise<void>) => () => void;

  // In-App Update Checker
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadAndInstallUpdate: (installerApiUrl: string, filename: string) => Promise<void>;
  hasUpdateToken: () => Promise<boolean>;
  setUpdateToken: (token: string | null) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
}
