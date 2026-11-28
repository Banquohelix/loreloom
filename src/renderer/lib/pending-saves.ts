/**
 * Registry of debounced/pending saves so they can be flushed before the window closes
 * (main sends `app:before-close`) instead of silently dropping the last edits.
 */
const flushers = new Set<() => Promise<void>>();

export function registerPendingSaveFlusher(flush: () => Promise<void>): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

export async function flushAllPendingSaves(): Promise<void> {
  await Promise.allSettled(Array.from(flushers).map((flush) => flush()));
}
