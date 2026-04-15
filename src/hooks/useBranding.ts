import { useEffect, useMemo, useState } from 'react';
import { api, Settings } from '../lib/api';
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
};

export function applyBrandingToDocument(settings: Pick<Settings, 'primaryColor' | 'brandDarkColor'>): void {
  document.documentElement.style.setProperty('--brand-primary', settings.primaryColor);
  document.documentElement.style.setProperty('--brand-dark', settings.brandDarkColor);
}

export function useBranding() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    api.getSettings()
      .then((response) => {
        setSettings(response);
        applyBrandingToDocument(response);
      })
      .catch(() => {
        applyBrandingToDocument(DEFAULT_SETTINGS);
      });
  }, []);

  const branding = useMemo(() => ({
    appName: settings.suiteName || APP_CONFIG.appName,
    portalName: settings.portalName || APP_CONFIG.portalName,
    logoUrl: settings.logoDataUrl || '',
  }), [settings]);

  return { settings, setSettings, branding };
}
