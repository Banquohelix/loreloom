import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { EntityTypeDef, PropertyFieldDef } from '@shared/types';
import { AVAILABLE_ICON_KEYS, EntityIcon } from './IconBadge';

interface EntityTypeModalProps {
  onSave: (entityType: EntityTypeDef) => Promise<void>;
  onClose: () => void;
}

const COLORS = ['#d97706', '#059669', '#7c3aed', '#e11d48', '#0284c7', '#64748b'];

export function EntityTypeModal({ onSave, onClose }: EntityTypeModalProps) {
  const [name, setName] = useState('');
  const [pluralName, setPluralName] = useState('');
  const [icon, setIcon] = useState('sparkles');
  const [color, setColor] = useState(COLORS[0]);
  const [defaultView, setDefaultView] = useState<'gallery' | 'table'>('gallery');
  const [fields, setFields] = useState<PropertyFieldDef[]>([
    { key: 'summary', label: 'Summary', fieldType: 'text' },
  ]);

  const handleAddField = () => {
    setFields((prev) => [
      ...prev,
      { key: `field_${prev.length + 1}`, label: '', fieldType: 'text' },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const cleanFields = fields
      .filter((f) => f.label.trim())
      .map((f) => ({
        ...f,
        key: f.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, ''),
      }));

    await onSave({
      id: id || `custom-${Date.now()}`,
      name: name.trim(),
      pluralName: pluralName.trim() || `${name.trim()}s`,
      icon,
      color,
      defaultView,
      fields: cleanFields,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-6"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-w-lg w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">New Custom Entity Type</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--studio-muted)] mb-1">Singular Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Starship, Spell, Chapter"
              className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--studio-muted)] mb-1">Plural Name</label>
            <input
              value={pluralName}
              onChange={(e) => setPluralName(e.target.value)}
              placeholder="e.g. Starships"
              className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1.5">Icon & Color</label>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {AVAILABLE_ICON_KEYS.slice(0, 10).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setIcon(k)}
                  className={`p-2 rounded-lg border transition cursor-pointer ${
                    icon === k ? 'border-amber-500 bg-amber-500/10' : 'border-transparent hover:bg-black/5'
                  }`}
                >
                  <EntityIcon name={k} className="w-4 h-4" />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
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
          <label className="block text-xs text-[var(--studio-muted)] mb-1.5">Default Collection Layout</label>
          <div className="grid grid-cols-2 gap-2">
            {(['gallery', 'table'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDefaultView(m)}
                className={`py-2 rounded-lg border text-xs font-medium capitalize cursor-pointer ${
                  defaultView === m ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--studio-border)]'
                }`}
              >
                {m} View
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--studio-muted)]">Custom Properties</label>
            <button
              type="button"
              onClick={handleAddField}
              className="text-xs font-medium text-amber-600 flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Field
            </button>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {fields.map((f, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  value={f.label}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, label: e.target.value } : item))
                    )
                  }
                  placeholder="Field name (e.g. Hull Class)"
                  className="flex-1 rounded-lg border border-[var(--studio-border)] bg-transparent px-2.5 py-1.5 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => setFields((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-1.5 text-[var(--studio-muted)] hover:text-red-500 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs border border-[var(--studio-border)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 cursor-pointer"
          >
            Create Entity Type
          </button>
        </div>
      </form>
    </div>
  );
}
