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
- **Notion-Style Block Editor & Worldbuilding Collections**: Slash commands (`/`), `[[wikilinks]]` with backlinks, cover art banners, portraits, starter templates (*Characters, Locations, Factions, Items, Timeline*), plus **custom Entity Types** per World with Gallery and Table views.
- **Concept Art Gallery & Lightbox**: Drag-and-drop art uploads, category filtering (*Characters, Environments, Props, Mood, Maps*), fullscreen zoomable lightbox, and bidirectional art-to-lore linking.
- **Per-World Intake Folder Sync**: Link external project folders (e.g., `Brimstone`, `Neon Ash`) where you drop Gemini, ChatGPT, or Claude notes and AI art; Loreloom watches them live, auto-sorts new files into the right categories, and flags ambiguous items for 1-click triage.
- **Non-Destructive Obsidian Vault Importer**: Imports existing Obsidian story vaults (folders, Markdown notes, YAML frontmatter, `[[wikilinks]]`, `#tags`, and `![[embedded images]]`) into a Loreloom World without modifying your original vault.
- **In-App Update Checker**: Check for new releases and download/launch signed upgrades directly from the sidebar.

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
