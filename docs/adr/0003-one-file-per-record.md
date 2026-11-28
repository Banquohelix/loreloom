# ADR 0003: One File per Record for Art, Maps, Moodboards and Entity Types

## Status
Accepted (v0.6.9). Refines ADR 0001.

## Context
ADR 0001 keeps every Entry in its own file so that editing different Entries on two PCs never touches the same file. Up to v0.6.8, four other kinds of data broke that rule by living in shared manifests:

- `art-manifest.yaml` (every concept-art record)
- `maps.yaml` (every map and its pins)
- `boards.yaml` (every moodboard)
- the `entityTypes` list inside `world.yaml`

Captioning one image on PC 1 while moving a pin on PC 2, or changing the theme on one PC while editing a type on the other, wrote the same file from both machines. OneDrive and Google Drive then create conflict copies, and one side's change silently stops being used.

## Decision
Store each record in its own small YAML file:

- `worlds/<slug>/records/art/<assetId>.yaml`
- `worlds/<slug>/records/maps/<mapId>.yaml`
- `worlds/<slug>/records/boards/<boardId>.yaml`
- `worlds/<slug>/records/types/<typeId>.yaml` (with an `order` field for display order)

`world.yaml` keeps only World settings and theme, plus `formatVersion: 2`.

Rules:

- **Unchanged records are never rewritten.** Editing a type does not touch `world.yaml` or other types.
- **Conflict copies are read, not ignored.** If the sync client leaves `<id>-PC2.yaml` beside `<id>.yaml`, the copy with the newer `updatedAt` wins, and deleting the record removes every copy.
- **Images found in `assets/` get a stable ID** derived from the World and filename, so two PCs discovering the same file can't mint two records.
- **Format guard.** A World whose `formatVersion` is higher than this build understands is read-only: writes fail with a message to update Loreloom.

## Migration
`WorkspaceStore.migrateWorldRecords` runs for every World when a workspace opens, whenever a list call finds a legacy manifest, and whenever the watcher sees one appear. It:

1. Copies records from each legacy manifest into `records/`, keeping records already there. Art is matched by ID and by filename; for maps and boards a newer `updatedAt` in the legacy copy wins.
2. Moves each retired manifest to `worlds/<slug>/.trash/migrated/`.
3. Moves `entityTypes` out of `world.yaml` into `records/types/` and sets `formatVersion: 2`.

It is idempotent, so it is safe on every launch and on every PC. That also covers the transition period: if a PC still running v0.6.8 writes a shared manifest after another PC migrated, the next read or watcher event folds it back in without duplicating art.

## Consequences
- **Positive**: Edits to different art, maps, boards or types on different PCs sync without conflicts.
- **Positive**: Fewer bytes rewritten per edit; moving one pin rewrites one small file.
- **Negative**: Listing reads a folder of small files instead of one file. At a few thousand records on a local sync folder this is still milliseconds.
- **Negative**: During the transition, a PC still on v0.6.8 shows starter entity types and re-registers images under new IDs until it updates. Its writes are absorbed, but every PC should be updated to v0.6.9.
