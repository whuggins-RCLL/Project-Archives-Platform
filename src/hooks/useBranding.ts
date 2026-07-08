import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
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
  heroImageDataUrl: '',
  primaryColor: '#002045',
  brandDarkColor: '#1A365D',
  customFooter: '',
  helpContactEmail: '',
  googleDriveFolderBaseUrl: '',
  googleCalendarId: '',
  heroQuickLinks: [],
  heroNarrativeDraft: '',
  heroNarrativePublished: '',
};

let preloadedSettings: Settings | null = null;
let serverFetchPromise: Promise<Settings> | null = null;

function saveCachedSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(BRANDING_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write failures.
  }
}

function commitBrandingSettings(settings: Settings): void {
  preloadedSettings = settings;
  serverFetchPromise = Promise.resolve(settings);
  applyBrandingToDocument(settings);
  saveCachedSettings(settings);
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

/**
 * Fetch settings from the server and commit them as the source of truth.
 * The localStorage cache is only a fast-paint/offline fallback — it must never
 * mask what is actually stored on the backend, otherwise settings look saved
 * on this device while other devices see nothing.
 */
const resolveBrandingSettings = (): Promise<Settings> => {
  if (!serverFetchPromise) {
    serverFetchPromise = api.getSettings()
      .then((response) => {
        commitBrandingSettings(response);
        return response;
      })
      .catch(() => {
        // Server unreachable: clear the promise so a later mount can retry,
        // and fall back to the last known copy for this session.
        serverFetchPromise = null;
        const fallback = preloadedSettings ?? readCachedSettings() ?? DEFAULT_SETTINGS;
        preloadedSettings = fallback;
        applyBrandingToDocument(fallback);
        return fallback;
      });
  }

  return serverFetchPromise;
};

export async function preloadBrandingSettings(): Promise<void> {
  if (typeof window === 'undefined') return;

  const cached = readCachedSettings();
  if (cached) {
    preloadedSettings = cached;
    applyBrandingToDocument(cached);
  }

  const revalidation = resolveBrandingSettings();
  // With a cached copy we can paint immediately and let the server copy land
  // via useBranding's effect; without one, wait so first paint shows real data.
  if (!cached) {
    await revalidation;
  }
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

  const setSettingsAndCache = useCallback<Dispatch<SetStateAction<Settings>>>((value) => {
    setSettings((previous) => {
      const next = typeof value === 'function'
        ? (value as (previous: Settings) => Settings)(previous)
        : value;
      commitBrandingSettings(next);
      return next;
    });
  }, []);

  /**
   * Live-preview unsaved edits (e.g. while typing in the settings form).
   * Updates React state and document CSS variables only — never the
   * localStorage cache, so unsaved edits can't masquerade as saved settings.
   */
  const previewSettings = useCallback<Dispatch<SetStateAction<Settings>>>((value) => {
    setSettings((previous) => {
      const next = typeof value === 'function'
        ? (value as (previous: Settings) => Settings)(previous)
        : value;
      applyBrandingToDocument(next);
      return next;
    });
  }, []);

  const branding = useMemo(() => ({
    /** Short product name shown in compact chrome (e.g. top bar). */
    suiteName: settings.suiteName || APP_CONFIG.appName,
    /** Organization or portal title shown as the primary identity. */
    portalName: settings.portalName || APP_CONFIG.portalName,
    logoUrl: settings.logoDataUrl || '',
    /** Optional custom background image for the public hero section. */
    heroImageUrl: settings.heroImageDataUrl || '',
  }), [settings]);

  return { settings, setSettings: setSettingsAndCache, previewSettings, branding, isBrandingHydrated };
}
