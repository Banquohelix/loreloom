import { useState } from 'react';
import {
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from '@tiptap/react';
import { BadgeCheck, ChevronRight, EyeOff, Lock, MessageCircleQuestion, StickyNote } from 'lucide-react';
import { LORE_CALLOUTS, calloutLabel, type CalloutFold } from '@shared/callouts';

/** Icon and CSS style per lore callout; unknown Obsidian types are styled as a note. */
export const CALLOUT_ICONS: Record<string, typeof StickyNote> = {
  note: StickyNote,
  canon: BadgeCheck,
  rumor: MessageCircleQuestion,
  secret: Lock,
  spoiler: EyeOff,
};

function styleFor(kind: string): string {
  return CALLOUT_ICONS[kind] ? kind : 'note';
}

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const kind = String(node.attrs.kind || 'note');
  const title = String(node.attrs.title || '');
  const fold = String(node.attrs.fold || '') as CalloutFold;
  const collapsible = fold === '+' || fold === '-';
  // Open/closed is a view state only: a `-` callout loads closed each time, like in Obsidian. A new,
  // empty one starts open so the cursor has somewhere visible to type.
  const [open, setOpen] = useState(fold !== '-' || node.textContent.trim() === '');
  const Icon = CALLOUT_ICONS[styleFor(kind)];
  const editable = editor.isEditable;
  const isKnown = LORE_CALLOUTS.some((c) => c.id === kind);

  return (
    <NodeViewWrapper className={`lore-callout lore-callout-${styleFor(kind)}`} data-callout={kind}>
      <div className="lore-callout-header" contentEditable={false}>
        {collapsible && (
          <button
            type="button"
            className="lore-callout-toggle"
            aria-expanded={open || !collapsible}
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        )}
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <select
          className="lore-callout-kind"
          value={kind}
          disabled={!editable}
          aria-label="Callout style"
          onChange={(e) => {
            const next = e.target.value;
            // Spoilers are collapsed by default; switching to one makes it collapsible
            updateAttributes(next === 'spoiler' && !collapsible ? { kind: next, fold: '-' } : { kind: next });
            if (next === 'spoiler' && !collapsible) setOpen(true);
          }}
        >
          {LORE_CALLOUTS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          {!isKnown && <option value={kind}>{calloutLabel(kind)}</option>}
        </select>
        <input
          className="lore-callout-title"
          value={title}
          readOnly={!editable}
          placeholder={kind === 'spoiler' ? 'Spoiler title (shown while collapsed)' : 'Title (optional)'}
          aria-label="Callout title"
          onChange={(e) => updateAttributes({ title: e.target.value })}
          onKeyDown={(e) => {
            // Enter jumps into the callout body instead of doing nothing
            if (e.key === 'Enter') {
              e.preventDefault();
              setOpen(true);
              editor.commands.focus();
            }
          }}
        />
        {editable && (
          <button
            type="button"
            className={`lore-callout-foldtoggle ${collapsible ? 'is-on' : ''}`}
            title={collapsible ? 'Make it always open' : 'Make it collapsible (closed by default)'}
            aria-pressed={collapsible}
            onClick={() => {
              updateAttributes({ fold: collapsible ? '' : '-' });
              setOpen(true);
            }}
          >
            Collapsible
          </button>
        )}
      </div>
      <NodeViewContent className="lore-callout-body" hidden={collapsible && !open} />
    </NodeViewWrapper>
  );
}

/**
 * Callout block (`> [!canon] Title` in Markdown). Content is any blocks, so lists, images and
 * even nested callouts work inside.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (el) => el.getAttribute('data-callout') || 'note',
        renderHTML: (attrs) => ({ 'data-callout': attrs.kind }),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') || '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title }),
      },
      fold: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-fold') || '',
        renderHTML: (attrs) => ({ 'data-fold': attrs.fold }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'lore-callout' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addKeyboardShortcuts() {
    return {
      // Backspace in an empty callout removes the callout box but keeps the line
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'callout') {
            const callout = $from.node(d);
            if (callout.childCount === 1 && callout.textContent === '') return editor.commands.lift('callout');
            return false;
          }
        }
        return false;
      },
    };
  },
});
