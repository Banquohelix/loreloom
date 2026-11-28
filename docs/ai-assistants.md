# AI assistants (MCP)

Loreloom can let AI assistants work in your Worlds alongside you: search and read lore, write new characters and places, link entries, save concept art they generate, and build pinned maps. It uses the Model Context Protocol (MCP). Supported setups: **Claude Code, Claude Desktop, Cursor, OpenCode, Grok Bot and Grok Build** today, **ChatGPT** with remote access (next update).

## Turn it on

**Sidebar → AI Assistants** (or Ctrl+K → "AI Assistants").

1. Tick **Allow AI assistants to connect**. Loreloom starts a local MCP server at `http://127.0.0.1:47833/mcp`. You can change the port.
2. Pick your assistant's tab and copy the setup:
   - **Claude Code:** run the `claude mcp add …` command once in a terminal.
   - **Claude Desktop:** paste the JSON into `claude_desktop_config.json` (Settings → Developer → Edit Config) and restart Claude. It runs a small bridge with Loreloom's own executable, so you don't need Node.js. Use the installed version of Loreloom, not the portable one, whose path changes each launch.
   - **Cursor:** add the JSON to `%USERPROFILE%\.cursor\mcp.json` (global, so the token stays out of your repos) and restart Cursor.
   - **OpenCode:** merge the JSON into `%USERPROFILE%\.config\opencode\opencode.json`. `oauth` is off because Loreloom uses the token.
   - **Grok Bot** (the desktop app): Grok Bot runs MCP tools on its own cloud computer, so it needs **Remote access** (below). Then add a custom MCP server with transport **HTTP**, the remote address, and a header `Authorization: Bearer <remote token>`.
   - **Grok Build** (the command-line agent): run the `grok mcp add --transport http …` command, then `grok mcp doctor loreloom`.
   - **Other MCP apps on this PC:** use the server URL plus the `Authorization: Bearer <token>` header.
3. Keep Loreloom open while the assistant works.

## Remote access (Grok Bot, ChatGPT)

Assistants that run in the cloud can't reach a server that only listens on your PC. **Remote access** gives Loreloom a private HTTPS address through a Cloudflare tunnel: Cloudflare's `cloudflared` makes an outbound connection from your PC, so no router ports are opened.

1. Install cloudflared once: `winget install --id Cloudflare.cloudflared`
2. In AI Assistants, turn on **Remote access** and choose:
   - **Quick address:** a random `*.trycloudflare.com` address with no account. It changes every time remote access starts, so you'll update the URL in Grok Bot each time.
   - **My own domain:** a fixed address such as `mcp.loreloom.io`. In Cloudflare (Zero Trust → Networks → Tunnels), create a tunnel, add a public hostname pointing to `http://127.0.0.1:47833`, and paste the tunnel's token into Loreloom. The token is stored encrypted.
3. Use the **Grok Bot** tab's address and header.

Remote assistants use a **separate remote token**, so you can revoke it (**New remote token**) without breaking the apps on your PC. The local token doesn't work remotely and vice versa. Requests must arrive through the tunnel's hostname. A caller who sends 10 wrong tokens is locked out for 15 minutes. Remote access stops when Loreloom closes.

ChatGPT's connectors sign in with OAuth rather than a header; that sign-in is planned next.

## Safety

- **Local by default.** The server listens on 127.0.0.1, needs the secret token on every request, and refuses browser requests, so a web page can't reach it. Remote access is off until you turn it on.
- **There are no delete tools.** Assistants can create and change things, but not remove them.
- **Allow changes** off makes it read-only.
- **Mark AI additions for review** (on by default) tags new entries and art `needs-triage`, so they show up in Intake Folder Sync.
- **Edits are careful.** Assistants are steered to *append*. Replacing a whole entry needs the `updatedAt` value they last read, so a newer edit (yours, or one from another PC) is never overwritten silently.
- **Everything goes through the same save path as the editor:** atomic writes, OneDrive conflict copies, and Trash.
- **New token** makes a fresh token; assistants set up with the old one stop working.

## Tools

| Tool | What it does |
|---|---|
| `list_worlds`, `get_world_schema` | Worlds, entity types, their fields and templates |
| `search_lore`, `list_entries`, `read_entry` | Find and read lore, with properties, relationships and backlinks |
| `create_entry` | New entry with Markdown, tags, properties, optionally from a template |
| `update_entry` | Append text, change title, tags and properties, or replace the body (with `expected_updated_at`) |
| `add_relationship` | Labelled link between two entries (shown in the graph) |
| `list_concept_art`, `save_concept_art` | Save an image (base64 or a public https URL) with a caption and tags; attach as cover, portrait or inline |
| `list_maps`, `create_map`, `add_map_pin` | Build interactive maps from gallery images and pin places, linked to entries |
