# ADR 0001: File-Per-Entry Markdown Storage with Local Rebuildable SQLite Index

## Status
Accepted

## Context
Loreloom must run on multiple PCs and use the user's OneDrive or Google Drive folder as its single source of truth without requiring a hosted server or OAuth backend. Placing a mutable SQLite database directly inside a cloud-synced folder risks database corruption and conflicted duplicate copies when two PCs edit or sync concurrently.

## Decision
Store all authoritative data inside the synced Workspace folder as individual human-readable files:
- `workspace.yaml` for workspace metadata
- `worlds/<slug>/world.yaml` for World config and WorldTheme
- `worlds/<slug>/records/{art,maps,boards,types}/<id>.yaml` for art metadata, maps, moodboards and EntityTypes, one file per record (see [ADR 0003](0003-one-file-per-record.md); before v0.6.9 these were shared manifests)
- `worlds/<slug>/assets/*` for concept art images
- `worlds/<slug>/entries/**/*.md` for Entries (YAML frontmatter + Markdown body)

Store a rebuildable SQLite + FTS5 `LocalIndex` strictly outside the synced folder in machine-local AppData (`%APPDATA%/Loreloom/index.db`).

## Consequences
- **Positive**: Editing Entry A on PC 1 and Entry B on PC 2 syncs cleanly without database conflicts.
- **Positive**: Notes and art remain human-readable, portable, and nearly 1:1 compatible with Obsidian vaults.
- **Negative**: Requires a file watcher and index sync/rebuild routine on startup and on external file changes.
