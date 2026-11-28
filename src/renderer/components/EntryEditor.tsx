import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import ImageExtension from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  Check,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  PanelRight,
  Quote,
  Sparkles,
  Table as TableIcon,
  X,
} from 'lucide-react';
import type { ArtAsset, Entry, EntrySummary, UpdateEntryInput, UpdateEntryResult, WorldConfig } from '@shared/types';
import { normalizeBodyForCompare } from '@shared/wikilink-repair';
import { getBridge } from '../lib/bridge';
import { editorHtmlToMarkdown, markdownToEditorHtml } from '../lib/markdown-codec';
import { registerPendingSaveFlusher } from '../lib/pending-saves';
import {
  createSuggestionMenu,
  rankByQuery,
  type SuggestionMenuState,
} from '../lib/suggestion-menus';

const BODY_SAVE_DEBOUNCE_MS = 450;

function markdownToHtml(md: string, worldSlug: string): string {
  const bridge = getBridge();
  return markdownToEditorHtml(md, (rel) => bridge.getAssetUrl(worldSlug, rel));
}

function htmlToMarkdown(html: string, worldSlug: string): string {
  return editorHtmlToMarkdown(html, `loreloom-asset://${encodeURIComponent(worldSlug)}/`);
}

export type EntrySavePatch = Omit<UpdateEntryInput, 'worldSlug' | 'id'>;

type SlashCommandId =
  | 'h1' | 'h2' | 'h3' | 'quote' | 'bullet' | 'ordered' | 'task' | 'code' | 'hr' | 'table' | 'art';

interface SlashCommand {
  id: SlashCommandId;
  label: string;
  hint: string;
  icon: typeof Heading1;
  keywords: string[];
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'h1', label: 'Heading 1', hint: 'Big section title', icon: Heading1, keywords: ['title', 'h1'] },
  { id: 'h2', label: 'Heading 2', hint: 'Medium section title', icon: Heading2, keywords: ['subtitle', 'h2'] },
  { id: 'h3', label: 'Heading 3', hint: 'Small section title', icon: Heading3, keywords: ['h3'] },
  { id: 'quote', label: 'Lore Callout / Quote', hint: 'Highlighted passage', icon: Quote, keywords: ['blockquote', 'callout'] },
  { id: 'bullet', label: 'Bullet List', hint: 'Unordered list', icon: List, keywords: ['ul', 'list'] },
  { id: 'ordered', label: 'Numbered List', hint: 'Ordered list', icon: ListOrdered, keywords: ['ol', 'number'] },
  { id: 'task', label: 'Checklist', hint: 'Tasks with checkboxes', icon: ListChecks, keywords: ['todo', 'task', 'checkbox'] },
  { id: 'table', label: 'Table', hint: '3 × 3 table with header row', icon: TableIcon, keywords: ['grid', 'stats'] },
  { id: 'code', label: 'Code / Stat Block', hint: 'Monospace block', icon: Code, keywords: ['stat', 'pre'] },
  { id: 'hr', label: 'Divider', hint: 'Horizontal rule', icon: Minus, keywords: ['separator', 'line', 'hr'] },
  { id: 'art', label: 'Concept Art Image', hint: 'Insert art from this World', icon: ImageIcon, keywords: ['image', 'picture'] },
];

interface WikiSuggestion {
  id: string;
  title: string;
  type: string;
  create?: boolean;
}

interface EntryEditorProps {
  world: WorldConfig;
  entry: Entry;
  allEntries: EntrySummary[];
  artAssets: ArtAsset[];
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  /** Saves a patch to THIS entry (the editor is keyed by entry id). Resolves null on failure. */
  onSaveEntry: (patch: EntrySavePatch) => Promise<UpdateEntryResult | null>;
  onNavigateEntry: (entryId: string) => void;
  onCreateStubEntry: (title: string) => Promise<void>;
}

/**
 * Mount with `key={entry.id}`: one editor instance per entry, so a debounced save can never
 * write one entry's body into another.
 */
export function EntryEditor({
  world,
  entry,
  allEntries,
  artAssets,
  inspectorOpen,
  onToggleInspector,
  onSaveEntry,
  onNavigateEntry,
  onCreateStubEntry,
}: EntryEditorProps) {
  const bridge = getBridge();
  const [title, setTitle] = useState(entry.title);
  const [tagInput, setTagInput] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [pickerMode, setPickerMode] = useState<'cover' | 'portrait' | 'inline' | null>(null);
  // Inline suggestion menus (slash commands, [[wikilinks]]) driven by @tiptap/suggestion
  const [menu, setMenuState] = useState<SuggestionMenuState | null>(null);
  const menuRef = useRef<SuggestionMenuState | null>(null);
  const allEntriesRef = useRef(allEntries);
  allEntriesRef.current = allEntries;
  const runSlashCommandRef = useRef<(id: SlashCommandId) => void>(() => {});
  const suggestionExtensions = useMemo(() => {
    const controller = {
      get: () => menuRef.current,
      set: (next: SuggestionMenuState | null) => {
        menuRef.current = next;
        setMenuState(next);
      },
    };
    return [
      createSuggestionMenu<SlashCommand>({
        name: 'slashMenu',
        char: '/',
        // Only after a space or at the start of a line, so "and/or" doesn't open the menu
        allowedPrefixes: [' '],
        items: (query) => rankByQuery(SLASH_COMMANDS, query, (c) => c.label, (c) => c.keywords),
        apply: (ed, range, cmd) => {
          ed.chain().focus().deleteRange(range).run();
          runSlashCommandRef.current(cmd.id);
        },
        controller,
      }),
      createSuggestionMenu<WikiSuggestion>({
        name: 'wikiMenu',
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        items: (query) => {
          if (query.includes(']')) return [];
          const candidates = allEntriesRef.current.filter((e) => e.id !== entry.id);
          const matches = rankByQuery(candidates, query, (e) => e.title).slice(0, 8);
          const items: WikiSuggestion[] = matches.map((e) => ({ id: e.id, title: e.title, type: e.type }));
          const q = query.trim();
          if (q && !candidates.some((e) => e.title.toLowerCase() === q.toLowerCase())) {
            items.push({ id: `create:${q}`, title: q, type: 'new page', create: true });
          }
          return items;
        },
        apply: (ed, range, item) => {
          ed.chain().focus().insertContentAt(range, `[[${item.title}]] `).run();
        },
        controller,
      }),
    ];
    // The editor is keyed by entry id, so these are created once per entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveTimerRef = useRef<number | null>(null);
  /** Unsaved edits exist in the editor that have not been sent yet. */
  const pendingBodyRef = useRef(false);
  const latestHtmlRef = useRef<string | null>(null);
  /** Body the editor content is based on; sent as `baseBody` so the main process detects conflicts. */
  const baseBodyRef = useRef(entry.body);
  /** Last body this editor knows about (loaded, or optimistically saved). */
  const lastKnownBodyRef = useRef(entry.body);
  const inflightRef = useRef<Promise<void> | null>(null);
  const titleDirtyRef = useRef(false);
  const titleValueRef = useRef(entry.title);
  const mountedRef = useRef(true);
  const onSaveEntryRef = useRef(onSaveEntry);
  onSaveEntryRef.current = onSaveEntry;
  const [reloadTick, setReloadTick] = useState(0);

  const coverAsset = useMemo(
    () => artAssets.find((a) => a.id === entry.coverAssetId),
    [artAssets, entry.coverAssetId]
  );
  const portraitAsset = useMemo(
    () => artAssets.find((a) => a.id === entry.portraitAssetId),
    [artAssets, entry.portraitAssetId]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: 'Write your lore… Type / for blocks or [[ to link another entry',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ImageExtension.configure({ inline: false }),
      ...suggestionExtensions,
    ],
    editorProps: {
      handleClick: (view, pos, event) => {
        if (!event.ctrlKey && !event.metaKey) return false;
        const anchor = (event.target as HTMLElement | null)?.closest?.('a');
        const href = anchor?.getAttribute('href');
        if (href && /^https?:\/\//i.test(href)) {
          bridge.openExternalUrl(href);
          return true;
        }
        const $pos = view.state.doc.resolve(pos);
        const parentText = $pos.parent.textContent;
        const offset = $pos.parentOffset;
        const regex = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(parentText)) !== null) {
          if (offset >= m.index && offset <= m.index + m[0].length) {
            const target = m[1].trim();
            const found = allEntries.find(
              (e) =>
                e.title.toLowerCase() === target.toLowerCase() ||
                e.slug.toLowerCase() === target.toLowerCase()
            );
            if (found) {
              onNavigateEntry(found.id);
            } else {
              onCreateStubEntry(target);
            }
            return true;
          }
        }
        return false;
      },
    },
    content: markdownToHtml(entry.body, world.slug),
    onUpdate: ({ editor: ed }) => {
      latestHtmlRef.current = ed.getHTML();
      pendingBodyRef.current = true;
      setSaveState('saving');
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        void flushBody();
      }, BODY_SAVE_DEBOUNCE_MS);
    },
  });

  /** Sends any pending body edit now (debounce fired, unmount, or window close). */
  const flushBody = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!pendingBodyRef.current || latestHtmlRef.current === null) {
      await inflightRef.current;
      return;
    }
    pendingBodyRef.current = false;
    const md = htmlToMarkdown(latestHtmlRef.current, world.slug);
    const previous = inflightRef.current;
    const run = (async () => {
      await previous;
      // Read the base only after earlier saves of this entry finished
      const baseBody = baseBodyRef.current;
      lastKnownBodyRef.current = md;
      try {
        const res = await onSaveEntryRef.current({ body: md, baseBody });
        if (res && !res.conflictCopy) {
          baseBodyRef.current = md;
        }
        if (mountedRef.current) {
          setSaveState(res ? (pendingBodyRef.current ? 'saving' : 'saved') : 'error');
          setReloadTick((t) => t + 1);
        }
      } catch {
        if (mountedRef.current) setSaveState('error');
      }
    })();
    inflightRef.current = run;
    await run;
  }, [world.slug]);

  const flushTitle = useCallback(async (): Promise<void> => {
    if (!titleDirtyRef.current) return;
    titleDirtyRef.current = false;
    const next = titleValueRef.current.trim();
    if (!next) return;
    await onSaveEntryRef.current({ title: next });
  }, []);

  // Flush on unmount (switching entry/tab/world) and before the window closes
  useEffect(() => {
    mountedRef.current = true;
    const unregister = registerPendingSaveFlusher(async () => {
      await Promise.all([flushBody(), flushTitle()]);
    });
    return () => {
      mountedRef.current = false;
      unregister();
      void flushBody();
      void flushTitle();
    };
  }, [flushBody, flushTitle]);

  // Reload content changed elsewhere (another PC via OneDrive/Drive, intake, the other split pane,
  // or a conflict where the on-disk version was kept) when there are no unsaved local edits.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (normalizeBodyForCompare(entry.body) === normalizeBodyForCompare(lastKnownBodyRef.current)) return;
    if (pendingBodyRef.current || saveTimerRef.current) return;
    lastKnownBodyRef.current = entry.body;
    baseBodyRef.current = entry.body;
    latestHtmlRef.current = null;
    editor.commands.setContent(markdownToHtml(entry.body, world.slug), false);
  }, [entry.body, world.slug, editor, reloadTick]);

  useEffect(() => {
    if (!titleDirtyRef.current) {
      setTitle(entry.title);
      titleValueRef.current = entry.title;
    }
  }, [entry.title]);

  const handleTitleBlur = async () => {
    if (!titleDirtyRef.current) return;
    setSaveState('saving');
    await flushTitle();
    if (mountedRef.current) setSaveState('saved');
  };

  const handleAddTag = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const cleaned = tagInput.replace(/^#/, '').trim();
    if (!cleaned || entry.tags.includes(cleaned)) {
      setTagInput('');
      return;
    }
    await onSaveEntry({ tags: [...entry.tags, cleaned] });
    setTagInput('');
  };

  const handleRemoveTag = async (tag: string) => {
    await onSaveEntry({ tags: entry.tags.filter((t) => t !== tag) });
  };

  // The "/query" text is already removed by the suggestion plugin before this runs
  const runSlashCommand = (cmd: SlashCommandId) => {
    if (!editor) return;
    switch (cmd) {
      case 'h1':
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case 'h2':
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case 'h3':
        editor.chain().focus().toggleHeading({ level: 3 }).run();
        break;
      case 'quote':
        editor.chain().focus().toggleBlockquote().run();
        break;
      case 'bullet':
        editor.chain().focus().toggleBulletList().run();
        break;
      case 'ordered':
        editor.chain().focus().toggleOrderedList().run();
        break;
      case 'task':
        editor.chain().focus().toggleTaskList().run();
        break;
      case 'code':
        editor.chain().focus().toggleCodeBlock().run();
        break;
      case 'hr':
        editor.chain().focus().setHorizontalRule().run();
        break;
      case 'table':
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        break;
      case 'art':
        setPickerMode('inline');
        break;
    }
  };

  runSlashCommandRef.current = runSlashCommand;

  const handlePickArt = async (asset: ArtAsset) => {
    if (pickerMode === 'cover') {
      await onSaveEntry({ coverAssetId: asset.id });
    } else if (pickerMode === 'portrait') {
      await onSaveEntry({ portraitAssetId: asset.id });
    } else if (pickerMode === 'inline' && editor) {
      editor
        .chain()
        .focus()
        .setImage({
          src: bridge.getAssetUrl(world.slug, asset.relativePath),
          alt: asset.title,
        })
        .run();
    }
    setPickerMode(null);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto world-canvas relative">
      {/* Top subtle toolbar */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-2.5 border-b border-[var(--world-canvas-border)] bg-[var(--world-canvas-bg)]/90 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-[var(--studio-muted)] min-w-0">
          <span className="truncate">{world.name}</span>
          <span>/</span>
          {entry.folder && (
            <>
              <span className="truncate">{entry.folder}</span>
              <span>/</span>
            </>
          )}
          <span className="text-[var(--studio-text)] font-medium truncate">{title}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-[var(--studio-muted)]">
            {saveState === 'saving' ? (
              'Saving…'
            ) : saveState === 'error' ? (
              <span className="text-red-500">Save failed, keep this page open and retry</span>
            ) : (
              <>
                <Check className="w-3 h-3 text-emerald-500" /> Saved
              </>
            )}
          </span>
          <button
            onClick={() => setPickerMode('inline')}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Insert Art
          </button>
          <button
            onClick={onToggleInspector}
            title="Toggle Inspector"
            className={`p-1.5 rounded-md transition cursor-pointer ${
              inspectorOpen
                ? 'bg-black/8 dark:bg-white/10 text-[var(--studio-text)]'
                : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
            }`}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Cover Banner */}
      {coverAsset && (
        <div className="relative h-56 w-full group overflow-hidden border-b border-[var(--world-canvas-border)]">
          <img
            src={bridge.getThumbnailUrl(world.slug, coverAsset.relativePath, 1600)}
            alt={coverAsset.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-end justify-end p-4 gap-2">
            <button
              onClick={() => setPickerMode('cover')}
              className="px-3 py-1.5 rounded-lg bg-black/70 text-white text-xs font-medium hover:bg-black/85 cursor-pointer"
            >
              Change Cover
            </button>
            <button
              onClick={() => onSaveEntry({ coverAssetId: null })}
              className="px-3 py-1.5 rounded-lg bg-black/70 text-white text-xs font-medium hover:bg-black/85 cursor-pointer"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Main Centered Page */}
      <div className="max-w-3xl mx-auto px-8 py-10">
        {/* Quick Cover / Portrait controls */}
        <div className="flex items-center gap-3 mb-4 opacity-70 hover:opacity-100 transition">
          {!coverAsset && (
            <button
              onClick={() => setPickerMode('cover')}
              className="flex items-center gap-1.5 text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] cursor-pointer"
            >
              <ImageIcon className="w-3.5 h-3.5" /> Add Cover Art
            </button>
          )}
          <button
            onClick={() => setPickerMode('portrait')}
            className="flex items-center gap-1.5 text-xs text-[var(--studio-muted)] hover:text-[var(--studio-text)] cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {portraitAsset ? 'Change Portrait' : 'Add Portrait'}
          </button>
        </div>

        {/* Title Row */}
        <div className="flex items-start gap-5 mb-4">
          {portraitAsset && (
            <div className="relative group shrink-0">
              <img
                src={bridge.getThumbnailUrl(world.slug, portraitAsset.relativePath, 256)}
                alt={portraitAsset.title}
                className="w-20 h-20 rounded-2xl object-cover border border-[var(--world-canvas-border)] shadow-sm"
              />
              <button
                onClick={() => onSaveEntry({ portraitAssetId: null })}
                title="Remove portrait"
                className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-zinc-900 text-white opacity-0 group-hover:opacity-100 transition cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <input
              value={title}
              onChange={(e) => {
                titleDirtyRef.current = true;
                titleValueRef.current = e.target.value;
                setTitle(e.target.value);
              }}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              placeholder="Untitled Entry"
              className="w-full bg-transparent world-heading text-4xl font-semibold tracking-tight outline-none placeholder:opacity-40"
            />

            {/* Tags row */}
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--world-accent-soft)',
                    color: 'var(--world-accent)',
                  }}
                >
                  #{tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:opacity-70 cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="+ add tag"
                className="bg-transparent text-xs text-[var(--studio-muted)] outline-none w-24 placeholder:opacity-60"
              />
            </div>
          </div>
        </div>

        <div className="h-px bg-[var(--world-canvas-border)] my-6" />

        {/* Block Editor */}
        <div
          className={`world-prose relative ${
            world.theme.editorialDropCap ? 'editorial-dropcap' : ''
          }`}
        >
          <EditorContent editor={editor} />

          {/* Inline suggestion menu (slash commands / [[wikilinks]]), positioned at the cursor */}
          {menu && menu.items.length > 0 && menu.rect && (
            <div
              role="listbox"
              aria-label={menu.kind === 'slashMenu' ? 'Insert block' : 'Link to entry'}
              className="fixed z-50 w-72 max-h-80 overflow-y-auto rounded-xl border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-xl p-1.5"
              style={{
                left: Math.min(menu.rect.left, window.innerWidth - 300),
                top: menu.rect.bottom + 320 > window.innerHeight ? Math.max(8, menu.rect.top - 326) : menu.rect.bottom + 6,
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-muted)] flex items-center gap-1">
                {menu.kind === 'slashMenu' ? (
                  'Insert Block'
                ) : (
                  <>
                    <Link2 className="w-3 h-3" /> Link to World Entry
                  </>
                )}
              </div>
              {menu.kind === 'slashMenu'
                ? (menu.items as SlashCommand[]).map((item, i) => (
                    <button
                      key={item.id}
                      role="option"
                      aria-selected={i === menu.selected}
                      onClick={() => menu.select(item)}
                      onMouseEnter={() => {
                        const next = { ...menu, selected: i };
                        menuRef.current = next;
                        setMenuState(next);
                      }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer ${
                        i === menu.selected ? 'bg-black/8 dark:bg-white/10' : ''
                      }`}
                    >
                      <item.icon className="w-3.5 h-3.5 text-[var(--studio-muted)] shrink-0" />
                      <span className="font-medium">{item.label}</span>
                      <span className="ml-auto text-[10px] text-[var(--studio-muted)] truncate">{item.hint}</span>
                    </button>
                  ))
                : (menu.items as WikiSuggestion[]).map((item, i) => (
                    <button
                      key={item.id}
                      role="option"
                      aria-selected={i === menu.selected}
                      onClick={() => menu.select(item)}
                      onMouseEnter={() => {
                        const next = { ...menu, selected: i };
                        menuRef.current = next;
                        setMenuState(next);
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer ${
                        i === menu.selected ? 'bg-black/8 dark:bg-white/10' : ''
                      }`}
                    >
                      <span className="truncate font-medium">
                        {item.create ? `Link “${item.title}” (new page)` : item.title}
                      </span>
                      <span className="text-[10px] text-[var(--studio-muted)] uppercase shrink-0">
                        {item.create ? '+' : item.type}
                      </span>
                    </button>
                  ))}
              <div className="px-2 pt-1 text-[10px] text-[var(--studio-muted)]">↑↓ to choose · Enter to insert · Esc to close</div>
            </div>
          )}
        </div>
      </div>

      {/* Art Picker Modal */}
      {pickerMode && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
          onClick={() => setPickerMode(null)}
        >
          <div
            className="max-w-2xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">
                Choose Concept Art ({pickerMode === 'cover' ? 'Page Cover' : pickerMode === 'portrait' ? 'Portrait' : 'Inline Image'})
              </h3>
              <button
                onClick={() => setPickerMode(null)}
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {artAssets.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--studio-muted)]">
                No concept art in this World yet. Upload images in the <strong>Concept Art</strong> gallery first.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                {artAssets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => handlePickArt(asset)}
                    className="group relative aspect-video rounded-xl overflow-hidden border border-[var(--studio-border)] hover:ring-2 hover:ring-amber-500 transition cursor-pointer text-left"
                  >
                    <img
                      src={bridge.getThumbnailUrl(world.slug, asset.relativePath, 256)}
                      loading="lazy"
                      decoding="async"
                      alt={asset.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <div className="text-xs font-medium text-white truncate">{asset.title}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
