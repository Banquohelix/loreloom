import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import ImageExtension from '@tiptap/extension-image';
import { marked } from 'marked';
import TurndownService from 'turndown';
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
  X,
} from 'lucide-react';
import type { ArtAsset, Entry, EntrySummary, WorldConfig } from '@shared/types';
import { getBridge } from '../lib/bridge';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

turndown.addRule('taskListItem', {
  filter: (node) =>
    node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const checked = el.getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
  },
});

function markdownToHtml(md: string, worldSlug: string): string {
  const bridge = getBridge();
  // Rewrite relative assets/... image links to loreloom-asset:// URLs for display
  const withAssetUrls = md.replace(
    /!\[([^\]]*)\]\((assets\/[^)]+)\)/g,
    (_m, alt: string, rel: string) => `![${alt}](${bridge.getAssetUrl(worldSlug, rel)})`
  );
  return marked.parse(withAssetUrls, { async: false }) as string;
}

function htmlToMarkdown(html: string, worldSlug: string): string {
  const rawMd = turndown.turndown(html);
  const prefix = `loreloom-asset://${encodeURIComponent(worldSlug)}/`;
  return rawMd.replace(
    new RegExp(`!\\[([^\\]]*)\\]\\(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^)]+)\\)`, 'g'),
    (_m, alt: string, encodedRel: string) =>
      `![${alt}](${encodedRel.split('/').map(decodeURIComponent).join('/')})`
  );
}

interface EntryEditorProps {
  world: WorldConfig;
  entry: Entry;
  allEntries: EntrySummary[];
  artAssets: ArtAsset[];
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onSaveEntry: (patch: {
    title?: string;
    body?: string;
    tags?: string[];
    coverAssetId?: string | null;
    portraitAssetId?: string | null;
  }) => Promise<void>;
  onNavigateEntry: (entryId: string) => void;
  onCreateStubEntry: (title: string) => Promise<void>;
}

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
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [pickerMode, setPickerMode] = useState<'cover' | 'portrait' | 'inline' | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiFilter, setWikiFilter] = useState('');

  const saveTimerRef = useRef<number | null>(null);
  const lastEntryIdRef = useRef(entry.id);

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
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: 'Write your lore… Type / for blocks or [[ to link another entry',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ImageExtension.configure({ inline: false }),
    ],
    editorProps: {
      handleClick: (view, pos, event) => {
        if (!event.ctrlKey && !event.metaKey) return false;
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
      const textBefore = ed.state.doc.textBetween(
        Math.max(0, ed.state.selection.from - 30),
        ed.state.selection.from,
        '\n'
      );

      if (textBefore.endsWith('/')) {
        setSlashOpen(true);
        setWikiOpen(false);
      } else if (slashOpen && !textBefore.includes('/')) {
        setSlashOpen(false);
      }

      const wikiMatch = textBefore.match(/\[\[([^\]]*)$/);
      if (wikiMatch) {
        setWikiOpen(true);
        setWikiFilter(wikiMatch[1]);
        setSlashOpen(false);
      } else if (wikiOpen) {
        setWikiOpen(false);
      }

      setSaveState('saving');
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(async () => {
        const md = htmlToMarkdown(ed.getHTML(), world.slug);
        await onSaveEntry({ body: md });
        setSaveState('saved');
      }, 450);
    },
  });

  useEffect(() => {
    setTitle(entry.title);
    if (editor && lastEntryIdRef.current !== entry.id) {
      lastEntryIdRef.current = entry.id;
      editor.commands.setContent(markdownToHtml(entry.body, world.slug), false);
    }
  }, [entry.id, entry.title, entry.body, world.slug, editor]);

  const handleTitleBlur = async () => {
    if (title.trim() && title !== entry.title) {
      setSaveState('saving');
      await onSaveEntry({ title: title.trim() });
      setSaveState('saved');
    }
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

  const runSlashCommand = (cmd: string) => {
    if (!editor) return;
    // Remove the trailing `/` character
    const pos = editor.state.selection.from;
    editor.chain().focus().deleteRange({ from: Math.max(0, pos - 1), to: pos }).run();
    setSlashOpen(false);

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
      case 'art':
        setPickerMode('inline');
        break;
    }
  };

  const insertWikilink = (targetTitle: string) => {
    if (!editor) return;
    const pos = editor.state.selection.from;
    const deleteLen = wikiFilter.length + 2;
    editor
      .chain()
      .focus()
      .deleteRange({ from: Math.max(0, pos - deleteLen), to: pos })
      .insertContent(`[[${targetTitle}]] `)
      .run();
    setWikiOpen(false);
    setWikiFilter('');
  };

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

  const filteredWikiEntries = useMemo(() => {
    const q = wikiFilter.trim().toLowerCase();
    return allEntries
      .filter((e) => e.id !== entry.id)
      .filter((e) => (!q ? true : e.title.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [allEntries, entry.id, wikiFilter]);

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
            src={bridge.getAssetUrl(world.slug, coverAsset.relativePath)}
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
                src={bridge.getAssetUrl(world.slug, portraitAsset.relativePath)}
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
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
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

          {/* Slash Command Popover */}
          {slashOpen && (
            <div className="mt-2 w-64 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-xl p-1.5 z-30">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
                Insert Block
              </div>
              {[
                { id: 'h1', label: 'Heading 1', icon: Heading1 },
                { id: 'h2', label: 'Heading 2', icon: Heading2 },
                { id: 'h3', label: 'Heading 3', icon: Heading3 },
                { id: 'quote', label: 'Lore Callout / Quote', icon: Quote },
                { id: 'bullet', label: 'Bullet List', icon: List },
                { id: 'ordered', label: 'Numbered List', icon: ListOrdered },
                { id: 'task', label: 'Checklist', icon: ListChecks },
                { id: 'code', label: 'Code / Stat Block', icon: Code },
                { id: 'hr', label: 'Divider', icon: Minus },
                { id: 'art', label: 'Concept Art Image', icon: ImageIcon },
              ].map((item) => (
                <button
                  key={item.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runSlashCommand(item.id);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs hover:bg-black/5 dark:hover:bg-white/5 text-left cursor-pointer"
                >
                  <item.icon className="w-3.5 h-3.5 text-[var(--studio-muted)]" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Wikilink Autocomplete Popover */}
          {wikiOpen && (
            <div className="mt-2 w-72 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-xl p-1.5 z-30">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-muted)] flex items-center gap-1">
                <Link2 className="w-3 h-3" /> Link to World Entry
              </div>
              {filteredWikiEntries.length === 0 ? (
                <div className="px-2.5 py-2 text-xs text-[var(--studio-muted)]">
                  No matching entries
                </div>
              ) : (
                filteredWikiEntries.map((item) => (
                  <button
                    key={item.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertWikilink(item.title);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs hover:bg-black/5 dark:hover:bg-white/5 text-left cursor-pointer"
                  >
                    <span className="truncate font-medium">{item.title}</span>
                    <span className="text-[10px] text-[var(--studio-muted)] uppercase">
                      {item.type}
                    </span>
                  </button>
                ))
              )}
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
                      src={bridge.getAssetUrl(world.slug, asset.relativePath)}
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
