# Loreloom

A clean, Notion-style desktop studio for **worldbuilding notes and concept art**, designed for video games, tabletop RPGs, short stories, novels, and films.

## Key Features
- **OneDrive & Google Drive Multi-PC Sync**: Stores every lore entry as a clean Markdown + YAML frontmatter file and keeps concept art in `<world>/assets/`. A machine-local SQLite + FTS5 index (`%APPDATA%/Loreloom/index.db`) stays outside the synced folder to prevent cloud database conflicts.
- **Multi-World Workspaces & Per-World Theming**: Switch between separate settings/IPs in the sidebar. Keep the Studio chrome crisp and minimal while styling each World's canvas with curated presets (*Minimal Studio*, *Parchment Lorebook*, *Sci-Fi Slate*, *Dark Fantasy Ink*, *Botanical Codex*), custom accent colors, typography, and optional editorial drop caps.
- **Notion-Style Block Editor & Worldbuilding Collections**: Slash commands (`/`), `[[wikilinks]]` with backlinks, cover art banners, portraits, starter templates (*Characters, Locations, Factions, Items, Timeline*), plus **custom Entity Types** per World with Gallery and Table views.
- **Concept Art Gallery & Lightbox**: Drag-and-drop art uploads, category filtering (*Characters, Environments, Props, Mood, Maps*), fullscreen zoomable lightbox, and bidirectional art-to-lore linking.
- **Non-Destructive Obsidian Vault Importer**: Imports existing Obsidian story vaults (folders, Markdown notes, YAML frontmatter, `[[wikilinks]]`, `#tags`, and `![[embedded images]]`) into a Loreloom World without modifying your original vault.

## Commands

```bash
# Run in desktop development mode (Vite + Electron)
pnpm run dev:electron

# Run unit & integration tests
pnpm test

# Production build (TypeScript + Vite + Electron main)
pnpm run build

# Build Windows installer (.exe) & portable build for other PCs
pnpm run package
```

## Architecture & Docs
- [GLOSSARY.md](./GLOSSARY.md) — Canonical domain vocabulary
- [docs/adr/0001-file-per-entry-sync-with-local-sqlite-index.md](./docs/adr/0001-file-per-entry-sync-with-local-sqlite-index.md) — OneDrive/Google Drive file-per-entry sync architecture
- [docs/adr/0002-electron-desktop-runtime.md](./docs/adr/0002-electron-desktop-runtime.md) — Electron + built-in `node:sqlite` runtime
