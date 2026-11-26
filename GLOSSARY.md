# Glossary

Canonical domain vocabulary for Loreloom. Every term has one precise meaning across the UI, file format, and codebase.

## Workspace
The single root directory inside the user's cloud-synced folder (OneDrive or Google Drive) containing `workspace.yaml` and all Worlds.

## World
A self-contained creative project or IP setting (for a video game, TTRPG, short story, novel, or film). A World owns its own Lore Tree, EntityTypes, Collections, ArtAssets, and WorldTheme.

## Entry
A single lore document inside a World, persisted as one Markdown file with YAML frontmatter. Every Entry has a stable `id`, `title`, `type`, `folder`, `tags`, `properties`, optional `coverAssetId` and `portraitAssetId`, and Markdown `body`.

## EntityType
A schema definition belonging to a World (either a starter template like Character, Location, Faction, Item, Event, or a custom user-defined type) that specifies its icon, property fields, and default collection view.

## Collection
A filterable, sortable Gallery or Table view over Entries matching a given EntityType within a World.

## ArtAsset
An image file stored inside a World's `assets/` folder along with metadata (`id`, `filename`, `category`, `tags`, `caption`) tracked in `art-manifest.yaml`. ArtAssets can be browsed in the Concept Art Gallery and linked to Entries as covers, portraits, or inline blocks.

## WorldTheme
The per-World visual styling configuration (`preset`, `accentColor`, `headingFont`, `surfaceTint`, `editorialDropCap`) applied to the reading/writing canvas while keeping the outer Studio chrome neutral and clean.

## LocalIndex
The machine-local, rebuildable SQLite + FTS5 cache stored outside the synced folder in AppData. It accelerates full-text search, Collection filtering, and `[[wikilink]]` backlink queries and can be rebuilt from the Workspace folder at any time.

## VaultImport
A non-destructive copy of an external Obsidian vault (Markdown notes, folder hierarchy, YAML frontmatter, `[[wikilinks]]`, `#tags`, and `![[embedded images]]`) into a Loreloom World, producing an inspectable ImportReport.

## IntakeFolder
An external local folder (e.g., `Brimstone` or `Neon Ash`) linked to a World where new lore notes (`.md`, `.txt`) and concept art images from AI tools are dropped for automatic import and sorting.

## IntakeSync
A non-destructive sync job (live-watched, on launch, or manual) that scans a World's IntakeFolders, skips unchanged files via fingerprint tracking, auto-classifies new notes and art into World EntityTypes and ArtCategories, and flags ambiguous files with `#needs-triage` for one-click re-sorting.
