import { Extension, type Editor, type Range } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

/**
 * Inline suggestion menus (slash commands and [[wikilink]] autocomplete) built on @tiptap/suggestion:
 * they open at the cursor, filter as you type, and support ↑/↓, Enter/Tab and Esc.
 */

export interface SuggestionMenuState<T = unknown> {
  kind: string;
  items: T[];
  selected: number;
  query: string;
  /** Viewport rect of the trigger text; the popup is positioned below it. */
  rect: { left: number; top: number; bottom: number } | null;
  select: (item: T) => void;
}

export interface SuggestionMenuController {
  get: () => SuggestionMenuState | null;
  set: (state: SuggestionMenuState | null) => void;
}

interface SuggestionMenuOptions<T> {
  name: string;
  /** Trigger text, e.g. '/' or '[['. */
  char: string;
  allowSpaces?: boolean;
  /** Characters allowed right before the trigger (null = anywhere). '/' only after a space or at line start. */
  allowedPrefixes?: string[] | null;
  items: (query: string) => T[];
  apply: (editor: Editor, range: Range, item: T) => void;
  controller: SuggestionMenuController;
}

function toRect(clientRect?: (() => DOMRect | null) | null): SuggestionMenuState['rect'] {
  const r = clientRect?.();
  return r ? { left: r.left, top: r.top, bottom: r.bottom } : null;
}

export function createSuggestionMenu<T>(opts: SuggestionMenuOptions<T>) {
  const { controller } = opts;
  // Esc hides the menu until the user starts a new trigger (a different range start)
  let dismissedAt: number | null = null;

  return Extension.create({
    name: opts.name,
    addProseMirrorPlugins() {
      return [
        Suggestion<T, T>({
          editor: this.editor,
          char: opts.char,
          pluginKey: new PluginKey(opts.name),
          allowSpaces: opts.allowSpaces ?? false,
          allowedPrefixes: opts.allowedPrefixes === undefined ? [' '] : opts.allowedPrefixes,
          items: ({ query }) => opts.items(query),
          command: ({ editor, range, props }) => opts.apply(editor, range, props),
          render: () => {
            let currentRange: Range | null = null;
            const show = (props: {
              items: T[];
              query: string;
              range: Range;
              clientRect?: (() => DOMRect | null) | null;
              command: (item: T) => void;
            }) => {
              currentRange = props.range;
              if (dismissedAt === props.range.from) return;
              const prev = controller.get();
              const selected =
                prev && prev.kind === opts.name ? Math.min(prev.selected, Math.max(0, props.items.length - 1)) : 0;
              controller.set({
                kind: opts.name,
                items: props.items,
                selected,
                query: props.query,
                rect: toRect(props.clientRect),
                select: (item) => props.command(item as T),
              } as SuggestionMenuState);
            };
            return {
              onStart: (props) => {
                dismissedAt = null;
                show(props);
              },
              onUpdate: (props) => show(props),
              onKeyDown: ({ event }) => {
                const state = controller.get();
                if (!state || state.kind !== opts.name) return false;
                if (event.key === 'Escape') {
                  dismissedAt = currentRange?.from ?? null;
                  controller.set(null);
                  return true;
                }
                if (state.items.length === 0) return false;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const delta = event.key === 'ArrowDown' ? 1 : -1;
                  const selected = (state.selected + delta + state.items.length) % state.items.length;
                  controller.set({ ...state, selected });
                  return true;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  state.select(state.items[state.selected]);
                  return true;
                }
                return false;
              },
              onExit: () => {
                currentRange = null;
                if (controller.get()?.kind === opts.name) controller.set(null);
              },
            };
          },
        }),
      ];
    },
  });
}

/** Simple ranked filter: prefix matches first, then substring matches, then keyword matches. */
export function rankByQuery<T>(items: T[], query: string, text: (item: T) => string, keywords?: (item: T) => string[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const label = text(item).toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.split(/[\s/-]+/).some((w) => w.startsWith(q))) score = 1;
    else if (label.includes(q)) score = 2;
    else if (keywords?.(item).some((k) => k.toLowerCase().startsWith(q))) score = 3;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item);
}
