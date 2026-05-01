import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Bot, Key, Shield } from 'lucide-react';
import { api, getErrorMessage, Settings } from '../lib/api';
import { AI_PROVIDER_OPTIONS } from '../lib/uiDefaults';
import { AI_MODEL_OPTIONS } from '../constants';

export default function SettingsView({
  canManageSettings,
  canViewSettings,
  loadingRole,
  onRoleRefreshRequested,
  onSettingsUpdated,
}: {
  canManageSettings: boolean,
  canViewSettings: boolean,
  loadingRole: boolean,
  onRoleRefreshRequested?: () => Promise<void>,
  onSettingsUpdated?: (settings: Settings) => void,
}) {
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [settings, setSettings] = useState<Settings>({
    aiEnabled: false,
    activeProvider: 'gemini',
    enabledProviders: ['gemini'],
    aiAutoTagEnabled: true,
    aiSummarizeEnabled: true,
    aiNextBestActionEnabled: true,
    aiRiskNarrativeEnabled: true,
    aiDuplicateDetectionEnabled: true,
    aiPmApproachEnabled: true,
    aiRequireHumanApproval: true,
    privacyMode: 'private-read',
    suiteName: 'AI Librarian Suite',
    portalName: 'Project Archives',
    logoDataUrl: '',
    primaryColor: '#002045',
    brandDarkColor: '#1A365D',
    googleDriveFolderBaseUrl: '',
    googleCalendarId: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<{ ownerCount: number; configured: boolean; eligible: boolean } | null>(null);
  const [claimingOwner, setClaimingOwner] = useState(false);
  const [savingHeroContent, setSavingHeroContent] = useState(false);

  const handleAddHeroLink = () => setSettings((prev) => ({
    ...prev,
    heroQuickLinks: [...(prev.heroQuickLinks ?? []), { id: crypto.randomUUID(), label: '', url: '' }],
  }));



  const saveHeroContent = async (nextSettings: Settings, successMessage = 'Hero content saved.') => {
    if (readOnly) return;
    setSavingHeroContent(true);
    try {
      await api.updateSettings(nextSettings);
      onSettingsUpdated?.(nextSettings);
      setToast({ type: 'success', message: successMessage });
    } catch (error) {
      setToast({ type: 'error', message: getErrorMessage(error, 'Failed to save hero content.') });
    } finally {
      setSavingHeroContent(false);
    }
  };

  const handleAddHeroLink = () => setSettings((prev) => ({
    ...prev,
    heroQuickLinks: [...(prev.heroQuickLinks ?? []), { id: crypto.randomUUID(), label: '', url: '' }],
  }));

  const readOnly = !canManageSettings;

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await api.getSettings();
        setSettings(data);
        onSettingsUpdated?.(data);
      } catch (error) {
        console.error('Failed to fetch settings');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  useEffect(() => {
    const fetchBootstrapStatus = async () => {
      try {
        const status = await api.getOwnerBootstrapStatus();
        setBootstrapStatus(status);
      } catch {
        setBootstrapStatus(null);
      }
    };

    void fetchBootstrapStatus();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    if (readOnly) {
      setToast({ type: 'error', message: 'You have view-only access to settings.' });
      setSaving(false);
      return;
    }
    try {
      await api.updateSettings(settings);
      onSettingsUpdated?.(settings);
      setToast({ type: 'success', message: 'Settings saved successfully.' });
    } catch (error) {
      console.error('Failed to save settings', error);
      setToast({
        type: 'error',
        message: getErrorMessage(error, 'Failed to save settings. Try again, or use Refresh permissions if your role was recently updated.'),
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    onSettingsUpdated?.(settings);
  }, [settings.primaryColor, settings.brandDarkColor, settings.portalName, settings.suiteName, settings.logoDataUrl]);

  if (loading || loadingRole) return <div className="p-10">Loading settings...</div>;

  if (!canViewSettings) {
    return (
      <div className="p-10 max-w-3xl mx-auto text-center">
        <Shield className="w-16 h-16 text-error mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
        <p className="text-on-surface-variant">You do not have permissions to view archive settings.</p>
      </div>
    );
  }

  const claimOwnerAccess = async () => {
    setClaimingOwner(true);
    try {
      const result = await api.claimInitialOwnerAccess();
      setToast({ type: 'success', message: `${result.message} Refreshing claims...` });
      await api.refreshCurrentUserClaims(true);
      if (onRoleRefreshRequested) {
        await onRoleRefreshRequested();
      }
      setBootstrapStatus((prev) => ({ ownerCount: Math.max(prev?.ownerCount ?? 0, 1), configured: prev?.configured ?? true, eligible: false }));
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'Unable to claim owner access.' });
    } finally {
      setClaimingOwner(false);
    }
  };

  return (
    <div className="p-10 max-w-3xl mx-auto">
      {toast && (
        <div className="fixed top-6 right-6 z-50">
          <div className={`px-4 py-3 rounded-lg shadow-lg border text-sm font-bold ${
            toast.type === 'success'
              ? 'bg-tertiary-container text-on-tertiary-container border-tertiary-fixed/30'
              : 'bg-error-container text-error border-error/30'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="w-8 h-8 text-primary" />
        <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">Global Settings</h1>
      </div>

      {readOnly && (
        <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-on-surface-variant">
          You have read-only settings access. Owners and admins can edit and save changes.
        </div>
      )}

      {bootstrapStatus?.ownerCount === 0 && (
        <div className="mb-6 rounded-lg border border-tertiary-fixed/30 bg-tertiary-container/30 p-4 text-sm text-on-surface-variant space-y-3">
          <p className="font-bold text-on-surface">First owner setup</p>
          {bootstrapStatus.configured ? (
            <p>
              No owner accounts are configured yet. If your email is listed in <code>OWNER_EMAILS</code>, you can claim owner access here.
            </p>
          ) : (
            <p>
              No owner accounts exist yet. Since <code>OWNER_EMAILS</code> is not configured, the first signed-in user can claim owner access
              here.
            </p>
          )}
          <button
            onClick={claimOwnerAccess}
            disabled={!bootstrapStatus.eligible || claimingOwner}
            className="px-4 py-2 rounded-lg bg-primary text-white font-bold disabled:opacity-50"
          >
            {claimingOwner ? 'Claiming owner access...' : bootstrapStatus.eligible ? 'Claim owner access' : 'Owner claim unavailable'}
          </button>
        </div>
      )}

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/20 overflow-hidden">
        <div className="p-6 border-b border-outline-variant/10 bg-surface-container-low/30">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            AI Integration Features
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">Configure AI capabilities across the library portal.</p>
        </div>

        <div className="p-6 space-y-8">
          <div>
            <h3 className="font-bold text-on-surface mb-3">Project Access Mode</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  id: 'public-read',
                  name: 'Public Read',
                  desc: 'Anyone can read project portfolio metadata.'
                },
                {
                  id: 'private-read',
                  name: 'Private Read (Org)',
                  desc: 'Only authenticated organizational users can read projects.'
                }
              ].map((mode) => (
                <div
                  key={mode.id}
                  onClick={() => !readOnly && setSettings({ ...settings, privacyMode: mode.id as Settings['privacyMode'] })}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    settings.privacyMode === mode.id
                      ? 'border-primary bg-primary/5'
                      : 'border-outline-variant/20 hover:border-primary/30'
                  } ${readOnly ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                >
                  <div className="font-bold text-sm">{mode.name}</div>
                  <div className="text-xs text-on-surface-variant mt-1">{mode.desc}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-on-surface-variant mt-2">
              Use private mode for institutions that require restricted access by default.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="font-bold text-on-surface">Branding</h3>
            <p className="text-sm text-on-surface-variant -mt-2 mb-1">
              Use a clear organization title as the main name. The product line appears in smaller UI labels so you are not repeating the same phrase in the sidebar and header.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="settings-portal-name" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Primary name (organization)</label>
                <input
                  id="settings-portal-name"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.portalName}
                  maxLength={80}
                  disabled={readOnly}
                  placeholder="e.g. Library Technology and Innovation"
                  onChange={(e) => setSettings({ ...settings, portalName: e.target.value })}
                />
                <p className="text-xs text-on-surface-variant mt-1.5">Shown as the main title in the sidebar, top bar, and public site header.</p>
              </div>
              <div>
                <label htmlFor="settings-suite-name" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Product line (short)</label>
                <input
                  id="settings-suite-name"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.suiteName}
                  maxLength={80}
                  disabled={readOnly}
                  placeholder="e.g. Project workspace"
                  onChange={(e) => setSettings({ ...settings, suiteName: e.target.value })}
                />
                <p className="text-xs text-on-surface-variant mt-1.5">A short product label under the primary name; avoid duplicating the organization title.</p>
              </div>
              <div>
                <label htmlFor="settings-primary-color" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Primary Color</label>
                <input
                  id="settings-primary-color"
                  type="color"
                  className="w-16 h-10 bg-transparent border border-outline-variant/20 rounded"
                  value={settings.primaryColor}
                  disabled={readOnly}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="settings-brand-dark-color" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Dark Brand Color</label>
                <input
                  id="settings-brand-dark-color"
                  type="color"
                  className="w-16 h-10 bg-transparent border border-outline-variant/20 rounded"
                  value={settings.brandDarkColor}
                  disabled={readOnly}
                  onChange={(e) => setSettings({ ...settings, brandDarkColor: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label htmlFor="settings-logo-upload" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Identity Logo (optional)</label>
              <input
                id="settings-logo-upload"
                type="file"
                accept="image/*"
                disabled={readOnly}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = typeof reader.result === 'string' ? reader.result : '';
                    setSettings((prev) => ({ ...prev, logoDataUrl: result }));
                  };
                  reader.readAsDataURL(file);
                }}
              />
              {settings.logoDataUrl && (
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-outline-variant/30 bg-white">
                    <img src={settings.logoDataUrl} alt="Brand logo preview" className="max-h-14 max-w-14 object-contain" />
                  </div>
                  <button
                    onClick={() => setSettings((prev) => ({ ...prev, logoDataUrl: '' }))}
                    disabled={readOnly}
                    className="text-xs font-bold text-error"
                  >
                    Remove Logo
                  </button>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="settings-custom-footer" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Custom Footer</label>
              <input
                id="settings-custom-footer"
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                value={settings.customFooter ?? ''}
                maxLength={500}
                disabled={readOnly}
                placeholder="e.g. © My Organization. All rights reserved."
                onChange={(e) => setSettings({ ...settings, customFooter: e.target.value })}
              />
              <p className="text-xs text-on-surface-variant mt-1">Displayed in the public portal footer. Leave blank to use the default.</p>
            </div>
            <div>
              <label htmlFor="settings-help-email" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Help Contact Email</label>
              <input
                id="settings-help-email"
                type="email"
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                value={settings.helpContactEmail ?? ''}
                maxLength={254}
                disabled={readOnly}
                placeholder="e.g. help@myorganization.org"
                onChange={(e) => setSettings({ ...settings, helpContactEmail: e.target.value })}
              />
              <p className="text-xs text-on-surface-variant mt-1">Shown to users who need support. Leave blank to hide.</p>
            </div>
            <div className="pt-2 border-t border-outline-variant/10">
              <h4 className="font-bold text-on-surface mb-2">Google integrations</h4>
              <p className="text-xs text-on-surface-variant mb-3">Configure optional links used by each project record.</p>
              <div className="space-y-4">
                <div>
                  <label htmlFor="settings-google-drive-url" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Google Drive base folder URL</label>
                  <input
                    id="settings-google-drive-url"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                    value={settings.googleDriveFolderBaseUrl ?? ''}
                    maxLength={500}
                    disabled={readOnly}
                    placeholder="https://drive.google.com/drive/folders/..."
                    onChange={(e) => setSettings({ ...settings, googleDriveFolderBaseUrl: e.target.value })}
                  />
                  <p className="text-xs text-on-surface-variant mt-1">Project code is appended to this base path for workspace links.</p>
                </div>
                <div>
                  <label htmlFor="settings-google-calendar-id" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Shared Google Calendar ID (optional)</label>
                  <input
                    id="settings-google-calendar-id"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                    value={settings.googleCalendarId ?? ''}
                    maxLength={254}
                    disabled={readOnly}
                    placeholder="team-calendar@group.calendar.google.com"
                    onChange={(e) => setSettings({ ...settings, googleCalendarId: e.target.value })}
                  />
                  <p className="text-xs text-on-surface-variant mt-1">Enables “Add deadline to Google Calendar” when a project due date is set.</p>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-outline-variant/10 space-y-4">
              <h4 className="font-bold text-on-surface">Public hero actions</h4>
              <p className="text-xs text-on-surface-variant">Add quick-link buttons shown on the public homepage hero section.</p>
              {(settings.heroQuickLinks ?? []).map((link, idx) => (
                <div key={link.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <input className="bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm" placeholder="Button label" value={link.label} maxLength={40} disabled={readOnly} onChange={(e) => setSettings({ ...settings, heroQuickLinks: (settings.heroQuickLinks ?? []).map((x, i) => i === idx ? { ...x, label: e.target.value } : x) })} />
                  <input className="bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm" placeholder="https://..." value={link.url} maxLength={500} disabled={readOnly} onChange={(e) => setSettings({ ...settings, heroQuickLinks: (settings.heroQuickLinks ?? []).map((x, i) => i === idx ? { ...x, url: e.target.value } : x) })} />
                  <button type="button" className="px-3 py-2 text-sm rounded-lg border border-outline-variant/30" disabled={readOnly} onClick={() => setSettings({ ...settings, heroQuickLinks: (settings.heroQuickLinks ?? []).filter((_, i) => i !== idx) })}>Remove</button>
                </div>
              ))}
              <button type="button" onClick={handleAddHeroLink} disabled={readOnly || (settings.heroQuickLinks?.length ?? 0) >= 8} className="px-3 py-2 text-sm rounded-lg bg-surface-container-low border border-outline-variant/30 disabled:opacity-60">Add hero button</button>
            </div>
          </div>

          {/* AI master toggle */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-on-surface">Enable AI</h3>
              <p className="text-sm text-on-surface-variant">Master switch for server-side AI. Turn on individual products below.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.aiEnabled}
                disabled={readOnly}
                onChange={(e) => {
                  const on = e.target.checked;
                  setSettings((prev) => ({
                    ...prev,
                    aiEnabled: on,
                    ...(on ? { aiAutoTagEnabled: true, aiSummarizeEnabled: true } : {}),
                  }));
                }}
              />
              <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className={`transition-opacity space-y-3 ${settings.aiEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'} ${readOnly ? 'pointer-events-none' : ''}`}>
            <h3 className="font-bold text-on-surface">Public story narrative (AI)</h3>
            <p className="text-xs text-on-surface-variant">Generate a marketing-style narrative for the public homepage, then publish/unpublish anytime.</p>
            <button type="button" disabled={readOnly || !settings.aiEnabled} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-60" onClick={async () => {
              try {
                const selectedProvider = settings.enabledProviders.includes(settings.activeProvider) ? settings.activeProvider : settings.enabledProviders[0];
                const providerModels = AI_MODEL_OPTIONS.filter((option) => option.provider === selectedProvider);
                const selectedModel = providerModels[0]?.id ?? AI_MODEL_OPTIONS[0]?.id ?? 'gpt-4o';
                const text = await api.generateAI(`Create a concise, high-impact marketing narrative (120-180 words) for this project portfolio. Organization: ${settings.portalName}. Product: ${settings.suiteName}.`, selectedProvider, selectedModel, 'You are a strategic marketing writer for higher education innovation initiatives.', 'publicNarrative');
                setSettings((prev) => ({ ...prev, heroNarrativeDraft: text }));
                setToast({ type: 'success', message: 'Narrative draft generated. Review and publish when ready.' });
              } catch (error) {
                setToast({ type: 'error', message: getErrorMessage(error, 'Failed to generate narrative.') });
              }
            }}>Generate narrative</button>
            <textarea className="w-full min-h-28 bg-surface-container-low border border-outline-variant/20 rounded-lg p-3 text-sm" disabled={readOnly} maxLength={6000} value={settings.heroNarrativeDraft ?? ''} onChange={(e) => setSettings({ ...settings, heroNarrativeDraft: e.target.value })} placeholder="AI draft appears here..." />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60" disabled={readOnly || !(settings.heroNarrativeDraft ?? '').trim()} onClick={() => { const next = { ...settings, heroNarrativePublished: settings.heroNarrativeDraft }; setSettings(next); void saveHeroContent(next, 'Narrative published to public homepage.'); }}>Publish draft</button>
              <button type="button" className="px-3 py-2 rounded-lg border border-outline-variant/30 text-sm" disabled={readOnly || !(settings.heroNarrativePublished ?? '').trim()} onClick={() => { const next = { ...settings, heroNarrativePublished: '' }; setSettings(next); void saveHeroContent(next, 'Narrative unpublished.'); }}>Unpublish</button>
            </div>
                        <button type="button" className="px-3 py-2 rounded-lg border border-outline-variant/30 text-sm" disabled={readOnly || savingHeroContent} onClick={() => void saveHeroContent(settings, 'Narrative draft saved.')}>Save draft</button>
          </div>

          {/* Provider Selection */}
          <div className={`transition-opacity ${settings.aiEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'} ${readOnly ? 'pointer-events-none' : ''}`}>
            <h3 className="font-bold text-on-surface mb-3">Enabled AI Providers</h3>
            <p className="text-xs text-on-surface-variant -mt-2 mb-3">
              Select one or more providers. Users can toggle providers while choosing models on project records.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {AI_PROVIDER_OPTIONS.map(provider => (
                <div
                  key={provider.id}
                  onClick={() => {
                    if (readOnly) return;
                    const currentlyEnabled = settings.enabledProviders.includes(provider.id);
                    if (currentlyEnabled && settings.enabledProviders.length === 1) return;
                    const nextEnabledProviders = currentlyEnabled
                      ? settings.enabledProviders.filter((id) => id !== provider.id)
                      : [...settings.enabledProviders, provider.id];
                    setSettings({
                      ...settings,
                      enabledProviders: nextEnabledProviders,
                      activeProvider: nextEnabledProviders.includes(settings.activeProvider) ? settings.activeProvider : nextEnabledProviders[0],
                    });
                  }}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    settings.enabledProviders.includes(provider.id)
                      ? 'border-primary bg-primary/5'
                      : 'border-outline-variant/20 hover:border-primary/30'
                  } ${readOnly ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                >
                  <div className="font-bold text-sm flex items-center justify-between">
                    <span>{provider.name}</span>
                    {settings.enabledProviders.includes(provider.id) && <span className="text-[11px] uppercase text-primary">Enabled</span>}
                  </div>
                  <div className="text-xs text-on-surface-variant mt-1">{provider.desc}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-on-surface-variant mt-2">At least one provider must remain enabled.</p>
          </div>



          <div className={`transition-opacity space-y-4 ${settings.aiEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'} ${readOnly ? 'pointer-events-none' : ''}`}>
            <h3 className="font-bold text-on-surface">Project record</h3>
            <p className="text-xs text-on-surface-variant -mt-2 mb-1">Inline tools on the project detail view.</p>
            {[
              { key: 'aiAutoTagEnabled', title: 'Auto-tag from project context', desc: 'Show the Auto-Tag control next to tags when you have edit access.' },
              { key: 'aiSummarizeEnabled', title: 'AI executive summary', desc: 'Show AI Summarize next to the executive summary field.' },
            ].map((feature) => (
              <div key={feature.key} className="flex items-center justify-between bg-surface-container-low rounded-lg p-3">
                <div>
                  <div className="text-sm font-bold">{feature.title}</div>
                  <div className="text-xs text-on-surface-variant mt-0.5">{feature.desc}</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings[feature.key as keyof Settings] as boolean}
                    disabled={readOnly}
                    onChange={(e) => setSettings({ ...settings, [feature.key]: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            ))}
          </div>

          <div className={`transition-opacity space-y-4 ${settings.aiEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'} ${readOnly ? 'pointer-events-none' : ''}`}>
            <h3 className="font-bold text-on-surface">Decision support drafts</h3>
            <p className="text-xs text-on-surface-variant -mt-2 mb-1">Buttons under AI Decision Support Workflow on the project record.</p>
            {[
              { key: 'aiNextBestActionEnabled', title: 'Next-best action suggestions', desc: 'Generate prioritized recommendations for project owners.' },
              { key: 'aiRiskNarrativeEnabled', title: 'Risk narrative drafts', desc: 'Draft board-ready risk narratives with mitigations.' },
              { key: 'aiDuplicateDetectionEnabled', title: 'Duplicate-project detection', desc: 'Surface overlap candidates before duplicate work begins.' },
              { key: 'aiPmApproachEnabled', title: 'Project management approach selector', desc: 'Recommend an approach (Agile/Scrum/Kanban/Hybrid/CPM, etc.) with human adoption controls.' },
              { key: 'aiRequireHumanApproval', title: 'Human approval required', desc: 'AI outputs stay in pending state until explicitly approved.' }
            ].map((feature) => (
              <div key={feature.key} className="flex items-center justify-between bg-surface-container-low rounded-lg p-3">
                <div>
                  <div className="text-sm font-bold">{feature.title}</div>
                  <div className="text-xs text-on-surface-variant mt-0.5">{feature.desc}</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings[feature.key as keyof Settings] as boolean}
                    disabled={readOnly}
                    onChange={(e) => setSettings({ ...settings, [feature.key]: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            ))}
          </div>

                    {/* API Key Notice */}
          <div className="bg-tertiary-container/30 border border-tertiary-fixed-dim/30 rounded-lg p-4 flex gap-3">
            <Key className="w-5 h-5 text-tertiary-fixed shrink-0 mt-0.5" />
            <div className="text-sm text-on-surface-variant">
              <strong className="text-on-surface block mb-1">API Key Configuration</strong>
              To use these providers, you must configure the corresponding API keys in the server environment variables (<code>.env</code>). Keys are securely handled server-side and never exposed to the client.
            </div>
          </div>
        </div>

        <div className="p-6 bg-surface-container-low border-t border-outline-variant/10 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || readOnly}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-70"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : readOnly ? 'View Only' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
