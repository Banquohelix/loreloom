import type { StudioAppearance, WorldTheme, WorldThemePresetId } from '../shared/types';

export interface WorldThemePreset {
  id: WorldThemePresetId;
  name: string;
  description: string;
  defaultTheme: WorldTheme;
  lightSurface: string;
  darkSurface: string;
  lightBorder: string;
  darkBorder: string;
  lightMuted: string;
  darkMuted: string;
}

export const WORLD_THEME_PRESETS: Record<WorldThemePresetId, WorldThemePreset> = {
  'minimal-studio': {
    id: 'minimal-studio',
    name: 'Minimal Studio',
    description: 'Crisp Notion-clean canvas where your concept art carries all the color.',
    defaultTheme: {
      preset: 'minimal-studio',
      accentColor: '#d97706',
      headingFont: 'sans',
      surfaceTint: 'none',
      editorialDropCap: false,
    },
    lightSurface: '#ffffff',
    darkSurface: '#18181b',
    lightBorder: '#e4e4e7',
    darkBorder: '#27272a',
    lightMuted: '#f4f4f5',
    darkMuted: '#202024',
  },
  'parchment-lorebook': {
    id: 'parchment-lorebook',
    name: 'Parchment Lorebook',
    description: 'Warm archival paper & editorial serif headings for fantasy, TTRPGs, and novels.',
    defaultTheme: {
      preset: 'parchment-lorebook',
      accentColor: '#b45309',
      headingFont: 'serif',
      surfaceTint: 'warm',
      editorialDropCap: true,
    },
    lightSurface: '#fbf8f1',
    darkSurface: '#1c1917',
    lightBorder: '#e7dfd0',
    darkBorder: '#2e2925',
    lightMuted: '#f3ede0',
    darkMuted: '#25211d',
  },
  'scifi-slate': {
    id: 'scifi-slate',
    name: 'Sci-Fi Slate',
    description: 'Cool precision surface with crisp technical typography for sci-fi & cyber worlds.',
    defaultTheme: {
      preset: 'scifi-slate',
      accentColor: '#0284c7',
      headingFont: 'mono',
      surfaceTint: 'cool',
      editorialDropCap: false,
    },
    lightSurface: '#f8fafc',
    darkSurface: '#0f172a',
    lightBorder: '#dce5f0',
    darkBorder: '#1e293b',
    lightMuted: '#eef3f8',
    darkMuted: '#162033',
  },
  'dark-fantasy-ink': {
    id: 'dark-fantasy-ink',
    name: 'Dark Fantasy Ink',
    description: 'Moody crimson-accented ink & classic serif display for gothic or grimdark settings.',
    defaultTheme: {
      preset: 'dark-fantasy-ink',
      accentColor: '#be123c',
      headingFont: 'serif',
      surfaceTint: 'rose',
      editorialDropCap: true,
    },
    lightSurface: '#faf7f7',
    darkSurface: '#161316',
    lightBorder: '#e6dcdc',
    darkBorder: '#2b232a',
    lightMuted: '#f2ecec',
    darkMuted: '#1f1a1f',
  },
  'botanical-codex': {
    id: 'botanical-codex',
    name: 'Botanical Codex',
    description: 'Soft sage parchment and emerald accents for naturalistic, mythic, or solarpunk worlds.',
    defaultTheme: {
      preset: 'botanical-codex',
      accentColor: '#059669',
      headingFont: 'serif',
      surfaceTint: 'sage',
      editorialDropCap: false,
    },
    lightSurface: '#f7faf7',
    darkSurface: '#121a16',
    lightBorder: '#dce6de',
    darkBorder: '#213028',
    lightMuted: '#edf4ee',
    darkMuted: '#19241e',
  },
};

export function listWorldThemePresets(): WorldThemePreset[] {
  return Object.values(WORLD_THEME_PRESETS);
}

export function getDefaultWorldTheme(preset: WorldThemePresetId = 'parchment-lorebook'): WorldTheme {
  const entry = WORLD_THEME_PRESETS[preset] ?? WORLD_THEME_PRESETS['minimal-studio'];
  return { ...entry.defaultTheme };
}

export interface ResolvedWorldCssTokens {
  '--world-accent': string;
  '--world-accent-soft': string;
  '--world-canvas-bg': string;
  '--world-canvas-muted': string;
  '--world-canvas-border': string;
  '--world-heading-font': string;
  '--world-body-font': string;
}

const HEADING_FONT_STACKS: Record<WorldTheme['headingFont'], string> = {
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  serif: "'Cormorant Garamond', 'Newsreader', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
};

const BODY_FONT_STACKS: Record<WorldTheme['headingFont'], string> = {
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  serif: "'Newsreader', 'Inter', Georgia, serif",
  mono: "'Inter', system-ui, -apple-system, sans-serif",
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `rgba(217, 119, 6, ${alpha})`;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function resolveWorldTokens(
  theme: WorldTheme,
  appearance: StudioAppearance
): ResolvedWorldCssTokens {
  const preset = WORLD_THEME_PRESETS[theme.preset] ?? WORLD_THEME_PRESETS['minimal-studio'];
  const isDark = appearance === 'dark';

  return {
    '--world-accent': theme.accentColor || preset.defaultTheme.accentColor,
    '--world-accent-soft': hexToRgba(
      theme.accentColor || preset.defaultTheme.accentColor,
      isDark ? 0.18 : 0.12
    ),
    '--world-canvas-bg': isDark ? preset.darkSurface : preset.lightSurface,
    '--world-canvas-muted': isDark ? preset.darkMuted : preset.lightMuted,
    '--world-canvas-border': isDark ? preset.darkBorder : preset.lightBorder,
    '--world-heading-font': HEADING_FONT_STACKS[theme.headingFont] ?? HEADING_FONT_STACKS.sans,
    '--world-body-font': BODY_FONT_STACKS[theme.headingFont] ?? BODY_FONT_STACKS.sans,
  };
}
