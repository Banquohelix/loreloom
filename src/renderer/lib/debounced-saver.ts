import { useEffect, useRef } from 'react';
import { registerPendingSaveFlusher } from './pending-saves';

/**
 * Coalesces rapid edits (typing in a pin label, dragging a colour picker) into one write after a
 * pause. Writes run one at a time, in order, and only the latest value is ever sent, so a slow
 * reply can't revert newer edits. Pending writes are flushed before the window closes.
 */
export class DebouncedSaver<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { value: T } | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly save: (value: T) => Promise<unknown>,
    private readonly delayMs = 400,
    private readonly onError?: (err: unknown) => void
  ) {}

  schedule(value: T): void {
    this.pending = { value };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.delayMs);
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const next = this.pending;
    this.pending = null;
    if (next) {
      this.chain = this.chain
        .then(() => this.save(next.value))
        .then(
          () => undefined,
          (err) => this.onError?.(err)
        );
    }
    return this.chain;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }
}

/**
 * One DebouncedSaver per key (e.g. per map or board id), flushed on unmount and before close.
 * `save` may change between renders; the latest one is always used.
 */
export function useKeyedDebouncedSaver<T>(
  save: (key: string, value: T) => Promise<unknown>,
  delayMs = 400,
  onError?: (err: unknown) => void
) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const saversRef = useRef(new Map<string, DebouncedSaver<T>>());

  useEffect(() => {
    const savers = saversRef.current;
    const flushAll = async () => {
      await Promise.all(Array.from(savers.values()).map((s) => s.flush()));
    };
    const unregister = registerPendingSaveFlusher(flushAll);
    return () => {
      unregister();
      void flushAll();
    };
  }, []);

  return (key: string, value: T) => {
    let saver = saversRef.current.get(key);
    if (!saver) {
      saver = new DebouncedSaver<T>(
        (v) => saveRef.current(key, v),
        delayMs,
        (err) => onErrorRef.current?.(err)
      );
      saversRef.current.set(key, saver);
    }
    saver.schedule(value);
  };
}
