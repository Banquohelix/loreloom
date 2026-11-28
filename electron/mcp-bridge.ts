/**
 * Loreloom MCP stdio bridge, for MCP clients that only launch local commands (Claude Desktop).
 *
 * Loreloom copies this file to %APPDATA%\Loreloom\mcp\loreloom-mcp-bridge.js and the client runs:
 *   Loreloom.exe <that file>   with ELECTRON_RUN_AS_NODE=1, LORELOOM_MCP_URL and LORELOOM_MCP_TOKEN
 * It forwards JSON-RPC lines from stdin to Loreloom's local HTTP endpoint and writes the replies to
 * stdout. It uses only Node built-ins, so it runs without node_modules.
 */
import readline from 'node:readline';

const url = process.env.LORELOOM_MCP_URL || 'http://127.0.0.1:7766/mcp';
const token = process.env.LORELOOM_MCP_TOKEN || '';

type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; [k: string]: unknown };

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorFor(msg: JsonRpc, text: string): void {
  if (msg.id === undefined || msg.id === null) return; // notifications get no reply
  write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: text } });
}

/** Replies may be plain JSON or a short SSE stream of `data:` events. */
function parseReply(contentType: string, text: string): unknown[] {
  if (!text.trim()) return [];
  if (contentType.includes('text/event-stream')) {
    return text
      .split(/\r?\n\r?\n/)
      .map((event) =>
        event
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('')
      )
      .filter(Boolean)
      .map((d) => JSON.parse(d));
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function forward(msg: JsonRpc): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'loreloom-mcp-bridge',
      },
      body: JSON.stringify(msg),
    });
    const text = await res.text();
    if (!res.ok && res.status !== 202) {
      let detail = text;
      try {
        detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
      } catch {
        // keep raw text
      }
      errorFor(msg, `Loreloom: ${detail || `HTTP ${res.status}`}`);
      return;
    }
    for (const reply of parseReply(res.headers.get('content-type') ?? '', text)) write(reply);
  } catch {
    errorFor(msg, 'Loreloom is not running, or AI assistant access is turned off in Loreloom → AI Assistants.');
  }
}

const rl = readline.createInterface({ input: process.stdin });
let queue: Promise<void> = Promise.resolve();
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: JsonRpc;
  try {
    msg = JSON.parse(trimmed) as JsonRpc;
  } catch {
    return;
  }
  // Keep replies in request order
  queue = queue.then(() => forward(msg));
});
rl.on('close', () => {
  void queue.then(() => process.exit(0));
});
