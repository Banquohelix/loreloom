import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Remote access for AI assistants that run in the cloud (Grok Bot's sandbox, ChatGPT): Loreloom
 * runs Cloudflare's `cloudflared`, which makes an outbound-only tunnel from this PC to Cloudflare
 * and gives the local MCP endpoint a public HTTPS address. No router ports are opened.
 *
 * - quick: `cloudflared tunnel --url http://127.0.0.1:<port>`, a random *.trycloudflare.com
 *   address with no Cloudflare account (it changes every time the tunnel starts)
 * - named: `cloudflared tunnel run --token <connector token>` for a tunnel the user created in
 *   Cloudflare with a fixed hostname such as mcp.loreloom.io
 */

export type TunnelMode = 'quick' | 'named';

export interface TunnelStatus {
  running: boolean;
  publicUrl: string | null;
  error: string | null;
}

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Finds the trycloudflare.com address in cloudflared's log output. */
export function parseQuickTunnelUrl(text: string): string | null {
  const m = QUICK_URL.exec(text);
  return m ? m[0].toLowerCase() : null;
}

/** `mcp.loreloom.io`, `https://mcp.loreloom.io/` → `mcp.loreloom.io` (null if not a hostname). */
export function normalizeHostname(input: string): string | null {
  const host = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
}

/** Looks for cloudflared on PATH and in the usual Windows install locations (winget, MSI). */
export async function findCloudflared(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const candidates: string[] = [];
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (dir.trim()) candidates.push(path.join(dir.trim(), exe));
  }
  if (process.platform === 'win32') {
    const local = env.LOCALAPPDATA ?? '';
    candidates.push(
      path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'cloudflared', exe),
      path.join(env.ProgramFiles ?? 'C:\\Program Files', 'cloudflared', exe),
      path.join(local, 'Microsoft', 'WinGet', 'Links', exe)
    );
  }
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

export interface TunnelOptions {
  cloudflaredPath: string;
  mode: TunnelMode;
  localPort: number;
  /** named mode: the public hostname routed to http://127.0.0.1:<port> */
  hostname?: string;
  /** named mode: the tunnel's connector token from the Cloudflare dashboard */
  connectorToken?: string;
  onStatus: (status: TunnelStatus) => void;
  /** Injectable for tests */
  spawnImpl?: typeof spawn;
}

export interface RunningTunnel {
  stop: () => void;
}

/** Starts cloudflared and reports the public URL (or why it failed) through onStatus. */
export function startTunnel(options: TunnelOptions): RunningTunnel {
  const run = options.spawnImpl ?? spawn;
  const args =
    options.mode === 'quick'
      ? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${options.localPort}`]
      : ['tunnel', '--no-autoupdate', 'run'];
  // The connector token goes in the environment, not the command line, so other programs can't read it
  const env = { ...process.env, ...(options.mode === 'named' ? { TUNNEL_TOKEN: options.connectorToken ?? '' } : {}) };
  let child: ChildProcess | null = null;
  let stopped = false;
  let reported: TunnelStatus = { running: false, publicUrl: null, error: null };
  const report = (next: Partial<TunnelStatus>) => {
    reported = { ...reported, ...next };
    options.onStatus(reported);
  };

  try {
    child = run(options.cloudflaredPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    report({ running: false, error: `Could not start cloudflared: ${(err as Error).message}` });
    return { stop: () => {} };
  }

  let log = '';
  const onOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    log = (log + text).slice(-8000);
    if (options.mode === 'quick' && !reported.publicUrl) {
      const url = parseQuickTunnelUrl(log);
      if (url) report({ running: true, publicUrl: `${url}/mcp`, error: null });
    }
    if (options.mode === 'named' && !reported.running && /Registered tunnel connection/i.test(log)) {
      report({ running: true, publicUrl: `https://${options.hostname}/mcp`, error: null });
    }
  };
  child.stdout?.on('data', onOutput);
  child.stderr?.on('data', onOutput);
  child.on('error', (err) => report({ running: false, publicUrl: null, error: `cloudflared failed: ${err.message}` }));
  child.on('exit', (code) => {
    if (stopped) return;
    const lastLine = log.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
    const hint = /token|unauthori[sz]ed|invalid/i.test(log)
      ? ' Check the tunnel token in Cloudflare.'
      : /429|rate/i.test(log)
        ? ' Cloudflare is limiting quick tunnels right now; try again in a few minutes.'
        : '';
    report({ running: false, publicUrl: null, error: `The tunnel stopped (exit ${code ?? '?'}).${hint}${lastLine ? ` Last message: ${lastLine.slice(0, 200)}` : ''}` });
  });

  return {
    stop: () => {
      stopped = true;
      child?.kill();
      report({ running: false, publicUrl: null, error: null });
    },
  };
}
