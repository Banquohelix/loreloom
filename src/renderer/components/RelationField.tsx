import { useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { EntrySummary, PropertyFieldDef, WorldConfig } from '@shared/types';
import { parseLinkValue, toLinkValue } from '@shared/entity-type-utils';
import { rankByQuery } from '../lib/suggestion-menus';

interface RelationFieldProps {
  id: string;
  field: PropertyFieldDef;
  /** Stored values, e.g. ["[[Ashbound Order]]"] */
  values: string[];
  world: WorldConfig;
  allEntries: EntrySummary[];
  currentEntryId: string;
  onChange: (next: string[]) => void;
  onNavigateEntry: (entryId: string) => void;
  onCreateStubEntry: (title: string) => Promise<void>;
}

/**
 * Relation property: links to other entries, saved as Obsidian-style "[[Title]]" values so the
 * frontmatter stays readable and works in Obsidian. Optionally limited to some entity types.
 */
export function RelationField({
  id,
  field,
  values,
  world,
  allEntries,
  currentEntryId,
  onChange,
  onNavigateEntry,
  onCreateStubEntry,
}: RelationFieldProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, EntrySummary>();
    for (const e of allEntries) {
      map.set(e.slug.toLowerCase(), e);
      map.set(e.title.toLowerCase(), e);
    }
    return map;
  }, [allEntries]);

  const typeName = (typeId: string) => world.entityTypes.find((t) => t.id === typeId)?.name ?? typeId;
  const targets = field.targetTypes ?? [];
  const targetLabel = targets.length > 0 ? targets.map((t) => typeName(t).toLowerCase()).join(' or ') : 'entry';
  const linkPrompt = `Link ${/^[aeiou]/i.test(targetLabel) ? 'an' : 'a'} ${targetLabel}`;

  const linked = values.map((v) => {
    const { target, label } = parseLinkValue(v);
    return { raw: v, target, label, entry: byKey.get(target.toLowerCase()) };
  });
  const linkedIds = new Set(linked.map((l) => l.entry?.id).filter(Boolean));

  const suggestions = useMemo(() => {
    const pool = allEntries.filter(
      (e) =>
        e.id !== currentEntryId &&
        !linkedIds.has(e.id) &&
        (targets.length === 0 || targets.includes(e.type) || (e.secondaryTypes ?? []).some((t) => targets.includes(t)))
    );
    return rankByQuery(pool, query, (e) => e.title).slice(0, 8);
    // linkedIds is derived from values each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries, currentEntryId, query, values, targets.join('|')]);

  const add = (title: string) => {
    const value = toLinkValue(title);
    if (!title.trim() || values.some((v) => parseLinkValue(v).target.toLowerCase() === title.trim().toLowerCase())) return;
    onChange([...values, value]);
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  };

  const remove = (raw: string) => onChange(values.filter((v) => v !== raw));

  const exactMatch = suggestions.some((e) => e.title.toLowerCase() === query.trim().toLowerCase());
  const showCreate = query.trim().length > 0 && !exactMatch;
  const optionCount = suggestions.length + (showCreate ? 1 : 0);

  return (
    <div className="space-y-1.5">
      {linked.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${field.label} links`}>
          {linked.map((l) => (
            <li
              key={l.raw}
              className={`group flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] border ${
                l.entry
                  ? 'border-transparent bg-[var(--world-accent-soft)] text-[var(--world-accent)]'
                  : 'border-dashed border-[var(--studio-border)] text-[var(--studio-muted)]'
              }`}
            >
              <button
                type="button"
                className="font-medium truncate max-w-40 cursor-pointer hover:underline"
                title={l.entry ? `Open ${l.entry.title}` : `"${l.target}" doesn't exist yet. Click to create it.`}
                onClick={() => (l.entry ? onNavigateEntry(l.entry.id) : onCreateStubEntry(l.target))}
              >
                {l.label}
                {!l.entry && ' (new)'}
              </button>
              <button
                type="button"
                aria-label={`Remove ${l.label}`}
                className="p-0.5 rounded-full opacity-60 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
                onClick={() => remove(l.raw)}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Plus className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--studio-muted)] pointer-events-none" />
        <input
          id={id}
          ref={inputRef}
          role="combobox"
          aria-expanded={open && optionCount > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-label={`${linkPrompt} to ${field.label}`}
          value={query}
          placeholder={`${linkPrompt}…`}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, Math.max(0, optionCount - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (active < suggestions.length) add(suggestions[active].title);
              else if (showCreate) add(query.trim());
            } else if (e.key === 'Escape') {
              setOpen(false);
            } else if (e.key === 'Backspace' && !query && values.length > 0) {
              remove(values[values.length - 1]);
            }
          }}
          className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] pl-7 pr-2.5 py-1.5 text-xs outline-none"
        />
        {open && optionCount > 0 && (
          <ul
            id={`${id}-list`}
            role="listbox"
            className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-lg p-1"
          >
            {suggestions.map((e, i) => (
              <li
                key={e.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  add(e.title);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer ${
                  i === active ? 'bg-black/5 dark:bg-white/10' : ''
                }`}
              >
                <span className="truncate">{e.title}</span>
                <span className="text-[10px] text-[var(--studio-muted)] shrink-0">{typeName(e.type)}</span>
              </li>
            ))}
            {showCreate && (
              <li
                role="option"
                aria-selected={active === suggestions.length}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  add(query.trim());
                }}
                onMouseEnter={() => setActive(suggestions.length)}
                className={`px-2 py-1.5 rounded-md text-xs cursor-pointer text-[var(--studio-muted)] ${
                  active === suggestions.length ? 'bg-black/5 dark:bg-white/10' : ''
                }`}
              >
                Link "{query.trim()}" (not created yet)
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
