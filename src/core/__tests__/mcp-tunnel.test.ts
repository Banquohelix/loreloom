import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { normalizeHostname, parseQuickTunnelUrl, startTunnel, type TunnelStatus } from '../../../electron/mcp-tunnel';

/** D9 part 2: the Cloudflare tunnel that gives cloud assistants (Grok Bot, ChatGPT) a public address. */
describe('MCP tunnel', () => {
  it('finds the quick tunnel address in cloudflared output', () => {
    const log = '2026-11-28T10:00:00Z INF |  https://Ash-Sea-Lantern-42.trycloudflare.com                        |\n';
    expect(parseQuickTunnelUrl(log)).toBe('https://ash-sea-lantern-42.trycloudflare.com');
    expect(parseQuickTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull();
  });

  it('normalizes hostnames and rejects junk', () => {
    expect(normalizeHostname('https://MCP.loreloom.io/')).toBe('mcp.loreloom.io');
    expect(normalizeHostname('mcp.loreloom.io/mcp')).toBe('mcp.loreloom.io');
    expect(normalizeHostname('not a host')).toBeNull();
    expect(normalizeHostname('localhost')).toBeNull();
  });

  type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void; killed?: boolean };

  function fakeSpawn() {
    const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    let child: FakeChild | null = null;
    const impl = ((cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
      calls.push({ cmd, args, env: opts.env });
      const c = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => {
          c.killed = true;
        },
      }) as FakeChild;
      child = c;
      return c;
    }) as unknown as typeof import('node:child_process').spawn;
    return { impl, calls, child: () => child as FakeChild };
  }

  it('starts a quick tunnel and reports its public MCP URL', () => {
    const f = fakeSpawn();
    const statuses: TunnelStatus[] = [];
    const t = startTunnel({ cloudflaredPath: 'cloudflared', mode: 'quick', localPort: 47833, onStatus: (s) => statuses.push(s), spawnImpl: f.impl });
    expect(f.calls[0].args).toEqual(['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:47833']);
    f.child().stderr.emit('data', Buffer.from('INF +----+\nINF |  https://quiet-ember.trycloudflare.com  |\n'));
    expect(statuses.at(-1)).toEqual({ running: true, publicUrl: 'https://quiet-ember.trycloudflare.com/mcp', error: null });
    t.stop();
    expect(f.child().killed).toBe(true);
    expect(statuses.at(-1)?.running).toBe(false);
  });

  it('runs a named tunnel with the connector token in the environment, not the command line', () => {
    const f = fakeSpawn();
    const statuses: TunnelStatus[] = [];
    startTunnel({
      cloudflaredPath: 'cloudflared',
      mode: 'named',
      localPort: 47833,
      hostname: 'mcp.loreloom.io',
      connectorToken: 'secret-connector-token',
      onStatus: (s) => statuses.push(s),
      spawnImpl: f.impl,
    });
    expect(f.calls[0].args).toEqual(['tunnel', '--no-autoupdate', 'run']);
    expect(f.calls[0].args.join(' ')).not.toContain('secret-connector-token');
    expect(f.calls[0].env.TUNNEL_TOKEN).toBe('secret-connector-token');
    f.child().stderr.emit('data', Buffer.from('INF Registered tunnel connection connIndex=0 location=lhr01\n'));
    expect(statuses.at(-1)).toEqual({ running: true, publicUrl: 'https://mcp.loreloom.io/mcp', error: null });
  });

  it('explains why the tunnel stopped', () => {
    const f = fakeSpawn();
    const statuses: TunnelStatus[] = [];
    startTunnel({
      cloudflaredPath: 'cloudflared',
      mode: 'named',
      localPort: 1,
      hostname: 'mcp.loreloom.io',
      connectorToken: 'x',
      onStatus: (s) => statuses.push(s),
      spawnImpl: f.impl,
    });
    f.child().stderr.emit('data', Buffer.from('ERR Provided Tunnel token is not valid.\n'));
    f.child().emit('exit', 1);
    expect(statuses.at(-1)?.running).toBe(false);
    expect(statuses.at(-1)?.error).toMatch(/Check the tunnel token/);
  });
});
