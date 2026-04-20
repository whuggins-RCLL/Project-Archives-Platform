import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, Settings, TypographyFamily } from '../lib/api';
import { APP_CONFIG } from '../config';

const DEFAULT_SETTINGS: Settings = {
  aiEnabled: false,
  activeProvider: 'gemini',
  aiNextBestActionEnabled: true,
  aiRiskNarrativeEnabled: true,
  aiDuplicateDetectionEnabled: true,
  aiRequireHumanApproval: true,
  privacyMode: 'public-read',
  suiteName: APP_CONFIG.appName,
  portalName: APP_CONFIG.portalName,
  logoDataUrl: '',
  primaryColor: '#002045',
  brandDarkColor: '#1A365D',
  customFooter: '',
  helpContactEmail: '',
  typographyFamily: 'system',
  showRefreshPermissions: true,
  showUserPermissionDetails: true,
};

const TYPOGRAPHY_STACKS: Record<TypographyFamily, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  inter: "'Inter', system-ui, sans-serif",
  roboto: "'Roboto', system-ui, sans-serif",
  'source-sans': "'Source Sans 3', 'Source Sans Pro', system-ui, sans-serif",
  merriweather: "'Merriweather', Georgia, serif",
  playfair: "'Playfair Display', Georgia, serif",
  'ibm-plex-serif': "'IBM Plex Serif', Georgia, serif",
  'libre-baskerville': "'Libre Baskerville', Georgia, serif",
};

const TYPOGRAPHY_FONT_LINKS: Record<TypographyFamily, string | null> = {
  system: null,
  inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  roboto: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  'source-sans': 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap',
  merriweather: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&display=swap',
  playfair: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&display=swap',
  'ibm-plex-serif': 'https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@400;600;700&display=swap',
  'libre-baskerville': 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&display=swap',
};

const TYPOGRAPHY_LINK_ID = 'app-typography-font-link';

function ensureTypographyFont(family: TypographyFamily): void {
  const href = TYPOGRAPHY_FONT_LINKS[family];
  const existing = document.getElementById(TYPOGRAPHY_LINK_ID) as HTMLLinkElement | null;
  if (!href) {
    if (existing) existing.remove();
    return;
  }
  if (existing && existing.getAttribute('href') === href) return;
  const link = existing ?? document.createElement('link');
  link.id = TYPOGRAPHY_LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  if (!existing) {
    document.head.appendChild(link);
  }
}

export function applyBrandingToDocument(
  settings: Pick<Settings, 'primaryColor' | 'brandDarkColor' | 'typographyFamily'>,
): void {
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', settings.primaryColor);
  root.style.setProperty('--brand-dark', settings.brandDarkColor);
  const family = (settings.typographyFamily ?? 'system') as TypographyFamily;
  const stack = TYPOGRAPHY_STACKS[family] ?? TYPOGRAPHY_STACKS.system;
  root.style.setProperty('--brand-font-family', stack);
  document.body.style.fontFamily = stack;
  ensureTypographyFont(family);
}

type BrandingContextValue = {
  settings: Settings;
  setSettings: (next: Settings) => void;
  refreshSettings: () => Promise<void>;
  branding: {
    appName: string;
    portalName: string;
    logoUrl: string;
  };
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

function buildBranding(settings: Settings) {
  return {
    appName: settings.suiteName || APP_CONFIG.appName,
    portalName: settings.portalName || APP_CONFIG.portalName,
    logoUrl: settings.logoDataUrl || '',
  };
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const refreshSettings = useCallback(async () => {
    try {
      const response = await api.getSettings();
      setSettings(response);
      applyBrandingToDocument(response);
    } catch {
      applyBrandingToDocument(DEFAULT_SETTINGS);
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const branding = useMemo(() => buildBranding(settings), [settings]);

  const value = useMemo<BrandingContextValue>(() => ({
    settings,
    setSettings: (next: Settings) => {
      setSettings(next);
      applyBrandingToDocument(next);
    },
    refreshSettings,
    branding,
  }), [settings, branding, refreshSettings]);

  return createElement(BrandingContext.Provider, { value }, children);
}

/**
 * Returns the live branding/settings snapshot. Any component mounted inside
 * BrandingProvider automatically re-renders when settings are saved.
 */
export function useBranding(): BrandingContextValue {
  const context = useContext(BrandingContext);
  if (context) return context;
  // Fallback for tests or standalone rendering without the provider: returns
  // defaults without subscribing. In the running app, components should always
  // render inside BrandingProvider.
  return {
    settings: DEFAULT_SETTINGS,
    setSettings: () => undefined,
    refreshSettings: async () => undefined,
    branding: buildBranding(DEFAULT_SETTINGS),
  };
}
