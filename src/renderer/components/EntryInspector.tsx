import { ArrowUpRight, Trash2 } from 'lucide-react';
import type {
  BacklinkRef,
  Entry,
  EntryPropertyValue,
  WorldConfig,
} from '@shared/types';

interface EntryInspectorProps {
  world: WorldConfig;
  entry: Entry;
  backlinks: BacklinkRef[];
  onChangeType: (typeId: string) => Promise<void>;
  onChangeFolder: (folder: string) => Promise<void>;
  onUpdateProperties: (properties: Record<string, EntryPropertyValue>) => Promise<void>;
  onNavigateEntry: (entryId: string) => void;
  onDeleteEntry: () => Promise<void>;
}

export function EntryInspector({
  world,
  entry,
  backlinks,
  onChangeType,
  onChangeFolder,
  onUpdateProperties,
  onNavigateEntry,
  onDeleteEntry,
}: EntryInspectorProps) {
  const activeType = world.entityTypes.find((t) => t.id === entry.type) ?? world.entityTypes[0];

  const handleFieldChange = (key: string, value: string) => {
    const next = { ...entry.properties, [key]: value };
    onUpdateProperties(next);
  };

  // Show any extra frontmatter keys (e.g. imported from Obsidian) not in the EntityType schema
  const schemaKeys = new Set(activeType?.fields.map((f) => f.key) ?? []);
  const extraEntries = Object.entries(entry.properties).filter(([k]) => !schemaKeys.has(k));

  return (
    <aside className="w-72 shrink-0 h-full border-l border-[var(--studio-border)] bg-[var(--studio-sidebar)] overflow-y-auto p-4 space-y-6">
      {/* Entity Type & Folder */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
          Classification
        </div>
        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1">Entity Type</label>
          <select
            value={entry.type}
            onChange={(e) => onChangeType(e.target.value)}
            className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none"
          >
            {world.entityTypes.map((et) => (
              <option key={et.id} value={et.id}>
                {et.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1">Folder</label>
          <input
            defaultValue={entry.folder}
            key={entry.id + entry.folder}
            onBlur={(e) => {
              if (e.target.value !== entry.folder) onChangeFolder(e.target.value);
            }}
            placeholder="e.g. characters/main"
            className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none"
          />
        </div>
      </div>

      {/* Schema Properties */}
      {activeType && activeType.fields.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
            {activeType.name} Properties
          </div>
          {activeType.fields.map((field) => {
            const val = entry.properties[field.key];
            const strVal = Array.isArray(val) ? val.join(', ') : val !== undefined ? String(val) : '';
            return (
              <div key={field.key}>
                <label className="block text-xs text-[var(--studio-muted)] mb-1">
                  {field.label}
                </label>
                {field.fieldType === 'select' && field.options ? (
                  <select
                    value={strVal}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none"
                  >
                    <option value="">—</option>
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    defaultValue={strVal}
                    key={`${entry.id}-${field.key}`}
                    onBlur={(e) => {
                      if (e.target.value !== strVal) handleFieldChange(field.key, e.target.value);
                    }}
                    placeholder={`Enter ${field.label.toLowerCase()}…`}
                    className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-1.5 text-xs outline-none"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Extra Imported Frontmatter */}
      {extraEntries.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
            Additional Metadata
          </div>
          {extraEntries.map(([k, v]) => (
            <div key={k} className="text-xs flex justify-between gap-2 py-1 border-b border-[var(--studio-border)]/60">
              <span className="text-[var(--studio-muted)] truncate">{k}</span>
              <span className="font-medium truncate">
                {Array.isArray(v) ? v.join(', ') : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Backlinks */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
          Backlinks ({backlinks.length})
        </div>
        {backlinks.length === 0 ? (
          <div className="text-xs text-[var(--studio-muted)]">
            No entries link to <code className="opacity-80">[[{entry.title}]]</code> yet.
          </div>
        ) : (
          <div className="space-y-1.5">
            {backlinks.map((bl) => (
              <button
                key={bl.sourceId}
                onClick={() => onNavigateEntry(bl.sourceId)}
                className="w-full text-left p-2.5 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] hover:border-amber-500/50 transition cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs font-medium mb-0.5">
                  <span className="truncate">{bl.sourceTitle}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-[var(--studio-muted)] shrink-0" />
                </div>
                <div className="text-[11px] text-[var(--studio-muted)] line-clamp-2">
                  {bl.context}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="pt-4 border-t border-[var(--studio-border)]">
        <button
          onClick={onDeleteEntry}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Entry
        </button>
      </div>
    </aside>
  );
}
