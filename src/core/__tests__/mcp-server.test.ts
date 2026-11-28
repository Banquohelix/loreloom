import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WorkspaceStore } from '../workspace-store';
import { IndexEngine } from '../index-engine';
import { FailedAuthLimiter, startLoreloomMcpServer, type McpAuth, type RunningMcpServer } from '../../../electron/mcp-server';

/** D9: the MCP endpoint end to end, with a real MCP client, plus the Claude Desktop stdio bridge. */
describe('Loreloom MCP server', () => {
  const token = 'test-token-0123456789';
  const port = 47000 + Math.floor(Math.random() * 900);
  let tmpDir: string;
  let store: WorkspaceStore;
  let index: IndexEngine;
  let server: RunningMcpServer;
  const auth: McpAuth = { localToken: token, remoteToken: null, remoteHosts: [] };

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
      auth: () => auth,
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

  it.each([
    ['environment variables (Claude Desktop)', [] as string[], { LORELOOM_MCP_URL: '', LORELOOM_MCP_TOKEN: '' }],
    ['--url/--token arguments (Grok Bot STDIO)', ['--url', '', '--token', ''], {}],
  ])('bridges stdio to the endpoint via %s', async (_label, argTemplate, envTemplate) => {
    const args = argTemplate.length ? ['--url', server.url, '--token', token] : [];
    const env = Object.keys(envTemplate).length ? { LORELOOM_MCP_URL: server.url, LORELOOM_MCP_TOKEN: token } : {};
    const cleanEnv = { ...process.env };
    delete cleanEnv.LORELOOM_MCP_URL;
    delete cleanEnv.LORELOOM_MCP_TOKEN;
    const bridge = spawn(process.execPath, [path.resolve(__dirname, '../../../electron/mcp-bridge.ts'), ...args], {
      env: { ...cleanEnv, ...env },
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
  it('lets remote assistants in only through the tunnel host with the remote token', async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    // fetch() can't set Host, so send it the way cloudflared does
    const remoteFetch = (tokenValue: string, host = 'ash-sea.trycloudflare.com') =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/mcp',
            method: 'POST',
            headers: {
              Host: host,
              'Cf-Connecting-Ip': '203.0.113.7',
              'Cf-Ray': 'abc123',
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              Authorization: `Bearer ${tokenValue}`,
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          }
        );
        req.on('error', reject);
        req.end(JSON.stringify(list));
      });

    // Remote access off: refused even with the local token
    expect(await remoteFetch(token)).toBe(403);

    auth.remoteToken = 'remote-token-abcdefghijkl';
    auth.remoteHosts = ['ash-sea.trycloudflare.com'];
    expect(await remoteFetch('remote-token-abcdefghijkl')).toBe(200);
    expect(await remoteFetch(token)).toBe(401); // the local token doesn't work remotely
    expect(await remoteFetch('remote-token-abcdefghijkl', 'evil.example.com')).toBe(403);
    // Locally, the remote token isn't accepted either
    const local = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer remote-token-abcdefghijkl' },
      body: JSON.stringify(list),
    });
    expect(local.status).toBe(401);
    auth.remoteToken = null;
    auth.remoteHosts = [];
  });

  it('locks out a remote caller after repeated wrong tokens', () => {
    let now = 1_000_000;
    const limiter = new FailedAuthLimiter(() => now);
    for (let i = 0; i < 9; i++) limiter.recordFailure('remote:1.2.3.4');
    expect(limiter.isBlocked('remote:1.2.3.4')).toBe(false);
    limiter.recordFailure('remote:1.2.3.4');
    expect(limiter.isBlocked('remote:1.2.3.4')).toBe(true);
    expect(limiter.isBlocked('remote:5.6.7.8')).toBe(false);
    now += 16 * 60_000;
    expect(limiter.isBlocked('remote:1.2.3.4')).toBe(false);
  });
});
