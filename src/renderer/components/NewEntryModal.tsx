import { useMemo, useState } from 'react';
import { FilePlus2, Layers, X } from 'lucide-react';
import type { EntrySummary, WorldConfig } from '@shared/types';
import { TEMPLATE_TYPE_ID, templateTarget, templatesForType } from '@shared/templates';
import { useModalA11y } from '../lib/use-modal-a11y';

export interface NewEntryChoice {
  typeId: string;
  title: string;
  /** Template entry to copy from, or null for a blank entry */
  templateId: string | null;
}

interface NewEntryModalProps {
  world: WorldConfig;
  entries: EntrySummary[];
  initialTypeId: string;
  onCreate: (choice: NewEntryChoice) => Promise<void>;
  onClose: () => void;
}

/** Name the new entry and start blank or from one of the World's templates. */
export function NewEntryModal({ world, entries, initialTypeId, onCreate, onClose }: NewEntryModalProps) {
  const dialogRef = useModalA11y<HTMLFormElement>(onClose);
  const creatableTypes = world.entityTypes.filter((t) => t.id !== TEMPLATE_TYPE_ID);
  const [typeId, setTypeId] = useState(initialTypeId);
  const [title, setTitle] = useState('');
  const templates = useMemo(() => templatesForType(entries, typeId), [entries, typeId]);
  const [templateId, setTemplateId] = useState<string | null>(() => templatesForType(entries, initialTypeId)[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const type = world.entityTypes.find((t) => t.id === typeId);
  const typeName = type?.name ?? 'Entry';
  const typeLabel = (id: string | null) =>
    id ? `for ${world.entityTypes.find((t) => t.id === id)?.pluralName ?? id}` : 'for any type';

  const submit = async (chosen: string | null = templateId) => {
    if (busy) return;
    setBusy(true);
    try {
      await onCreate({
        typeId,
        title: title.trim() || `Untitled ${typeName}`,
        templateId: templates.some((t) => t.id === chosen) ? chosen : null,
      });
    } finally {
      setBusy(false);
    }
  };

  const choiceClass = (on: boolean) =>
    `w-full text-left flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition ${
      on
        ? 'border-[var(--world-accent)] bg-[var(--world-accent-soft)]'
        : 'border-[var(--studio-border)] hover:bg-black/5 dark:hover:bg-white/5'
    }`;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6" onClick={onClose}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`New ${typeName}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="max-w-lg w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-4 max-h-[86vh] flex flex-col"
      >
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold">New {typeName}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2 shrink-0">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Untitled ${typeName}`}
            aria-label="Name"
            className="rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--world-accent)]"
          />
          <select
            value={typeId}
            aria-label="Collection"
            onChange={(e) => {
              setTypeId(e.target.value);
              setTemplateId(templatesForType(entries, e.target.value)[0]?.id ?? null);
            }}
            className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2 py-2 text-xs outline-none"
          >
            {creatableTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div role="radiogroup" aria-label="Start from" className="flex-1 overflow-y-auto space-y-1.5 -mx-1 px-1">
          <button type="button" role="radio" aria-checked={templateId === null} onClick={() => setTemplateId(null)} className={choiceClass(templateId === null)}>
            <FilePlus2 className="w-4 h-4 mt-0.5 shrink-0 text-[var(--studio-muted)]" />
            <span>
              <span className="block text-sm font-medium">Blank {typeName.toLowerCase()}</span>
              <span className="block text-[11px] text-[var(--studio-muted)]">Start from an empty page</span>
            </span>
          </button>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={templateId === t.id}
              onClick={() => setTemplateId(t.id)}
              onDoubleClick={() => {
                setTemplateId(t.id);
                void submit(t.id);
              }}
              className={choiceClass(templateId === t.id)}
            >
              <Layers className="w-4 h-4 mt-0.5 shrink-0 text-[var(--studio-muted)]" />
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{t.title}</span>
                <span className="block text-[11px] text-[var(--studio-muted)] truncate">
                  Template {typeLabel(templateTarget(t))}
                  {t.excerpt ? ` · ${t.excerpt}` : ''}
                </span>
              </span>
            </button>
          ))}
          {templates.length === 0 && (
            <p className="text-[11px] text-[var(--studio-muted)] px-1 pt-1">
              No templates for {type?.pluralName ?? 'this type'} yet. Open any entry and use “Save as template” in its
              side panel to make one.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 shrink-0">
          <span className="text-[10px] text-[var(--studio-muted)]">
            Templates can use <code>{'{{title}}'}</code>, <code>{'{{date}}'}</code> and <code>{'{{type}}'}</code>
          </span>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium disabled:opacity-50 cursor-pointer"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
