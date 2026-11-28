# Loreloom

A clean, Notion-style desktop studio for **worldbuilding notes and concept art**, designed for video games, tabletop RPGs, short stories, novels, and films.

## Install on Any PC (Always Latest Version)

- **Always-Latest Release Page:** [Download Latest Loreloom for Windows](https://github.com/Banquohelix/loreloom/releases/latest)
- **One-Click Direct Installer *(v0.3.1+)*:** [Loreloom-Setup-Latest.exe](https://github.com/Banquohelix/loreloom/releases/latest/download/Loreloom-Setup-Latest.exe)

### Quick Setup on a New PC
1. Sign into GitHub and open the **Download Latest Loreloom for Windows** link above.
2. Download and run **`Loreloom.Setup.*.exe`** (or `Loreloom-Setup-Latest.exe`).
3. *(Optional, once per PC)* Download [LoreloomStudio.cer](./scripts/signing/LoreloomStudio.cer) and run [trust-cert.ps1](./scripts/signing/trust-cert.ps1) so Windows trusts your signed Loreloom releases without SmartScreen prompts.
4. On first launch, select the same synced **OneDrive** or **Google Drive** folder (e.g., `OneDrive\Loreloom`) that you use on your other PCs.

> **Updating later:** Either use **Check for Updates** in Loreloom's bottom-left sidebar, or re-run the latest installer from the link above — it upgrades in place without touching your worlds or settings.

---

## Key Features
- **OneDrive & Google Drive Multi-PC Sync**: Stores every lore entry as a clean Markdown + YAML frontmatter file and keeps concept art in `<world>/assets/`. A machine-local SQLite + FTS5 index (`%APPDATA%/Loreloom/index.db`) stays outside the synced folder to prevent cloud database conflicts.
- **Multi-World Workspaces & Per-World Theming**: Switch between separate settings/IPs in the sidebar. Keep the Studio chrome crisp and minimal while styling each World's canvas with curated presets (*Minimal Studio*, *Parchment Lorebook*, *Sci-Fi Slate*, *Dark Fantasy Ink*, *Botanical Codex*), custom accent colors, typography, and optional editorial drop caps.
- **Notion-Style Block Editor, Clickable `[[Wikilinks]]`, Typed Relationships & Multi-Collection Support**: Slash commands (`/`), `Ctrl+Click` `[[wikilinks]]` with auto-create stubs and backlinks, labeled **Typed Relationships** (*Allied with*, *Controlled by*, *Located in*, etc.), cover art banners, portraits, starter templates (*Characters, Locations, Factions, Items, Timeline*), **custom Entity Types** per World, and **Multi-Collection entries** (`secondaryTypes`).
- **Multi-Tab & Split-Pane Studio**: Open multiple entries/views in tabs and toggle side-by-side **Split View** to write lore next to Maps, Moodboards, Concept Art, or other Entries.
- **Gallery, Table, Kanban Board & Visual Timeline Views**: Switch any Collection between visual Gallery cards, sortable Tables, drag-and-drop **Kanban Boards** grouped by status/category, and chronological **Visual Timelines** grouped by Era.
- **Interactive Lore Graph**: Force-directed relationship map of your World's `[[wikilinks]]` and labeled Typed Relationships with zoom/pan, node dragging, hover neighbor highlighting, Collection filters, and 1-click navigation.
- **Interactive World & City Pin Maps**: Turn any Concept Art map into a zoomable/pannable pin map (`maps.yaml`), drop color-coded pins linked directly to Locations or Entries, and jump straight to their lore pages.
- **Visual Moodboards / Reference Canvases**: PureRef/Milanote-style zoomable pinboards (`boards.yaml`) for arranging Concept Art cards, Sticky Notes, and Color Palette Swatches side-by-side with drag-and-drop image support.
- **Illustrated World Bible Export (PDF & HTML) + `.zip` Snapshots**: Export any World as a print-ready **PDF** or portable single-file **HTML Wiki** styled with your World Theme and embedded concept art, or save a 1-click `.zip` backup snapshot.
- **Concept Art Gallery, Lightbox & Auto-Linker**: Drag-and-drop art uploads, category filtering (*Characters, Environments, Props, Mood, Maps*), fullscreen zoomable lightbox, bidirectional art-to-lore linking, plus a **World Cleanup & Auto-Link** tool to safely merge duplicate entries and auto-attach matching concept art.
- **Per-World Intake Folder Sync & AI Prompt Framework**: Link external project folders (e.g., `Brimstone`, `Neon Ash`) where you drop Gemini, ChatGPT, or Claude notes and AI art; Loreloom watches them live, auto-sorts new files into the right categories, includes a dynamic per-World **AI Prompt Framework** generator, and offers **Re-run Auto-Sorter** + **Bulk Triage** for ambiguous items.
- **Non-Destructive Obsidian Vault Importer**: Imports existing Obsidian story vaults (folders, Markdown notes, YAML frontmatter with synonym normalization, `[[wikilinks]]`, `#tags`, and `![[embedded images]]`) into a Loreloom World without modifying your original vault.
- **Command Palette (`Ctrl+K`), Custom Desktop Icon & In-App Updates**: Search across all Worlds or run any Studio action from `Ctrl+K`, and check/install signed upgrades directly from the sidebar (`v0.6.11`).

## Development Commands

```bash
# Run in desktop development mode (Vite + Electron)
pnpm run dev:electron

# Run unit & integration tests
pnpm test

# Production build (TypeScript + Vite + Electron main)
pnpm run build

# Build Windows installer (.exe) & portable build locally
pnpm run package
```

## Architecture & Docs
- [GLOSSARY.md](./GLOSSARY.md) — Canonical domain vocabulary
- [docs/adr/0001-file-per-entry-sync-with-local-sqlite-index.md](./docs/adr/0001-file-per-entry-sync-with-local-sqlite-index.md) — OneDrive/Google Drive file-per-entry sync architecture
- [docs/adr/0002-electron-desktop-runtime.md](./docs/adr/0002-electron-desktop-runtime.md) — Electron + built-in `node:sqlite` runtime
- [scripts/signing/README.md](./scripts/signing/README.md) — Self-signed Windows code-signing guide
