import { useEffect, useMemo, useState } from 'react';
import { api, Settings } from '../lib/api';
import { APP_CONFIG } from '../config';

const BRANDING_SETTINGS_STORAGE_KEY = 'branding-settings-cache:v1';

const DEFAULT_SETTINGS: Settings = {
  aiEnabled: false,
  activeProvider: 'gemini',
  enabledProviders: ['gemini'],
  aiAutoTagEnabled: false,
  aiSummarizeEnabled: false,
  aiNextBestActionEnabled: true,
  aiRiskNarrativeEnabled: true,
  aiDuplicateDetectionEnabled: true,
  aiPmApproachEnabled: true,
  aiRequireHumanApproval: true,
  privacyMode: 'private-read',
  suiteName: APP_CONFIG.appName,
  portalName: APP_CONFIG.portalName,
  logoDataUrl: '',
  primaryColor: '#002045',
  brandDarkColor: '#1A365D',
  customFooter: '',
  helpContactEmail: '',
};

let preloadedSettings: Settings | null = null;
let preloadPromise: Promise<Settings> | null = null;

function saveCachedSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(BRANDING_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write failures.
  }
}

function readCachedSettings(): Settings | null {
  try {
    const raw = window.localStorage.getItem(BRANDING_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      enabledProviders: Array.isArray(parsed.enabledProviders) && parsed.enabledProviders.length > 0
        ? parsed.enabledProviders
        : DEFAULT_SETTINGS.enabledProviders,
      activeProvider: parsed.activeProvider ?? DEFAULT_SETTINGS.activeProvider,
    };
  } catch {
    return null;
  }
}

export function applyBrandingToDocument(settings: Pick<Settings, 'primaryColor' | 'brandDarkColor'>): void {
  document.documentElement.style.setProperty('--brand-primary', settings.primaryColor);
  document.documentElement.style.setProperty('--brand-dark', settings.brandDarkColor);
}

const resolveBrandingSettings = async (): Promise<Settings> => {
  if (preloadedSettings) {
    return preloadedSettings;
  }

  if (!preloadPromise) {
    preloadPromise = api.getSettings()
      .then((response) => {
        preloadedSettings = response;
        applyBrandingToDocument(response);
        saveCachedSettings(response);
        return response;
      })
      .catch(() => {
        const cached = readCachedSettings();
        preloadedSettings = cached ?? DEFAULT_SETTINGS;
        applyBrandingToDocument(preloadedSettings);
        return preloadedSettings;
      });
  }

  return preloadPromise;
};

export async function preloadBrandingSettings(): Promise<void> {
  if (typeof window === 'undefined') return;

  const cached = readCachedSettings();
  if (cached) {
    preloadedSettings = cached;
    applyBrandingToDocument(cached);
  }

  await resolveBrandingSettings();
}

export function useBranding() {
  const [settings, setSettings] = useState<Settings>(() => {
    if (preloadedSettings) return preloadedSettings;
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    return readCachedSettings() ?? DEFAULT_SETTINGS;
  });
  const [isBrandingHydrated, setIsBrandingHydrated] = useState(false);

  useEffect(() => {
    resolveBrandingSettings()
      .then((response) => {
        setSettings(response);
      })
      .finally(() => {
        setIsBrandingHydrated(true);
      });
  }, []);

  const branding = useMemo(() => ({
    /** Short product name shown in compact chrome (e.g. top bar). */
    suiteName: settings.suiteName || APP_CONFIG.appName,
    /** Organization or portal title shown as the primary identity. */
    portalName: settings.portalName || APP_CONFIG.portalName,
    logoUrl: settings.logoDataUrl || '',
  }), [settings]);

  return { settings, setSettings, branding, isBrandingHydrated };
}
