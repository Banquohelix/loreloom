# ADR 0002: Electron Desktop Runtime with Built-in `node:sqlite`

## Status
Accepted

## Context
Loreloom needs native local filesystem access to read/write the user's OneDrive/Google Drive sync folder, watch external sync updates, and import Obsidian vaults, while packaging cleanly as a Windows desktop installer. The development environment has Node 24 and pnpm installed, without a Rust/Cargo toolchain.

## Decision
Use Electron (v35+) with Vite, React, TypeScript, and Tailwind CSS, and use Node's built-in `node:sqlite` (`DatabaseSync` with FTS5) for the machine-local `LocalIndex`.

## Consequences
- **Positive**: Zero native C++ module compilation (`node-gyp`/`MSVC`) or Rust toolchain required on Windows.
- **Positive**: All core domain modules (`WorkspaceStore`, `IndexEngine`, `ObsidianImporter`, `ThemeEngine`) are pure Node/TypeScript and run directly under Vitest without Electron.
- **Negative**: Larger desktop binary footprint compared to Tauri (~80–120 MB), acceptable for a desktop creative studio.
