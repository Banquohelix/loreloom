import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { CreateWorldInput, WorldMedium, WorldThemePresetId } from '@shared/types';
import { listWorldThemePresets } from '@core/theme-engine';

interface CreateWorldModalProps {
  onCreate: (input: CreateWorldInput) => Promise<void>;
  onClose: () => void;
}

export function CreateWorldModal({ onCreate, onClose }: CreateWorldModalProps) {
  const presets = listWorldThemePresets();
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [medium, setMedium] = useState<WorldMedium>('video-game');
  const [preset, setPreset] = useState<WorldThemePresetId>('parchment-lorebook');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate({ name: name.trim(), subtitle: subtitle.trim(), medium, preset });
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
        className="max-w-md w-full rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Create New World / Project</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1">World Name</label>
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Shattered Crown, Helion Drift"
            className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--studio-muted)] mb-1">Short Logline / Subtitle</label>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="e.g. Grimdark archipelago TTRPG campaign"
            className="w-full rounded-lg border border-[var(--studio-border)] bg-transparent px-3 py-2 text-sm outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--studio-muted)] mb-1">Medium</label>
            <select
              value={medium}
              onChange={(e) => setMedium(e.target.value as WorldMedium)}
              className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-2 text-xs outline-none"
            >
              <option value="video-game">Video Game</option>
              <option value="ttrpg">Tabletop RPG</option>
              <option value="novel">Novel</option>
              <option value="short-story">Short Story</option>
              <option value="film">Film / Screenplay</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--studio-muted)] mb-1">Starting Theme</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as WorldThemePresetId)}
              className="w-full rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] px-2.5 py-2 text-xs outline-none"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
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
            Create World
          </button>
        </div>
      </form>
    </div>
  );
}
