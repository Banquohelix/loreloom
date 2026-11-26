import { describe, it, expect } from 'vitest';
import { getDefaultWorldTheme, listWorldThemePresets, resolveWorldTokens } from '../theme-engine';

describe('ThemeEngine', () => {
  it('lists curated presets and resolves light and dark CSS tokens', () => {
    const presets = listWorldThemePresets();
    expect(presets.length).toBeGreaterThanOrEqual(5);

    const theme = getDefaultWorldTheme('parchment-lorebook');
    const light = resolveWorldTokens(theme, 'light');
    const dark = resolveWorldTokens(theme, 'dark');

    expect(light['--world-canvas-bg']).toBe('#fbf8f1');
    expect(dark['--world-canvas-bg']).toBe('#1c1917');
    expect(light['--world-heading-font']).toContain('Cormorant Garamond');
    expect(light['--world-accent']).toBe(theme.accentColor);
  });
});
