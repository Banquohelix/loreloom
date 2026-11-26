import { X, Check } from 'lucide-react';
import type { HeadingFontStyle, WorldConfig, WorldTheme, WorldThemePresetId } from '@shared/types';
import { listWorldThemePresets } from '@core/theme-engine';

const ACCENT_SWATCHES = [
  '#b45309',
  '#d97706',
  '#be123c',
  '#7c3aed',
  '#0284c7',
  '#059669',
  '#475569',
];

interface WorldThemeDrawerProps {
  world: WorldConfig;
  onChangeTheme: (theme: WorldTheme) => Promise<void>;
  onClose: () => void;
}

export function WorldThemeDrawer({ world, onChangeTheme, onClose }: WorldThemeDrawerProps) {
  const presets = listWorldThemePresets();

  const applyPreset = (presetId: WorldThemePresetId) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    onChangeTheme({ ...preset.defaultTheme });
  };

  const patchTheme = (patch: Partial<WorldTheme>) => {
    onChangeTheme({ ...world.theme, ...patch });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-96 max-w-full h-full bg-[var(--studio-surface)] border-l border-[var(--studio-border)] p-6 overflow-y-auto shadow-2xl space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">World Theme & Style</h2>
            <p className="text-xs text-[var(--studio-muted)]">
              Saved in <code className="opacity-80">world.yaml</code> for {world.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Curated Presets */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
            Curated Presets
          </div>
          {presets.map((p) => {
            const active = world.theme.preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={`w-full text-left p-3 rounded-xl border transition cursor-pointer ${
                  active
                    ? 'border-amber-500 bg-amber-500/8'
                    : 'border-[var(--studio-border)] hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full border border-black/10"
                      style={{ backgroundColor: p.defaultTheme.accentColor }}
                    />
                    {p.name}
                  </span>
                  {active && <Check className="w-4 h-4 text-amber-600" />}
                </div>
                <p className="text-xs text-[var(--studio-muted)] leading-relaxed">
                  {p.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Accent Color */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
            Accent Color
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {ACCENT_SWATCHES.map((hex) => (
              <button
                key={hex}
                onClick={() => patchTheme({ accentColor: hex })}
                className={`w-7 h-7 rounded-full border-2 transition cursor-pointer ${
                  world.theme.accentColor.toLowerCase() === hex
                    ? 'border-zinc-900 dark:border-white scale-110'
                    : 'border-transparent'
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
            <input
              type="color"
              value={world.theme.accentColor}
              onChange={(e) => patchTheme({ accentColor: e.target.value })}
              className="w-7 h-7 rounded-full cursor-pointer border-0 bg-transparent"
              title="Custom accent color"
            />
          </div>
        </div>

        {/* Heading Typography */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-muted)]">
            Typography Feel
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'serif', label: 'Lorebook Serif' },
                { id: 'sans', label: 'Studio Sans' },
                { id: 'mono', label: 'Sci-Fi Mono' },
              ] as Array<{ id: HeadingFontStyle; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => patchTheme({ headingFont: opt.id })}
                className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition cursor-pointer ${
                  world.theme.headingFont === opt.id
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-[var(--studio-border)] hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Editorial Drop Cap */}
        <label className="flex items-center justify-between p-3 rounded-xl border border-[var(--studio-border)] cursor-pointer">
          <div>
            <div className="text-xs font-medium">Editorial Drop Cap</div>
            <div className="text-[11px] text-[var(--studio-muted)]">
              Illustrated storybook first letter on opening paragraphs
            </div>
          </div>
          <input
            type="checkbox"
            checked={world.theme.editorialDropCap}
            onChange={(e) => patchTheme({ editorialDropCap: e.target.checked })}
            className="accent-amber-600 w-4 h-4"
          />
        </label>
      </div>
    </div>
  );
}
