/**
 * App-wide notifications. Components call notifyError/notify; App renders them as toasts.
 * Also cleans up Electron's IPC error wrapping so people see the actual reason.
 */
export type NoticeKind = 'info' | 'error';

export interface Notice {
  message: string;
  kind: NoticeKind;
  durationMs?: number;
}

const EVENT = 'loreloom:notice';

/** "Error invoking remote method 'entry:update': Error: Entry not found: x" → "Entry not found: x" */
export function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err ?? 'Unknown error');
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^(Error|TypeError|RangeError):\s*/i, '').trim() || 'Unknown error';
}

export function notify(message: string, durationMs?: number): void {
  window.dispatchEvent(new CustomEvent<Notice>(EVENT, { detail: { message, kind: 'info', durationMs } }));
}

export function notifyError(context: string, err?: unknown): void {
  const message = err === undefined ? context : `${context}: ${friendlyErrorMessage(err)}`;
  window.dispatchEvent(new CustomEvent<Notice>(EVENT, { detail: { message, kind: 'error', durationMs: 9000 } }));
}

export function onNotice(listener: (notice: Notice) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<Notice>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
