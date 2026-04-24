import { useEffect, useMemo, useState } from 'react';
import { api, Settings } from '../lib/api';
import { APP_CONFIG } from '../config';

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
  privacyMode: 'public-read',
  suiteName: APP_CONFIG.appName,
  portalName: APP_CONFIG.portalName,
  logoDataUrl: '',
  primaryColor: '#002045',
  brandDarkColor: '#1A365D',
  themePreference: 'system',
  customFooter: '',
  helpContactEmail: '',
};

function getReadableTextColor(hex: string): '#0f172a' | '#ffffff' {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return '#ffffff';
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? '#0f172a' : '#ffffff';
}

export function applyBrandingToDocument(settings: Pick<Settings, 'primaryColor' | 'brandDarkColor'>): void {
  document.documentElement.style.setProperty('--brand-primary', settings.primaryColor);
  document.documentElement.style.setProperty('--brand-dark', settings.brandDarkColor);
  document.documentElement.style.setProperty('--brand-on-primary', getReadableTextColor(settings.primaryColor));
  document.documentElement.style.setProperty('--brand-on-dark', getReadableTextColor(settings.brandDarkColor));
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
    /** Short product name shown in compact chrome (e.g. top bar). */
    suiteName: settings.suiteName || APP_CONFIG.appName,
    /** Organization or portal title shown as the primary identity. */
    portalName: settings.portalName || APP_CONFIG.portalName,
    logoUrl: settings.logoDataUrl || '',
  }), [settings]);

  return { settings, setSettings, branding };
}
