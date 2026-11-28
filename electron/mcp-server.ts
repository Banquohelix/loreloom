import http from 'node:http';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LORELOOM_TOOLS, runLoreloomTool, type McpToolContext } from '../src/core/mcp-tools';

/** Largest request accepted: a 25 MB image as base64 plus JSON overhead. */
const MAX_BODY_BYTES = 40 * 1024 * 1024;

const INSTRUCTIONS = [
  "Loreloom is the user's worldbuilding studio. Each World is a story vault of Markdown entries (characters, locations, factions, …), concept art and maps, stored in the user's own cloud folder.",
  'Start with list_worlds and get_world_schema, and search_lore before creating an entry, so you add to existing lore instead of duplicating it.',
  'Write Markdown. Link entries with [[Entry Title]]. Use Obsidian callouts for lore notes: > [!canon] Title, > [!rumor], > [!secret] (GM only), > [!spoiler]- Title (collapsed).',
  'Prefer update_entry with append over replacing bodies. New entries may be tagged needs-triage for the user to review.',
].join('\n');

/** Who may connect. Read on every request, so tokens and tunnel hosts can change without a restart. */
export interface McpAuth {
  /** Token for MCP apps on this PC */
  localToken: string;
  /** Token for remote assistants through the tunnel; null = remote access off */
  remoteToken: string | null;
  /** Public hostnames of the running tunnel, e.g. abc.trycloudflare.com or mcp.loreloom.io */
  remoteHosts: string[];
}

export interface LoreloomMcpServerOptions {
  port: number;
  auth: () => McpAuth;
  version: string;
  /** Builds the tool context for one request (current store, index and settings). */
  context: (clientName: string | undefined) => McpToolContext | null;
}

export interface RunningMcpServer {
  url: string;
  close: () => Promise<void>;
}

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Remote callers that keep sending wrong tokens are blocked for a while. */
const LOCKOUT_FAILURES = 10;
const LOCKOUT_WINDOW_MS = 10 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

export class FailedAuthLimiter {
  private readonly failures = new Map<string, { count: number; first: number; blockedUntil: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  isBlocked(key: string): boolean {
    const f = this.failures.get(key);
    return Boolean(f && f.blockedUntil > this.now());
  }

  recordFailure(key: string): void {
    const t = this.now();
    const f = this.failures.get(key);
    if (!f || t - f.first > LOCKOUT_WINDOW_MS) {
      this.failures.set(key, { count: 1, first: t, blockedUntil: 0 });
      return;
    }
    f.count++;
    if (f.count >= LOCKOUT_FAILURES) f.blockedUntil = t + LOCKOUT_MS;
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}

export type AuthDecision = { ok: true; remote: boolean } | { ok: false; status: number; message: string; remote: boolean };

/**
 * Decides whether a request may use the MCP endpoint. Local requests (Host 127.0.0.1/localhost,
 * no Cloudflare headers) need the local token. Requests that came through the tunnel need the
 * remote token, must be addressed to the tunnel's hostname, and are rate-limited on failures.
 */
export function authorizeMcpRequest(
  headers: http.IncomingHttpHeaders,
  port: number,
  auth: McpAuth,
  limiter: FailedAuthLimiter
): AuthDecision {
  const host = String(headers.host ?? '').toLowerCase();
  const loopback = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  const viaCloudflare = Boolean(headers['cf-connecting-ip'] || headers['cf-ray']);
  const remote = !loopback || viaCloudflare;
  if (headers.origin) return { ok: false, status: 403, message: 'Browser requests are not allowed', remote };
  const header = String(headers.authorization ?? '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!remote) {
    return token && tokensMatch(token, auth.localToken)
      ? { ok: true, remote }
      : { ok: false, status: 401, message: 'Missing or wrong Loreloom token', remote };
  }

  const hostname = host.replace(/:\d+$/, '');
  if (!auth.remoteToken) return { ok: false, status: 403, message: 'Remote access is turned off in Loreloom', remote };
  // cloudflared normally keeps the public Host; accept a loopback Host too in case it rewrites it.
  // Either way the remote token is still required below.
  if (!loopback && !auth.remoteHosts.includes(hostname)) return { ok: false, status: 403, message: 'Forbidden host', remote };
  const key = `remote:${String(headers['cf-connecting-ip'] ?? 'unknown')}`;
  if (limiter.isBlocked(key)) return { ok: false, status: 429, message: 'Too many wrong tokens. Try again later.', remote };
  if (!token || !tokensMatch(token, auth.remoteToken)) {
    limiter.recordFailure(key);
    return { ok: false, status: 401, message: 'Missing or wrong Loreloom remote token', remote };
  }
  limiter.recordSuccess(key);
  return { ok: true, remote };
}

function deny(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** One MCP server per request (stateless Streamable HTTP), with Loreloom's tools registered. */
function buildMcpServer(options: LoreloomMcpServerOptions, ctx: McpToolContext): McpServer {
  const server = new McpServer({ name: 'loreloom', title: 'Loreloom', version: options.version }, { instructions: INSTRUCTIONS });
  for (const tool of LORELOOM_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        const result = await runLoreloomTool(ctx, tool.name, args);
        const content: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: result.text }];
        if (result.data !== undefined && !result.isError) content.push({ type: 'text', text: JSON.stringify(result.data) });
        return { content, isError: result.isError };
      }
    );
  }
  return server;
}

/**
 * Starts Loreloom's MCP endpoint at http://127.0.0.1:<port>/mcp. It listens on this PC only;
 * remote assistants reach it through the Cloudflare tunnel (see mcp-tunnel.ts) with a separate
 * token. Browser requests (an Origin header) are always refused so a web page can't talk to it.
 */
export function startLoreloomMcpServer(options: LoreloomMcpServerOptions): Promise<RunningMcpServer> {
  const limiter = new FailedAuthLimiter();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/mcp') return deny(res, 404, 'Not found. The Loreloom MCP endpoint is /mcp.');
      const decision = authorizeMcpRequest(req.headers, options.port, options.auth(), limiter);
      if (!decision.ok) return deny(res, decision.status, decision.message);

      const ua = String(req.headers['user-agent'] ?? '');
      const clientName = ua.split(/[\s/]/)[0] || undefined;
      const ctx = options.context(clientName);
      if (!ctx) return deny(res, 503, 'Open a Loreloom workspace first');

      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const mcp = buildMcpServer(options, ctx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) deny(res, 400, err instanceof Error ? err.message : 'Bad request');
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({
        url: `http://127.0.0.1:${options.port}/mcp`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

export function generateMcpToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
