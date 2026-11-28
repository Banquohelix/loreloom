import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { EntityTypeDef, PropertyFieldType } from '@shared/types';
import {
  finalizeFields,
  PROPERTY_FIELD_TYPES,
  toFieldDraft,
  uniqueTypeId,
  type FieldDraft,
} from '@shared/entity-type-utils';
import { AVAILABLE_ICON_KEYS, EntityIcon } from './IconBadge';
import { useModalA11y } from '../lib/use-modal-a11y';

interface EntityTypeModalProps {
  /** Existing type to edit; omit to create a new one. */
  initial?: EntityTypeDef;
  existingTypes: EntityTypeDef[];
  /** Number of entries using `initial` (shown when deleting). */
  usageCount?: number;
  onSave: (entityType: EntityTypeDef) => Promise<void>;
  onDelete?: (typeId: string) => Promise<void>;
  onClose: () => void;
}

const COLORS = ['#d97706', '#059669', '#7c3aed', '#e11d48', '#0284c7', '#64748b'];
type LayoutChoice = EntityTypeDef['defaultView'];

export function EntityTypeModal({ initial, existingTypes, usageCount = 0, onSave, onDelete, onClose }: EntityTypeModalProps) {
  const editing = Boolean(initial);
  const dialogRef = useModalA11y<HTMLFormElement>(onClose);
  const [name, setName] = useState(initial?.name ?? '');
  const [pluralName, setPluralName] = useState(initial?.pluralName ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'sparkles');
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [defaultView, setDefaultView] = useState<LayoutChoice>(initial?.defaultView ?? 'gallery');
  const [fields, setFields] = useState<FieldDraft[]>(
    initial ? initial.fields.map(toFieldDraft) : [{ key: '', label: 'Summary', fieldType: 'text', optionsText: '' }]
  );
  const [saving, setSaving] = useState(false);

  const updateField = (idx: number, patch: Partial<FieldDraft>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const id = initial?.id ?? uniqueTypeId(name, existingTypes.map((t) => t.id));
      await onSave({
        ...(initial ?? {}),
        id,
        name: name.trim(),
        pluralName: pluralName.trim() || `${name.trim()}s`,
        icon,
        color,
        defaultView,
        fields: finalizeFields(fields),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initial || !onDelete) return;
    const ok = window.confirm(
      `Delete the "${initial.name}" type?\n\n` +
        (usageCount > 0
          ? `${usageCount} ${usageCount === 1 ? 'entry uses' : 'entries use'} it. Their files and text are kept; they'll show without this type's properties until you give them another type.`
          : 'No entries use it.')
    );
    if (!ok) return;
    await onDelete(initial.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6" onClick={onClose}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="entity-type-modal-title"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-w-xl w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 id="entity-type-modal-title" className="text-base font-semibold">
            {editing ? `Edit “${initial!.name}” Type` : 'New Custom Entity Type'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="et-name" className="block text-xs text-[var(--studio-muted)] mb-1">Singular Name</label>
            <input
              id="et-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Starship, Spell, Chapter"
              className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="et-plural" className="block text-xs text-[var(--studio-muted)] mb-1">Plural Name</label>
            <input
              id="et-plural"
              value={pluralName}
              onChange={(e) => setPluralName(e.target.value)}
              placeholder="e.g. Starships"
              className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        <div>
          <div className="block text-xs text-[var(--studio-muted)] mb-1.5">Icon & Color</div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap" role="radiogroup" aria-label="Icon">
              {AVAILABLE_ICON_KEYS.slice(0, 10).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={icon === k}
                  aria-label={k}
                  onClick={() => setIcon(k)}
                  className={`p-2 rounded-lg border transition cursor-pointer ${
                    icon === k ? 'border-amber-500 bg-amber-500/10' : 'border-transparent hover:bg-black/5'
                  }`}
                >
                  <EntityIcon name={k} className="w-4 h-4" />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Color">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`w-5 h-5 rounded-full border-2 cursor-pointer ${
                    color === c ? 'border-zinc-900 dark:border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="block text-xs text-[var(--studio-muted)] mb-1.5">Default Collection Layout</div>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Default layout">
            {(['gallery', 'table', 'board', 'timeline'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={defaultView === m}
                onClick={() => setDefaultView(m)}
                className={`py-2 rounded-lg border text-xs font-medium capitalize cursor-pointer ${
                  defaultView === m ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--studio-border)]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--studio-muted)]">Properties</span>
            <button
              type="button"
              onClick={() => setFields((prev) => [...prev, { key: '', label: '', fieldType: 'text', optionsText: '' }])}
              className="text-xs font-medium text-amber-600 flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Field
            </button>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {fields.map((f, idx) => (
              <div key={idx} className="space-y-1.5 rounded-lg border border-[var(--studio-border)] p-2">
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Field ${idx + 1} name`}
                    value={f.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    placeholder="Field name (e.g. Hull Class)"
                    className="flex-1 rounded-lg border border-[var(--studio-border)] bg-transparent px-2.5 py-1.5 text-xs outline-none"
                  />
                  <select
                    aria-label={`Field ${idx + 1} type`}
                    value={f.fieldType}
                    onChange={(e) => updateField(idx, { fieldType: e.target.value as PropertyFieldType })}
                    className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2 py-1.5 text-xs outline-none"
                  >
                    {PROPERTY_FIELD_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove field ${f.label || idx + 1}`}
                    onClick={() => setFields((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 text-[var(--studio-muted)] hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {(f.fieldType === 'select' || f.fieldType === 'multi-select') && (
                  <input
                    aria-label={`Field ${idx + 1} options`}
                    value={f.optionsText}
                    onChange={(e) => updateField(idx, { optionsText: e.target.value })}
                    placeholder="Options, comma-separated (e.g. Alive, Deceased, Missing)"
                    className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-2.5 py-1.5 text-xs outline-none"
                  />
                )}
                {editing && f.key && (
                  <div className="text-[10px] text-[var(--studio-muted)]">
                    Saved as <code>{f.key}</code>. Renaming the label keeps existing values.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <div>
            {editing && onDelete && !initial!.builtIn && initial!.id !== 'page' && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-2 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
              >
                Delete Type
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs border border-[var(--studio-border)] cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 cursor-pointer disabled:opacity-50"
            >
              {editing ? 'Save Changes' : 'Create Entity Type'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
