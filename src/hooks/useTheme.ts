import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme-preference';

const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#ffffff',
  dark: '#0c0f12',
};

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Ignore storage read failures (e.g. privacy mode).
  }
  return 'system';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return prefersDark() ? 'dark' : 'light';
  }
  return preference;
}

/**
 * Applies the resolved theme to the document so CSS custom properties and the
 * browser UI (theme-color) stay in sync. Safe to call before React mounts.
 */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEME_COLORS[resolved]);
  }
}

/**
 * Theme state manager. Persists the user's preference (light/dark/system) and
 * keeps the document in sync, including live updates when the OS preference
 * changes while the user is on "system".
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readStoredPreference()));

  useEffect(() => {
    const resolved = resolveTheme(preference);
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Ignore storage write failures.
    }

    if (preference !== 'system' || !window.matchMedia) return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = media.matches ? 'dark' : 'light';
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setPreference((current) => (current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'));
  }, []);

  return { preference, resolvedTheme, setTheme, cycleTheme };
}
