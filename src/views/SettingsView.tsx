import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Bot, Key, Shield, CalendarDays, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { api, getErrorMessage, Settings } from '../lib/api';
import { AI_PROVIDER_OPTIONS } from '../lib/uiDefaults';

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
    privacyMode: 'public-read',
    suiteName: 'AI Librarian Suite',
    portalName: 'Project Archives',
    logoDataUrl: '',
    primaryColor: '#002045',
    brandDarkColor: '#1A365D',
    googleCalendarEnabled: false,
    googleCalendarId: '',
    googleCalendarEventPrefix: '',
    googleCalendarPostProjectDueDate: true,
    googleCalendarPostMilestones: true,
    googleDriveEnabled: false,
    googleDriveSharedDriveId: '',
    googleDriveRootFolderId: '',
    googleDriveSubfolders: [],
    googleDriveProjectManifestEnabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<{ ownerCount: number; configured: boolean; eligible: boolean } | null>(null);
  const [claimingOwner, setClaimingOwner] = useState(false);

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

  const addGoogleDriveSubfolder = () => {
    setSettings((prev) => ({
      ...prev,
      googleDriveSubfolders: [...(prev.googleDriveSubfolders ?? []), { label: '', folderId: '' }],
    }));
  };

  const updateGoogleDriveSubfolder = (index: number, updates: { label?: string; folderId?: string }) => {
    setSettings((prev) => ({
      ...prev,
      googleDriveSubfolders: (prev.googleDriveSubfolders ?? []).map((folder, folderIndex) => (
        folderIndex === index ? { ...folder, ...updates } : folder
      )),
    }));
  };

  const removeGoogleDriveSubfolder = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      googleDriveSubfolders: (prev.googleDriveSubfolders ?? []).filter((_, folderIndex) => folderIndex !== index),
    }));
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
          <div className="border-t border-outline-variant/10 pt-8 space-y-6">
            <div>
              <h3 className="font-bold text-on-surface flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-primary" />
                Google Calendar project dates
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                Post project due dates and milestone due dates to the preferred shared calendar after records are saved.
              </p>
            </div>
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-xs text-on-surface-variant space-y-2">
              <p className="font-bold text-on-surface">Mini setup instructions</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Create or choose a Google Calendar for project dates.</li>
                <li>Share the calendar with the app service-account email and grant "Make changes to events".</li>
                <li>Paste the Calendar ID from Google Calendar settings below, then save.</li>
              </ol>
            </div>
            <div className="flex items-center justify-between bg-surface-container-low rounded-lg p-3">
              <div>
                <div className="text-sm font-bold">Enable Calendar posting</div>
                <div className="text-xs text-on-surface-variant">When enabled, saves trigger a best-effort server sync.</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={settings.googleCalendarEnabled}
                  disabled={readOnly}
                  onChange={(e) => setSettings({ ...settings, googleCalendarEnabled: e.target.checked })}
                />
                <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="settings-calendar-id" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Preferred Calendar ID</label>
                <input
                  id="settings-calendar-id"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.googleCalendarId}
                  maxLength={254}
                  disabled={readOnly}
                  placeholder="primary or calendar-id@group.calendar.google.com"
                  onChange={(e) => setSettings({ ...settings, googleCalendarId: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="settings-calendar-prefix" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Event title prefix</label>
                <input
                  id="settings-calendar-prefix"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.googleCalendarEventPrefix ?? ''}
                  maxLength={40}
                  disabled={readOnly}
                  placeholder="e.g. Project"
                  onChange={(e) => setSettings({ ...settings, googleCalendarEventPrefix: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { key: 'googleCalendarPostProjectDueDate', title: 'Post project due date', desc: 'Creates an all-day event for the project due date.' },
                { key: 'googleCalendarPostMilestones', title: 'Post milestone dates', desc: 'Creates all-day events for milestones with due dates.' },
              ].map((feature) => (
                <label key={feature.key} className="flex items-start gap-3 bg-surface-container-low rounded-lg p-3">
                  <input
                    type="checkbox"
                    checked={settings[feature.key as keyof Settings] as boolean}
                    disabled={readOnly}
                    onChange={(e) => setSettings({ ...settings, [feature.key]: e.target.checked })}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-bold">{feature.title}</span>
                    <span className="block text-xs text-on-surface-variant">{feature.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-outline-variant/10 pt-8 space-y-6">
            <div>
              <h3 className="font-bold text-on-surface flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-primary" />
                Google Drive shared files
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                Connect a shared drive or root folder so project records can surface matching Drive files and publish a project manifest.
              </p>
            </div>
            <div className="rounded-lg bg-tertiary-container/30 border border-tertiary-fixed-dim/30 p-4 text-xs text-on-surface-variant space-y-2">
              <p className="font-bold text-on-surface">Mini setup instructions</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Share the Shared Drive or folder with the app service-account email and grant at least Viewer access.</li>
                <li>Use Editor access if you want the platform to publish project manifest files.</li>
                <li>Paste the Shared Drive ID and/or root folder ID. Add optional subfolders for common project areas.</li>
              </ol>
            </div>
            <div className="flex items-center justify-between bg-surface-container-low rounded-lg p-3">
              <div>
                <div className="text-sm font-bold">Enable Drive lookup and posting</div>
                <div className="text-xs text-on-surface-variant">Project records can list matching files and sync a manifest JSON file.</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={settings.googleDriveEnabled}
                  disabled={readOnly}
                  onChange={(e) => setSettings({ ...settings, googleDriveEnabled: e.target.checked })}
                />
                <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="settings-drive-shared-drive-id" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Shared Drive ID</label>
                <input
                  id="settings-drive-shared-drive-id"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.googleDriveSharedDriveId ?? ''}
                  maxLength={128}
                  disabled={readOnly}
                  placeholder="Optional shared drive ID"
                  onChange={(e) => setSettings({ ...settings, googleDriveSharedDriveId: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="settings-drive-root-folder-id" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Root folder ID</label>
                <input
                  id="settings-drive-root-folder-id"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.googleDriveRootFolderId}
                  maxLength={128}
                  disabled={readOnly}
                  placeholder="Folder containing project files"
                  onChange={(e) => setSettings({ ...settings, googleDriveRootFolderId: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-start gap-3 bg-surface-container-low rounded-lg p-3">
              <input
                type="checkbox"
                checked={settings.googleDriveProjectManifestEnabled}
                disabled={readOnly}
                onChange={(e) => setSettings({ ...settings, googleDriveProjectManifestEnabled: e.target.checked })}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-bold">Publish project manifest</span>
                <span className="block text-xs text-on-surface-variant">Writes a small JSON summary into the root Drive folder when a project is saved.</span>
              </span>
            </label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-on-surface-variant uppercase">Subfolders</label>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={addGoogleDriveSubfolder}
                  className="text-xs font-bold text-primary flex items-center gap-1 disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" /> Add subfolder
                </button>
              </div>
              {(settings.googleDriveSubfolders ?? []).length === 0 && (
                <p className="text-xs text-on-surface-variant">No subfolders configured yet.</p>
              )}
              {(settings.googleDriveSubfolders ?? []).map((folder, index) => (
                <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-2 bg-surface-container-low rounded-lg p-3">
                  <input
                    className="md:col-span-5 bg-surface-container rounded p-2 text-xs"
                    value={folder.label}
                    maxLength={60}
                    disabled={readOnly}
                    placeholder="Label, e.g. Requirements"
                    onChange={(e) => updateGoogleDriveSubfolder(index, { label: e.target.value })}
                  />
                  <input
                    className="md:col-span-6 bg-surface-container rounded p-2 text-xs"
                    value={folder.folderId}
                    maxLength={128}
                    disabled={readOnly}
                    placeholder="Google Drive folder ID"
                    onChange={(e) => updateGoogleDriveSubfolder(index, { folderId: e.target.value })}
                  />
                  <button
                    type="button"
                    disabled={readOnly}
                    className="md:col-span-1 text-error text-xs font-bold flex items-center justify-center disabled:opacity-50"
                    onClick={() => removeGoogleDriveSubfolder(index)}
                    aria-label="Remove Google Drive subfolder"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
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
