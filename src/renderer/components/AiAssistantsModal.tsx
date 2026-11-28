import { useEffect, useState } from 'react';
import { Bot, Check, Copy, Eye, EyeOff, RefreshCw, X } from 'lucide-react';
import type { McpStatus } from '@shared/types';
import { getBridge } from '../lib/bridge';
import { useModalA11y } from '../lib/use-modal-a11y';
import { notifyError } from '../lib/notify';

function CopyBlock({ label, value, secret }: { label: string; value: string; secret?: string }) {
  const [copied, setCopied] = useState(false);
  const shown = secret ? value.split(secret).join('••••••••') : value;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[var(--studio-muted)]">{label}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all rounded-lg border border-[var(--studio-border)] bg-black/5 dark:bg-white/5 p-2.5 font-mono">
        {shown}
      </pre>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-3.5 h-3.5 accent-[var(--world-accent)]" />
      <span>
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[11px] text-[var(--studio-muted)]">{hint}</span>
      </span>
    </label>
  );
}

type ClientTab = 'claude-code' | 'claude-desktop' | 'cursor' | 'opencode' | 'grok-bot' | 'grok' | 'chatgpt' | 'other';

const CLIENT_TABS: Array<[ClientTab, string]> = [
  ['claude-code', 'Claude Code'],
  ['claude-desktop', 'Claude Desktop'],
  ['cursor', 'Cursor'],
  ['opencode', 'OpenCode'],
  ['grok-bot', 'Grok Bot'],
  ['grok', 'Grok Build'],
  ['chatgpt', 'ChatGPT'],
  ['other', 'Other'],
];

/** Connect Claude, Cursor, OpenCode, Grok Build, ChatGPT and other MCP clients to this workspace. */
export function AiAssistantsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);
  const bridge = getBridge();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [portDraft, setPortDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [tab, setTab] = useState<ClientTab>('claude-code');

  useEffect(() => {
    bridge
      .getMcpStatus()
      .then((s) => {
        setStatus(s);
        setPortDraft(String(s.port));
      })
      .catch((err) => notifyError('Could not read AI assistant settings', err));
  }, [bridge]);

  // The tunnel reports its public address (or an error) a few seconds after it starts
  useEffect(
    () =>
      bridge.onMcpStatusChanged(() => {
        bridge.getMcpStatus().then(setStatus).catch(() => {});
      }),
    [bridge]
  );

  const updateRemote = async (patch: Parameters<typeof bridge.updateMcpRemote>[0]) => {
    try {
      setStatus(await bridge.updateMcpRemote(patch));
    } catch (err) {
      notifyError('Could not change remote access', err);
    }
  };

  const update = async (patch: Parameters<typeof bridge.updateMcpSettings>[0]) => {
    try {
      const s = await bridge.updateMcpSettings(patch);
      setStatus(s);
      setPortDraft(String(s.port));
    } catch (err) {
      notifyError('Could not change AI assistant settings', err);
    }
  };

  const cursorConfig = status
    ? JSON.stringify({ mcpServers: { loreloom: { url: status.url, headers: { Authorization: `Bearer ${status.token}` } } } }, null, 2)
    : '';
  const opencodeConfig = status
    ? JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: { loreloom: { type: 'remote', url: status.url, oauth: false, headers: { Authorization: `Bearer ${status.token}` }, enabled: true } },
        },
        null,
        2
      )
    : '';

  const desktopConfig = status
    ? JSON.stringify(
        {
          mcpServers: {
            loreloom: {
              command: status.execPath,
              args: [status.bridgePath],
              env: { ELECTRON_RUN_AS_NODE: '1', LORELOOM_MCP_URL: status.url, LORELOOM_MCP_TOKEN: status.token },
            },
          },
        },
        null,
        2
      )
    : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="AI assistants"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-w-2xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-4 max-h-[88vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <Bot className="w-5 h-5 text-[var(--world-accent)]" />
            <div>
              <h2 className="text-base font-semibold">AI Assistants</h2>
              <p className="text-xs text-[var(--studio-muted)]">
                Let Claude, Cursor, OpenCode, Grok Build and ChatGPT search, write lore, save concept art and pin maps in your Worlds.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!status ? (
          <p className="text-xs text-[var(--studio-muted)]">Loading…</p>
        ) : (
          <>
            <div className="rounded-xl border border-[var(--studio-border)] p-3.5 space-y-3">
              <Toggle
                label="Allow AI assistants to connect"
                hint="Runs a local MCP server that only this PC can reach. Each assistant needs the secret token below."
                checked={status.enabled}
                onChange={(v) => update({ enabled: v })}
              />
              <Toggle
                label="Allow changes"
                hint="Create and update entries, relationships, concept art and map pins. Off = read and search only. Nothing can be deleted either way."
                checked={status.allowWrites}
                onChange={(v) => update({ allowWrites: v })}
              />
              <Toggle
                label="Mark AI additions for review"
                hint="Tags new entries and art needs-triage, so they show up in Intake Folder Sync for you to check."
                checked={status.markDrafts}
                onChange={(v) => update({ markDrafts: v })}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${
                    status.running ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-black/5 dark:bg-white/10 text-[var(--studio-muted)]'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${status.running ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                  {status.running ? `Running at ${status.url}` : status.enabled ? 'Not running' : 'Off'}
                </span>
                <label className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[var(--studio-muted)]">Port</span>
                  <input
                    value={portDraft}
                    onChange={(e) => setPortDraft(e.target.value.replace(/\D/g, ''))}
                    onBlur={() => Number(portDraft) !== status.port && update({ port: Number(portDraft) })}
                    aria-label="Port"
                    className="w-20 rounded-md border border-[var(--studio-border)] bg-transparent px-2 py-1 text-xs outline-none"
                  />
                </label>
              </div>
              {status.error && <p className="text-xs text-red-600 dark:text-red-400">{status.error}</p>}
            </div>

            {status.enabled && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">Secret token</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setReveal((r) => !r)}
                      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {reveal ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Make a new token? Assistants set up with the old one will stop working until you update them.')) return;
                        try {
                          setStatus(await bridge.regenerateMcpToken());
                        } catch (err) {
                          notifyError('Could not make a new token', err);
                        }
                      }}
                      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" /> New token
                    </button>
                  </div>
                </div>

                <div role="tablist" aria-label="Assistant" className="flex flex-wrap gap-1.5">
                  {CLIENT_TABS.map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                        tab === id ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tab === 'claude-code' && (
                  <CopyBlock
                    label="Run once in a terminal"
                    value={`claude mcp add --transport http --scope user loreloom ${status.url} --header "Authorization: Bearer ${status.token}"`}
                    secret={reveal ? undefined : status.token}
                  />
                )}
                {tab === 'claude-desktop' && (
                  <div className="space-y-2">
                    <CopyBlock label="Add to claude_desktop_config.json (Settings → Developer → Edit Config), then restart Claude" value={desktopConfig} secret={reveal ? undefined : status.token} />
                    {status.portable && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        You're running the portable build, which starts from a different temporary folder each time, so this path will stop
                        working. Use the installed version of Loreloom for Claude Desktop.
                      </p>
                    )}
                  </div>
                )}
                {tab === 'cursor' && (
                  <div className="space-y-2">
                    <CopyBlock
                      label="Add to %USERPROFILE%\.cursor\mcp.json (global, keeps the token out of your repos), then restart Cursor"
                      value={cursorConfig}
                      secret={reveal ? undefined : status.token}
                    />
                    <p className="text-[11px] text-[var(--studio-muted)]">If the file already has servers, add the "loreloom" entry inside its mcpServers.</p>
                  </div>
                )}
                {tab === 'opencode' && (
                  <div className="space-y-2">
                    <CopyBlock
                      label="Add to %USERPROFILE%\.config\opencode\opencode.json (global config)"
                      value={opencodeConfig}
                      secret={reveal ? undefined : status.token}
                    />
                    <p className="text-[11px] text-[var(--studio-muted)]">
                      Merge the "loreloom" entry into the file's existing mcp section. oauth is off because Loreloom uses the token instead.
                    </p>
                  </div>
                )}
                {tab === 'grok-bot' &&
                  (status.remote.running && status.remote.publicUrl ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-[var(--studio-muted)]">
                        Grok Bot runs MCP tools on its own cloud computer, so it connects through your remote address. In Grok Bot, add a
                        custom MCP server:
                      </p>
                      <CopyBlock label="Name" value="loreloom" />
                      <CopyBlock label="Transport" value="HTTP" />
                      <CopyBlock label="Server URL" value={status.remote.publicUrl} />
                      <CopyBlock label="Header name" value="Authorization" />
                      <CopyBlock label="Header value" value={`Bearer ${status.remote.token}`} secret={reveal ? undefined : status.remote.token} />
                      {status.remote.mode === 'quick' && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          Quick addresses change each time remote access restarts (including when Loreloom restarts), so you'll need to update
                          the URL in Grok Bot. Use your own domain for an address that never changes.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--studio-muted)] rounded-lg border border-dashed border-[var(--studio-border)] p-3">
                      Grok Bot runs MCP tools on its own cloud computer, which can't reach this PC directly. Turn on <b>Remote access</b> below;
                      once it's running, this tab shows the address and header to paste into Grok Bot's custom MCP form.
                    </p>
                  ))}
                {tab === 'grok' && (
                  <div className="space-y-2">
                    <CopyBlock
                      label="Run once in a terminal"
                      value={`grok mcp add --transport http loreloom ${status.url} --header "Authorization: Bearer ${status.token}"`}
                      secret={reveal ? undefined : status.token}
                    />
                    <CopyBlock label="Then check the connection" value="grok mcp doctor loreloom" />
                  </div>
                )}
                {tab === 'chatgpt' && (
                  <p className="text-xs text-[var(--studio-muted)] rounded-lg border border-dashed border-[var(--studio-border)] p-3">
                    ChatGPT runs in OpenAI's cloud, so it needs <b>Remote access</b> below. ChatGPT connectors also sign in with OAuth rather
                    than a header; that sign-in is coming in the next update. The other apps here run on your PC and can connect now.
                  </p>
                )}
                {tab === 'other' && (
                  <div className="space-y-2">
                    <CopyBlock label="Server URL (Streamable HTTP)" value={status.url} />
                    <CopyBlock label="Header" value={`Authorization: Bearer ${status.token}`} secret={reveal ? undefined : status.token} />
                    <p className="text-[11px] text-[var(--studio-muted)]">For any other MCP app running on this PC.</p>
                  </div>
                )}
                <p className="text-[11px] text-[var(--studio-muted)]">
                  Keep the token private: anyone with it, on this PC, can read and change your lore. Loreloom has to be open for assistants
                  to work.
                </p>
              </div>
            )}

            {status.enabled && (
              <div className="rounded-xl border border-[var(--studio-border)] p-3.5 space-y-3">
                <Toggle
                  label="Remote access (for Grok Bot and ChatGPT)"
                  hint="Gives Loreloom a private HTTPS address through a Cloudflare tunnel, so assistants that run in the cloud can reach it. Uses its own token. No router ports are opened."
                  checked={status.remote.enabled}
                  onChange={(v) => updateRemote({ enabled: v })}
                />
                {!status.remote.cloudflaredFound && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      Remote access needs Cloudflare's free cloudflared tool. Install it, then turn remote access on:
                    </p>
                    <CopyBlock label="In PowerShell" value="winget install --id Cloudflare.cloudflared" />
                  </div>
                )}
                {status.remote.enabled && (
                  <>
                    <div role="radiogroup" aria-label="Address" className="grid gap-1.5">
                      <label className="flex items-start gap-2 text-xs cursor-pointer">
                        <input
                          type="radio"
                          checked={status.remote.mode === 'quick'}
                          onChange={() => updateRemote({ mode: 'quick' })}
                          className="mt-0.5 accent-[var(--world-accent)]"
                        />
                        <span>
                          <span className="font-medium">Quick address</span>
                          <span className="block text-[11px] text-[var(--studio-muted)]">
                            A random *.trycloudflare.com address, no account needed. Changes every time it starts. Good for trying it out.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-xs cursor-pointer">
                        <input
                          type="radio"
                          checked={status.remote.mode === 'named'}
                          onChange={() => updateRemote({ mode: 'named' })}
                          className="mt-0.5 accent-[var(--world-accent)]"
                        />
                        <span>
                          <span className="font-medium">My own domain</span>
                          <span className="block text-[11px] text-[var(--studio-muted)]">
                            A fixed address such as mcp.loreloom.io. In Cloudflare (Zero Trust → Networks → Tunnels), create a tunnel, add a
                            public hostname pointing to http://127.0.0.1:{status.port}, and paste the tunnel's token here.
                          </span>
                        </span>
                      </label>
                    </div>
                    {status.remote.mode === 'named' && (
                      <div className="grid gap-2">
                        <input
                          defaultValue={status.remote.hostname}
                          key={`host-${status.remote.hostname}`}
                          placeholder="mcp.loreloom.io"
                          aria-label="Hostname"
                          onBlur={(e) => e.target.value.trim() !== status.remote.hostname && updateRemote({ hostname: e.target.value })}
                          className="rounded-md border border-[var(--studio-border)] bg-transparent px-2 py-1.5 text-xs outline-none"
                        />
                        <input
                          type="password"
                          placeholder={status.remote.hasConnectorToken ? 'Tunnel token saved (paste a new one to replace it)' : 'Tunnel token from Cloudflare'}
                          aria-label="Tunnel token"
                          onBlur={(e) => {
                            if (e.target.value.trim()) {
                              void updateRemote({ connectorToken: e.target.value });
                              e.target.value = '';
                            }
                          }}
                          className="rounded-md border border-[var(--studio-border)] bg-transparent px-2 py-1.5 text-xs outline-none"
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${
                          status.remote.running
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-black/5 dark:bg-white/10 text-[var(--studio-muted)]'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${status.remote.running ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                        {status.remote.running ? `Online at ${status.remote.publicUrl}` : status.remote.error ? 'Not running' : 'Starting…'}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm('Make a new remote token? Grok Bot and other remote assistants will need the new one.')) return;
                          try {
                            setStatus(await bridge.regenerateMcpRemoteToken());
                          } catch (err) {
                            notifyError('Could not make a new remote token', err);
                          }
                        }}
                        className="ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" /> New remote token
                      </button>
                    </div>
                    {status.remote.error && <p className="text-xs text-red-600 dark:text-red-400">{status.remote.error}</p>}
                    <p className="text-[11px] text-[var(--studio-muted)]">
                      Anyone with the address and the remote token can read and change your lore while Loreloom is open, so keep the token
                      private. Wrong tokens are locked out after 10 tries. Remote access stops when Loreloom closes.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
