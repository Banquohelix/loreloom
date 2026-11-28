import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WorkspaceStore } from '../workspace-store';
import { IndexEngine } from '../index-engine';
import { startLoreloomMcpServer, type RunningMcpServer } from '../../../electron/mcp-server';

/** D9: the MCP endpoint end to end, with a real MCP client, plus the Claude Desktop stdio bridge. */
describe('Loreloom MCP server', () => {
  const token = 'test-token-0123456789';
  const port = 47000 + Math.floor(Math.random() * 900);
  let tmpDir: string;
  let store: WorkspaceStore;
  let index: IndexEngine;
  let server: RunningMcpServer;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loreloom-mcp-srv-'));
    store = new WorkspaceStore(tmpDir);
    await store.ensureInitialized();
    const world = await store.createWorld({ name: 'Neon Ash', medium: 'video-game' });
    await store.createEntry({ worldSlug: world.slug, title: 'Rook', type: 'character', body: 'A courier in the undercity.' });
    index = new IndexEngine(':memory:');
    await index.rebuildWorkspace(store);
    server = await startLoreloomMcpServer({
      port,
      token,
      version: 'test',
      context: () => ({ store, index, allowWrites: true, markDrafts: false }),
    });
  });

  afterAll(async () => {
    await server.close();
    index.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('serves the tools to an MCP client, with read-only hints', async () => {
    const client = new Client({ name: 'vitest', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['search_lore', 'read_entry', 'create_entry', 'update_entry', 'save_concept_art', 'create_map', 'add_map_pin'])
    );
    expect(tools.find((t) => t.name === 'search_lore')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'create_entry')?.annotations?.readOnlyHint).toBe(false);

    const result = await client.callTool({ name: 'search_lore', arguments: { query: 'courier' } });
    expect(JSON.stringify(result.content)).toContain('Rook');
    const created = await client.callTool({ name: 'create_entry', arguments: { title: 'Mara Vex', type: 'character', body: 'Fixer.' } });
    expect(created.isError).toBeFalsy();
    expect(index.queryCollection({ worldSlug: 'neon-ash' }).map((e) => e.title)).toContain('Mara Vex');
    await client.close();
  });

  it('refuses requests without the token, from browsers, and to other hosts', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const post = (headers: Record<string, string>) =>
      fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(init),
      });
    expect((await post({})).status).toBe(401);
    expect((await post({ Authorization: 'Bearer wrong-token-0123456789' })).status).toBe(401);
    expect((await post({ Authorization: `Bearer ${token}`, Origin: 'https://evil.example' })).status).toBe(403);
    const otherPath = await fetch(server.url.replace('/mcp', '/other'), { headers: { Authorization: `Bearer ${token}` } });
    expect(otherPath.status).toBe(404);
  });

  it('bridges stdio to the endpoint for Claude Desktop', async () => {
    const bridge = spawn(process.execPath, [path.resolve(__dirname, '../../../electron/mcp-bridge.ts')], {
      env: { ...process.env, LORELOOM_MCP_URL: server.url, LORELOOM_MCP_TOKEN: token },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    let buffer = '';
    bridge.stdout.on('data', (d) => {
      buffer += d.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      lines.push(...parts.filter(Boolean));
    });
    const send = (m: unknown) => bridge.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-desktop-test', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_entry', arguments: { entry: 'Rook' } } });
    for (let i = 0; i < 100 && lines.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    bridge.stdin.end();
    const replies = lines.map((l) => JSON.parse(l));
    expect(replies.find((r) => r.id === 1)?.result?.serverInfo?.name).toBe('loreloom');
    expect(JSON.stringify(replies.find((r) => r.id === 2)?.result)).toContain('A courier in the undercity.');
  });
});
